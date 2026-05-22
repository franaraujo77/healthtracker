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
 *     ↓ dispatchExtractedFields (publish + review-queue + dead-letter
 *                                 counts)
 *   complete            ← all fields published, none reviewed/dead
 *   pending_review      ← any review-queue entries written
 *   failed              ← all fields below 0.01 confidence
 *                          (or no fields at all)
 *
 * Errors thrown from the handler are NOT swallowed — pg-boss retries
 * (per the `extraction.document` queue config in `index.ts`), and on
 * `retryLimit` exhaustion the dead-letter consumer fires
 * `markUploadFailed`. The handler itself only returns successfully
 * once the state machine has settled.
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

  // queued → processing
  const moveToProcessing = await applyUploadTransition(deps.sql, {
    uploadId,
    from: "queued",
    to: "processing",
  });
  if (!moveToProcessing.updated) {
    // Another worker picked it up, OR the row already moved past
    // queued (dead-letter retry on a row that was hand-completed by
    // an operator, etc.). Don't throw — log and ack the pg-boss job
    // so it doesn't retry.
    console.warn(
      `[extraction.document] uploadId=${uploadId}: queued→processing failed (optimistic-lock miss); skipping`,
    );
    return;
  }

  // Download bytes + extract fields.
  const { bytes } = await deps.downloadStorageObject(storagePath);
  const fields = await deps.textractAdapter.extract({
    bytes,
    mimeType,
    storagePath,
  });

  // Dispatch + confidence gate.
  const outcome = await dispatchExtractedFields(deps.sql, {
    uploadId,
    patientId,
    fields,
  });

  // Decide terminal status.
  // All fields below the dead-letter threshold (or zero fields
  // extracted at all) → dead-letter the upload.
  if (fields.length > 0 && outcome.deadLetterCount === fields.length) {
    await applyDeadLetter(deps.sql, {
      uploadId,
      metadata: { reason: "no_readable_text", field_count: fields.length },
    });
    return;
  }
  if (fields.length === 0) {
    await applyDeadLetter(deps.sql, {
      uploadId,
      metadata: { reason: "empty_extraction" },
    });
    return;
  }

  // Any review-queue entries (low confidence OR LOINC unresolved OR
  // structurally bad value) → pending_review. The published-count
  // can be non-zero (mixed-outcome documents still publish their
  // high-confidence fields).
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
        `[extraction.document] uploadId=${uploadId}: processing→pending_review failed; row may have been moved externally`,
      );
    }
    return;
  }

  // Clean run — every field published.
  const move = await applyUploadTransition(deps.sql, {
    uploadId,
    from: "processing",
    to: "complete",
    metadata: { published: outcome.publishedCount },
  });
  if (!move.updated) {
    console.warn(
      `[extraction.document] uploadId=${uploadId}: processing→complete failed; row may have been moved externally`,
    );
  }
}
