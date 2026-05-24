import { TRPCError } from "@trpc/server";

import { and, eq, sql } from "@healthtracker/db";
import { Uploads } from "@healthtracker/db/schema";

import type { AuditDb } from "./audit";

/**
 * Story 2.1 — single sanctioned state-machine helper for the `uploads`
 * table. Story 2.3's extraction worker is the first real caller; the
 * helper ships now so the contract is locked before the worker lands.
 *
 * State machine (architecture.md L117):
 *
 *     queued ──► processing ──► complete
 *                    │
 *                    └─► pending_review ──► complete
 *                                       └─► failed
 *                    │
 *                    └─► failed
 *
 * Plus a dead-letter override (`applyDeadLetter`) that forces `failed`
 * from any non-terminal state (worker max-retries exceeded).
 *
 * `failed → queued` is NOT legal — re-queue is a NEW row with a NEW
 * idempotency key; transitioning a failed row to queued would mask
 * the failure history.
 *
 * **RLS gap (acknowledged):** the current `custom_rls_uploads.sql` has
 * SELECT + INSERT own policies only, no UPDATE policy at the patient
 * layer. Story 2.3 will add a narrow service-role UPDATE policy when
 * the worker first needs to transition `queued → processing`. The
 * unit tests below mock the DB and do not exercise RLS; integration
 * coverage lands with Story 2.3.
 */

export type UploadStatus =
  | "queued"
  | "processing"
  | "pending_review"
  | "complete"
  | "failed";

/**
 * The legal transition arcs. Frozen as `const` so callers can rely on
 * the keys and values at the type level.
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
  /** Merged into the row's `metadata` jsonb via `||`. */
  metadata?: Record<string, unknown>;
}

export interface ApplyUploadTransitionResult {
  updated: boolean;
  /** Set when `updated === true`; otherwise null. */
  currentStatus: UploadStatus | null;
}

function isLegalTransition(from: UploadStatus, to: UploadStatus): boolean {
  if (from === to) return false;
  const legal = UPLOAD_TRANSITIONS[from] as readonly UploadStatus[];
  return legal.includes(to);
}

/**
 * Advance an upload from `from` to `to`. The optimistic-lock clause
 * `WHERE id = $uploadId AND status = $from` prevents lost updates when
 * two workers race on the same row.
 *
 * Returns `{ updated: false, currentStatus: null }` when the
 * optimistic-lock misses (row already moved by another worker, or
 * uploadId doesn't exist). Throws `INVALID_UPLOAD_TRANSITION` when
 * `to` is not legal from `from`.
 */
export async function applyUploadTransition(
  database: AuditDb,
  input: ApplyUploadTransitionInput,
): Promise<ApplyUploadTransitionResult> {
  if (!isLegalTransition(input.from, input.to)) {
    throw new TRPCError({
      code: "CONFLICT",
      message: "INVALID_UPLOAD_TRANSITION",
    });
  }

  return runUpdate(
    database,
    input.uploadId,
    input.from,
    input.to,
    input.metadata,
  );
}

/**
 * Force `failed` from any non-terminal state (worker exhausted retries).
 * Separate sanctioned path; deliberately bypasses the transition map so
 * callers must opt in explicitly via this name. Refuses to overwrite a
 * terminal state (`complete` / `failed` → no-op + `updated: false`).
 */
export async function applyDeadLetter(
  database: AuditDb,
  input: { uploadId: string; metadata?: Record<string, unknown> },
): Promise<ApplyUploadTransitionResult> {
  // Optimistic-lock against the non-terminal states only. If the row is
  // already complete or failed, the WHERE clause matches zero rows and
  // we return `{ updated: false, currentStatus: null }`.
  const merged = input.metadata ?? {};
  const [row] = await database
    .update(Uploads)
    .set({
      status: "failed",
      updatedAt: new Date(),
      processingCompletedAt: sql`COALESCE(${Uploads.processingCompletedAt}, now())`,
      metadata: sql`${Uploads.metadata} || ${JSON.stringify(merged)}::jsonb`,
    })
    .where(
      and(
        eq(Uploads.id, input.uploadId),
        sql`${Uploads.status} IN ('queued', 'processing', 'pending_review')`,
      ),
    )
    .returning({ id: Uploads.id, status: Uploads.status });

  if (!row) {
    return { updated: false, currentStatus: null };
  }
  return { updated: true, currentStatus: row.status };
}

async function runUpdate(
  database: AuditDb,
  uploadId: string,
  from: UploadStatus,
  to: UploadStatus,
  metadata: Record<string, unknown> | undefined,
): Promise<ApplyUploadTransitionResult> {
  const merged = metadata ?? {};
  const setProcessingStartedAt = to === "processing";
  const setProcessingCompletedAt = to === "complete" || to === "failed";

  const [row] = await database
    .update(Uploads)
    .set({
      status: to,
      updatedAt: new Date(),
      // Only stamp `processing_started_at` when entering `processing`,
      // and only if it hasn't been set already (the COALESCE preserves
      // the original start time if the row briefly leaves and re-enters
      // processing — that doesn't happen today, but the COALESCE is
      // cheap and matches the helper's "preserve history" intent).
      processingStartedAt: setProcessingStartedAt
        ? sql`COALESCE(${Uploads.processingStartedAt}, now())`
        : Uploads.processingStartedAt,
      processingCompletedAt: setProcessingCompletedAt
        ? sql`COALESCE(${Uploads.processingCompletedAt}, now())`
        : Uploads.processingCompletedAt,
      metadata: sql`${Uploads.metadata} || ${JSON.stringify(merged)}::jsonb`,
    })
    .where(and(eq(Uploads.id, uploadId), eq(Uploads.status, from)))
    .returning({ id: Uploads.id, status: Uploads.status });

  if (!row) {
    return { updated: false, currentStatus: null };
  }
  return { updated: true, currentStatus: row.status };
}
