import type { PgBoss } from "pg-boss";
import type postgres from "postgres";

import type { ExtractDocumentPayload, JobPayload } from "@healthtracker/types";

import type {
  RawExtractedField,
  TextractAdapter,
} from "../textract/adapter.js";
import { emitNotificationEvent } from "../notifications/emit.js";
import { emitLetterQueued } from "../notifications/letters-emit.js";
import { dispatchExtractedFields } from "../pipeline/dispatch.js";
import {
  applyDeadLetter,
  applyUploadTransition,
} from "../state-machine/upload-transitions.js";
import {
  isProgrammerError,
  isTransientTextractError,
} from "../textract/aws-errors.js";

/**
 * Story 2.3 — `extraction.document` consumer.
 *
 * Drives the upload state machine end-to-end for a single document:
 *
 *   queued
 *     ↓ applyUploadTransition (queued → processing)
 *   processing
 *     ↓ storage.download + textractAdapter.extract
 *     ↓ sql.begin: dispatch + audit + terminal UPDATE (all-or-nothing)
 *   complete            ← every field published, none reviewed
 *   pending_review      ← any review-queue entries written
 *   failed              ← zero fields extracted, OR every field
 *                          errored / was skipped
 *
 * R2-P113 — the terminal `applyUploadTransition` now runs INSIDE the
 * `sql.begin()` block alongside dispatch + audit. If any step fails,
 * the entire transaction rolls back; pg-boss retries cleanly with
 * the row still in `processing`. This + the review-queue idempotency
 * seam (R2-P113 unique index) makes crash-recovery resumes safe.
 *
 * R2-P114 — explicit status enumeration on optimistic-lock miss:
 * `processing` → resume (prior crash); `pending_review|complete|
 * failed` → ack-skip; anything else (`queued`, missing) → throw.
 *
 * R2-P115 — distinguish "ON CONFLICT no-op" from "empty extraction"
 * via `conflictCount`. Idempotent retry of a complete upload no
 * longer dead-letters it.
 */

export interface DocumentConsumerDeps {
  sql: postgres.Sql;
  textractAdapter: TextractAdapter;
  downloadStorageObject: (storagePath: string) => Promise<{
    bytes: Uint8Array;
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
  // R2-P124 — validate inputs at entry. `::uuid` cast on undefined
  // would throw inside the transaction and trigger an infinite
  // pg-boss retry loop.
  const patientId = data.patientId;
  const { uploadId, storagePath, mimeType } = data.payload;
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  if (!patientId || !uploadId || !storagePath || !mimeType) {
    throw new Error(
      `[extraction.document] invalid payload — required fields missing: patientId=${patientId}, uploadId=${uploadId}, storagePath=${storagePath}, mimeType=${mimeType}`,
    );
  }

  // R1-P95 + R2-P114 — try queued→processing; on miss, dispatch on
  // current status explicitly.
  const moveToProcessing = await applyUploadTransition(deps.sql, {
    uploadId,
    from: "queued",
    to: "processing",
  });
  if (!moveToProcessing.updated) {
    const status = await currentStatus(deps.sql, uploadId);
    switch (status) {
      case "processing":
        console.warn(
          `[extraction.document] uploadId=${uploadId}: resuming after prior worker crash (already in processing)`,
        );
        // Fall through to dispatch.
        break;
      case "pending_review":
      case "complete":
      case "failed":
        // Terminal-equivalent: someone (operator, other path)
        // already finalized this upload. Ack the job.
        console.warn(
          `[extraction.document] uploadId=${uploadId}: skipping; current status=${status}`,
        );
        return;
      default:
        // `queued`, `null`, or unknown — the state machine should
        // never deliver a job to this consumer when the row is in
        // `queued` and the UPDATE missed. Throw so pg-boss retries.
        throw new Error(
          `[extraction.document] uploadId=${uploadId}: queued→processing missed AND status='${status ?? "missing"}'; pg-boss will retry`,
        );
    }
  }

  // R2-P123 — wrap download in try/catch. Permanent storage failures
  // (404, perm-denied) shouldn't loop forever; dead-letter directly
  // with a clear reason and let the patient see the failed state.
  let bytes: Uint8Array;
  try {
    const downloaded = await deps.downloadStorageObject(storagePath);
    bytes = downloaded.bytes;
  } catch (err) {
    console.error(
      `[extraction.document] uploadId=${uploadId}: storage download failed; dead-lettering upload`,
      err,
    );
    // R1-P150 — wrap dead-letter + notification emission in a single
    // transaction. Without this, a crash between the two writes
    // leaves the upload `failed` with no push fired; the pg-boss
    // retry sees the terminal state and acks silently → AC4
    // silently violated.
    await deps.sql.begin(async (tx) => {
      const dl = await applyDeadLetter(tx, {
        uploadId,
        metadata: {
          reason: "storage_unavailable",
          error: err instanceof Error ? err.message : String(err),
        },
      });
      if (!dl.updated) {
        console.warn(
          `[extraction.document] uploadId=${uploadId}: dead-letter no-op (row already terminal)`,
        );
        return;
      }
      await emitNotificationEvent(tx, {
        uploadId,
        patientId,
        kind: "failed",
        metadata: { reason: "storage_unavailable" },
      });
    });
    return;
  }

  // Story 9.3 — wrap extract() so a PERMANENT fault dead-letters cleanly
  // (with a patient-visible `failed` push) instead of looping to the
  // pg-boss retry limit. Narrow catch (CLAUDE.md discipline):
  //   - programmer error (TypeError/etc.) → re-throw (surface the bug)
  //   - transient (throttle/5xx/timeout)  → re-throw (let pg-boss retry;
  //                                          it dead-letters after exhaustion)
  //   - everything else (4xx, mapping, unknown) → permanent → dead-letter.
  // Mirrors the storage-download catch above (R1-P150 single-tx invariant).
  let fields: RawExtractedField[];
  try {
    fields = await deps.textractAdapter.extract({
      bytes,
      mimeType,
      storagePath,
    });
  } catch (err) {
    if (isProgrammerError(err)) throw err;
    if (isTransientTextractError(err)) {
      console.warn(
        `[extraction.document] uploadId=${uploadId}: transient Textract error; letting pg-boss retry`,
        err,
      );
      throw err;
    }
    console.error(
      `[extraction.document] uploadId=${uploadId}: permanent extraction failure; dead-lettering upload`,
      err,
    );
    await deps.sql.begin(async (tx) => {
      const dl = await applyDeadLetter(tx, {
        uploadId,
        metadata: {
          reason: "extraction_unavailable",
          error: err instanceof Error ? err.message : String(err),
        },
      });
      if (!dl.updated) {
        console.warn(
          `[extraction.document] uploadId=${uploadId}: dead-letter no-op (row already terminal)`,
        );
        return;
      }
      await emitNotificationEvent(tx, {
        uploadId,
        patientId,
        kind: "failed",
        metadata: { reason: "extraction_unavailable" },
      });
    });
    return;
  }

  // R2-P113 + R1-P109 — atomic per-upload: dispatch + audit emission
  // + terminal UPDATE all run in one transaction. Mid-batch error →
  // rollback → pg-boss retries cleanly. Review-queue's unique index
  // (R2-P113) keeps the retry idempotent.
  try {
    await deps.sql.begin(async (tx) => {
      const outcome = await dispatchExtractedFields(tx, {
        uploadId,
        patientId,
        fields,
      });

      // Epic 2 retro F141 — set `uploads.lab_name` to the most-common
      // lab across this dispatch's publishable fields so the
      // notification consumer doesn't need the correlated subquery
      // on `observations`. Only updates when the dispatch yielded a
      // non-null winner; existing values are intentionally overwritten
      // on re-dispatch since the latest extraction is most authoritative.
      if (outcome.dominantLabName !== null) {
        await tx`UPDATE uploads
          SET lab_name = ${outcome.dominantLabName}
          WHERE id = ${uploadId}::uuid`;
      }

      // R1-P93 — emit one `observation.write` audit event per
      // newly-published observation. ON-CONFLICT no-op observations
      // (re-processed) intentionally don't re-audit.
      for (const observationId of outcome.publishedObservationIds) {
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

      // R2-P115 — distinguish "all-already-written (retry)" from
      // "empty extraction". `conflictCount > 0` means we re-ran a
      // doc that previously completed — DON'T dead-letter; instead
      // re-converge the terminal state.
      const hasWork =
        outcome.publishedCount > 0 ||
        outcome.reviewQueueCount > 0 ||
        outcome.conflictCount > 0;
      const needsReview =
        outcome.reviewQueueCount > 0 || outcome.conflictCount > 0;

      if (fields.length === 0 || !hasWork) {
        // Genuine empty extraction OR every field was quarantined
        // by per-field try/catch in dispatch (R2-P121). Dead-letter.
        // R1-P161 — `no_readable_text` matches AC4's vocabulary; the
        // old `empty_extraction` reason had no consumer mapping.
        const reason =
          fields.length === 0 ? "no_readable_text" : "no_publishable_fields";
        const dl = await applyDeadLetter(tx, {
          uploadId,
          metadata: {
            reason,
            field_count: fields.length,
            error_count: outcome.errorCount,
          },
        });
        if (!dl.updated) {
          console.warn(
            `[extraction.document] uploadId=${uploadId}: dead-letter no-op (row already terminal)`,
          );
          return;
        }
        // Story 2.5 — emit `notification.upload_failed` audit +
        // enqueue the push-send job so the patient receives the
        // "we couldn't process this file" push with the failure
        // reason in the metadata (AC4).
        await emitNotificationEvent(tx, {
          uploadId,
          patientId,
          kind: "failed",
          metadata: { reason, field_count: fields.length },
        });
        return;
      }

      // Determine terminal status. `needsReview` covers both fresh
      // review-queue inserts AND re-processed (conflict) rows where
      // the prior run had review entries.
      if (needsReview) {
        const move = await applyUploadTransition(tx, {
          uploadId,
          from: "processing",
          to: "pending_review",
          metadata: {
            published: outcome.publishedCount,
            review: outcome.reviewQueueCount,
            conflicts: outcome.conflictCount,
            errors: outcome.errorCount,
          },
        });
        if (!move.updated) {
          console.warn(
            `[extraction.document] uploadId=${uploadId}: processing→pending_review failed; row externally moved`,
          );
          return;
        }
        // Story 2.5 — emit `notification.upload_pending_review` audit
        // + enqueue the push-send job. Patient gets the "needs your
        // confirmation" push (AC3).
        await emitNotificationEvent(tx, {
          uploadId,
          patientId,
          kind: "pending_review",
          metadata: {
            published: outcome.publishedCount,
            review: outcome.reviewQueueCount,
          },
        });
        return;
      }

      const move = await applyUploadTransition(tx, {
        uploadId,
        from: "processing",
        to: "complete",
        metadata: {
          published: outcome.publishedCount,
          conflicts: outcome.conflictCount,
        },
      });
      if (!move.updated) {
        console.warn(
          `[extraction.document] uploadId=${uploadId}: processing→complete failed; row externally moved`,
        );
        return;
      }
      // Story 2.5 — direct processing→complete (no review needed)
      // emits the audit + enqueues the "your results are ready" push
      // (AC2). The patient-confirm path emits its own copy via
      // `packages/api/src/uploads-review.ts`; singleton_key on the
      // pg-boss job dedups in the (rare) race.
      await emitNotificationEvent(tx, {
        uploadId,
        patientId,
        kind: "complete",
        metadata: {
          published: outcome.publishedCount,
          conflicts: outcome.conflictCount,
        },
      });
      // Code-review F3 (Story 4.1) — NFR-I3 hard guard around
      // emitLetterQueued, with SAVEPOINT semantics so partial Letter
      // writes don't leak into the outer upload-complete commit.
      //
      // Re-review surfaced this: after F1/F2 reordered the helper to
      // write the audit row FIRST (uploadId-keyed) and the letters
      // row SECOND, a throw between the two would leave the audit
      // row in the outer tx and the catch-and-continue would COMMIT
      // it — permanently blocking any future re-enqueue (the partial
      // unique index treats the orphan audit row as an already-
      // queued letter). The fix: run emitLetterQueued inside a
      // postgres-js savepoint so a throw rolls back the audit row
      // before the catch swallows. The outer tx then commits the
      // upload-status transition + notification audit untouched.
      //
      // Narrow catch: programmer errors (TypeError/ReferenceError/
      // SyntaxError) still bubble so a code regression isn't
      // silently swallowed.
      try {
        const letterResult = await tx.savepoint((sp) =>
          emitLetterQueued(sp, { patientId, uploadId }),
        );
        if (!letterResult.enqueued) {
          console.log(
            `[extraction.document] uploadId=${uploadId}: letter skipped (${letterResult.reason})`,
          );
        }
      } catch (letterErr) {
        if (
          letterErr instanceof TypeError ||
          letterErr instanceof ReferenceError ||
          letterErr instanceof SyntaxError
        ) {
          throw letterErr;
        }
        console.error(
          `[extraction.document] uploadId=${uploadId}: letter enqueue failed — upload commit preserved (NFR-I3)`,
          letterErr,
        );
      }
    });
  } catch (err) {
    console.error(
      `[extraction.document] uploadId=${uploadId}: transaction failed; pg-boss will retry`,
      err,
    );
    throw err;
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
