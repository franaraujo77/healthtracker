import type { PgBoss } from "pg-boss";
import type postgres from "postgres";

import type { ExtractDocumentPayload, JobPayload } from "@healthtracker/types";

import type { TextractAdapter } from "../textract/adapter.js";
import { dispatchExtractedFields } from "../pipeline/dispatch.js";
import {
  applyDeadLetter,
  applyUploadTransition,
} from "../state-machine/upload-transitions.js";

/**
 * Story 2.3 — `extraction.document` consumer.
 *
 * Drives the upload state machine end-to-end for a single document:
 *
 *   queued
 *     ↓ applyUploadTransition (queued → processing)
 *   processing
 *     ↓ storage.download + textractAdapter.extract
 *     ↓ dispatchExtractedFields (publish + review-queue counts;
 *                                 returns published observation ids)
 *     ↓ writeAuditLog per published observation (R1-P93)
 *   complete            ← every field published, none reviewed
 *   pending_review      ← any review-queue entries written
 *   failed              ← zero fields extracted, OR zero fields
 *                          published AND zero reviewed
 *
 * R1-P95 — optimistic-lock-miss handling. If the row is not in
 * `queued` (e.g., a prior worker crashed mid-processing and pg-boss
 * is retrying), the handler checks the current status and either
 * resumes (if `processing`) or acks-and-skips (if terminal). Without
 * this, a crashed worker leaves the row stuck in `processing` forever.
 *
 * R1-P109 — wraps the per-upload dispatch + audit emission in
 * `sql.begin(async tx => ...)` so mid-batch DB errors don't leave
 * partial review-queue dupes on pg-boss retry.
 */

export interface DocumentConsumerDeps {
  sql: postgres.Sql;
  textractAdapter: TextractAdapter;
  downloadStorageObject: (storagePath: string) => Promise<{
    bytes: Uint8Array;
    mimeType: string;
  }>;
}

export async function registerDocumentConsumer(
  boss: PgBoss,
  deps: DocumentConsumerDeps,
): Promise<void> {
  await boss.work<JobPayload<ExtractDocumentPayload>>(
    "extraction.document",
    { localConcurrency: 5 },
    async (jobs) => {
      for (const job of jobs) {
        await handleDocumentJob(deps, job.data);
      }
    },
  );
}

export async function handleDocumentJob(
  deps: DocumentConsumerDeps,
  data: JobPayload<ExtractDocumentPayload>,
): Promise<void> {
  const { uploadId, storagePath, mimeType } = data.payload;
  const patientId = data.patientId;

  // R1-P95 — try queued→processing; on miss, check current status
  // and decide whether to resume or skip.
  const moveToProcessing = await applyUploadTransition(deps.sql, {
    uploadId,
    from: "queued",
    to: "processing",
  });
  if (!moveToProcessing.updated) {
    const status = await currentStatus(deps.sql, uploadId);
    if (status === "processing") {
      console.warn(
        `[extraction.document] uploadId=${uploadId}: resuming after prior worker crash (already in processing)`,
      );
      // Fall through to the extraction + dispatch path.
    } else {
      console.warn(
        `[extraction.document] uploadId=${uploadId}: skipping; current status=${status ?? "missing"}`,
      );
      return;
    }
  }

  // R1-P98 — use payload's `mimeType` (validated at upload time per
  // Story 2.2 confirmImport) instead of storage-derived (Supabase
  // can return empty `data.type` for unknown MIMEs).
  const { bytes } = await deps.downloadStorageObject(storagePath);
  const fields = await deps.textractAdapter.extract({
    bytes,
    mimeType,
    storagePath,
  });

  // R1-P109 — atomic per-upload: dispatch + audit emission run in
  // one transaction. Mid-batch error → rollback → pg-boss retries
  // cleanly (no duplicate review-queue rows).
  let outcome;
  try {
    outcome = await deps.sql.begin(async (tx) => {
      const dispatchOutcome = await dispatchExtractedFields(tx, {
        uploadId,
        patientId,
        fields,
      });
      // R1-P93 — emit one `observation.write` audit event per
      // published observation (`actorType: 'system'`). Worker uses
      // raw SQL (mirrors `packages/api/src/audit.ts` `writeAuditLog`)
      // because it's on a separate postgres-driver connection.
      // Service-role bypasses the audit RLS WITH CHECK (Story 1.1
      // F10 — system-actor RLS deferred).
      for (const observationId of dispatchOutcome.publishedObservationIds) {
        await tx`INSERT INTO audit_log
          (actor_id, actor_type, event, resource_id, resource_type, metadata)
          VALUES (
            ${patientId}::uuid,
            'system',
            'observation.write',
            ${observationId}::uuid,
            'observation',
            ${JSON.stringify({ uploadId, source: "extracted" })}::jsonb
          )`;
      }
      return dispatchOutcome;
    });
  } catch (err) {
    console.error(
      `[extraction.document] uploadId=${uploadId}: transaction failed; pg-boss will retry`,
      err,
    );
    throw err;
  }

  // R1-P100 — terminal-status decision. Dead-letter only when
  // nothing got written at all (empty extraction OR all-fields
  // rejected by the dispatcher before any write — should be
  // impossible post-R1-P100 since every field goes somewhere).
  if (
    fields.length === 0 ||
    (outcome.publishedCount === 0 && outcome.reviewQueueCount === 0)
  ) {
    const dl = await applyDeadLetter(deps.sql, {
      uploadId,
      metadata: {
        reason:
          fields.length === 0 ? "empty_extraction" : "no_publishable_fields",
        field_count: fields.length,
      },
    });
    // R1-P106 — check the dead-letter return.
    if (!dl.updated) {
      console.warn(
        `[extraction.document] uploadId=${uploadId}: dead-letter no-op (row already terminal)`,
      );
    }
    return;
  }

  if (outcome.reviewQueueCount > 0) {
    const move = await applyUploadTransition(deps.sql, {
      uploadId,
      from: "processing",
      to: "pending_review",
      metadata: {
        published: outcome.publishedCount,
        review: outcome.reviewQueueCount,
      },
    });
    if (!move.updated) {
      console.warn(
        `[extraction.document] uploadId=${uploadId}: processing→pending_review failed; row externally moved`,
      );
    }
    return;
  }

  const move = await applyUploadTransition(deps.sql, {
    uploadId,
    from: "processing",
    to: "complete",
    metadata: { published: outcome.publishedCount },
  });
  if (!move.updated) {
    console.warn(
      `[extraction.document] uploadId=${uploadId}: processing→complete failed; row externally moved`,
    );
  }
}

async function currentStatus(
  sql: postgres.Sql,
  uploadId: string,
): Promise<string | null> {
  const rows = await sql<
    { status: string }[]
  >`SELECT status FROM uploads WHERE id = ${uploadId}::uuid LIMIT 1`;
  return rows[0]?.status ?? null;
}
