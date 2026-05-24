import type postgres from "postgres";

import { emitNotificationEvent } from "../notifications/emit.js";

// R2-P113 — `applyUploadTransition` is now called from inside the
// document-consumer's `sql.begin(async tx => ...)` block (so the
// terminal status UPDATE is atomic with dispatch + audit). Widen
// the type to accept both top-level `Sql` and `TransactionSql`.
type WorkerSql = postgres.Sql | postgres.TransactionSql;

/**
 * Story 2.3 — worker-side upload state-machine helpers.
 *
 * Mirrors the contracts of `packages/api/src/upload-transitions.ts`
 * (Story 2.1's `applyUploadTransition` + `applyDeadLetter`). The
 * worker cannot import that helper directly: the API uses Drizzle
 * bound to a shared postgres-js client (`packages/db/src/client.ts`)
 * with a pooler connection sized for serverless cold-starts; the
 * worker uses `postgres` on a direct (non-pooled) connection because
 * pg-boss requires session-mode for advisory locks. Duplicating the
 * SQL is the trade-off.
 *
 * Risk: if the API helper's SQL contract drifts, this file gets out
 * of sync. The Story 2.3 spec calls for a snapshot test that diffs
 * the two SQL bodies (Task 7 / 9). The unit tests in
 * `services/extraction/__tests__/state-machine.test.ts` exercise the
 * SQL shape with a mocked sql tag.
 */

export type UploadStatus =
  | "queued"
  | "processing"
  | "pending_review"
  | "complete"
  | "failed";

/**
 * The legal transition arcs — mirrors `UPLOAD_TRANSITIONS` in
 * `packages/api/src/upload-transitions.ts`.
 *
 * Exported so the snapshot-sync test (R1-P110) can import both
 * modules' versions and assert structural equality. SQL drift
 * detection requires integration testing (deferred F112).
 */
export const UPLOAD_TRANSITIONS = {
  queued: ["processing"],
  processing: ["pending_review", "complete", "failed"],
  pending_review: ["complete", "failed"],
  complete: [],
  failed: [],
} as const satisfies Record<UploadStatus, readonly UploadStatus[]>;

export interface ApplyUploadTransitionInput {
  uploadId: string;
  from: UploadStatus;
  to: UploadStatus;
  metadata?: Record<string, unknown>;
}

export interface ApplyUploadTransitionResult {
  updated: boolean;
  currentStatus: UploadStatus | null;
}

function isLegalTransition(from: UploadStatus, to: UploadStatus): boolean {
  if (from === to) return false;
  const legal = UPLOAD_TRANSITIONS[from] as readonly UploadStatus[];
  return legal.includes(to);
}

export async function applyUploadTransition(
  sql: WorkerSql,
  input: ApplyUploadTransitionInput,
): Promise<ApplyUploadTransitionResult> {
  if (!isLegalTransition(input.from, input.to)) {
    // Worker should never call this with an illegal arc — throw to
    // surface the bug in dev/CI.
    throw new Error(`INVALID_UPLOAD_TRANSITION: ${input.from} → ${input.to}`);
  }

  const merged = JSON.stringify(input.metadata ?? {});
  const setProcessingStartedAt = input.to === "processing";
  const setProcessingCompletedAt =
    input.to === "complete" || input.to === "failed";

  const rows = await sql<{ id: string; status: UploadStatus }[]>`UPDATE uploads
    SET status = ${input.to}::upload_status_enum,
        updated_at = now(),
        processing_started_at = ${
          setProcessingStartedAt
            ? sql`COALESCE(processing_started_at, now())`
            : sql`processing_started_at`
        },
        processing_completed_at = ${
          setProcessingCompletedAt
            ? sql`COALESCE(processing_completed_at, now())`
            : sql`processing_completed_at`
        },
        metadata = COALESCE(metadata, '{}'::jsonb) || ${merged}::jsonb
    WHERE id = ${input.uploadId}::uuid
      AND status = ${input.from}::upload_status_enum
    RETURNING id, status`;

  const row = rows[0];
  if (!row) return { updated: false, currentStatus: null };
  return { updated: true, currentStatus: row.status };
}

/**
 * Force `failed` from any non-terminal state (worker exhausted
 * retries, OR no readable text per Story 2.2 AC4). Refuses to
 * overwrite a terminal state — returns `{ updated: false }` in
 * that case.
 */
export async function applyDeadLetter(
  sql: WorkerSql,
  input: { uploadId: string; metadata?: Record<string, unknown> },
): Promise<ApplyUploadTransitionResult> {
  const merged = JSON.stringify(input.metadata ?? {});
  const rows = await sql<{ id: string; status: UploadStatus }[]>`UPDATE uploads
    SET status = 'failed'::upload_status_enum,
        updated_at = now(),
        processing_completed_at = COALESCE(processing_completed_at, now()),
        metadata = COALESCE(metadata, '{}'::jsonb) || ${merged}::jsonb
    WHERE id = ${input.uploadId}::uuid
      AND status IN ('queued', 'processing', 'pending_review')
    RETURNING id, status`;

  const row = rows[0];
  if (!row) return { updated: false, currentStatus: null };
  return { updated: true, currentStatus: row.status };
}

/**
 * Story 0.5 / 1.5-era dead-letter consumer callback. Kept as a thin
 * wrapper around `applyDeadLetter` so the existing
 * `services/extraction/src/index.ts` dead-letter handler doesn't
 * change shape.
 *
 * Story 2.5 — when the dead-letter transition succeeds, also emit
 * the `notification.upload_failed` audit event + enqueue the
 * `notification.send` job (AC4). R1-P151 wraps the whole sequence
 * in a single transaction; R1-P152 guards against double-firing
 * when the consumer also dead-lettered (e.g. storage-unavailable
 * path emits failed-audit + then pg-boss eventually max-retries
 * the original job into this callback). R1-P162 uses a static
 * import so NodeNext + tsx test envs resolve cleanly.
 */
export async function markUploadFailed(
  sql: postgres.Sql,
  uploadId: string,
): Promise<void> {
  // R1-P151 — the dead-letter callback always passes the top-level
  // Sql (not a transaction handle), so `sql.begin` is safe here.
  // `markUploadFailed` is NOT meant to be called from inside an
  // outer transaction.
  await sql.begin(async (tx) => {
    const result = await applyDeadLetter(tx, {
      uploadId,
      metadata: { reason: "retries_exhausted" },
    });
    if (!result.updated) {
      console.warn(
        `[upload-transitions] markUploadFailed: uploadId=${uploadId} was already terminal — no-op`,
      );
      return;
    }
    const ownerRows = await tx<{ patient_id: string }[]>`
      SELECT patient_id FROM uploads WHERE id = ${uploadId}::uuid LIMIT 1
    `;
    const patientId = ownerRows[0]?.patient_id;
    if (!patientId) {
      console.warn(
        `[upload-transitions] markUploadFailed: uploadId=${uploadId} row vanished after dead-letter — skipping notification`,
      );
      return;
    }
    // R1-P152 — if a `notification.upload_failed` audit row already
    // exists for this upload (e.g. the consumer's
    // storage-unavailable path already emitted), do not double-fire.
    // The singleton_key on pgboss.job only dedups while the prior
    // `notification.send` job is still active/created — once it
    // completes the next enqueue would succeed.
    const existing = await tx<{ exists: boolean }[]>`
      SELECT EXISTS (
        SELECT 1 FROM audit_log
        WHERE resource_id = ${uploadId}::uuid
          AND event = 'notification.upload_failed'
      ) AS exists
    `;
    if (existing[0]?.exists) {
      console.warn(
        `[upload-transitions] markUploadFailed: uploadId=${uploadId} already has notification.upload_failed audit row — skipping`,
      );
      return;
    }
    await emitNotificationEvent(tx, {
      uploadId,
      patientId,
      kind: "failed",
      metadata: { reason: "retries_exhausted" },
    });
  });
}
