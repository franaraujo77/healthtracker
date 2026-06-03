import { randomUUID } from "node:crypto";
import { PgBoss } from "pg-boss";

import type { ExtractDocumentPayload, JobPayload } from "@healthtracker/types";

import { sql } from "./db.js";
import {
  assertApplyPreconditions,
  parseReenqueueArgs,
  toExtractPayload,
} from "./reenqueue-stub-era.helpers.js";

/**
 * Story 9.4 — ONE-SHOT operator script. Re-enqueues uploads stuck in
 * `failed` from the stub/mock era (before `EXTRACTION_ADAPTER=aws` went
 * live) so patients don't have to re-upload. NOT wired into worker boot.
 *
 * Dry-run by default. Mutation requires BOTH `--apply` and a `--before`
 * cutoff (so a genuine post-launch failure is never re-enqueued).
 *
 *   # inspect (no writes):
 *   tsx src/reenqueue-stub-era.ts
 *   tsx src/reenqueue-stub-era.ts --before 2026-06-15T00:00:00Z
 *   # re-enqueue stub-era failures from before the aws launch:
 *   tsx src/reenqueue-stub-era.ts --apply --before 2026-06-15T00:00:00Z
 *   # narrow the reason set:
 *   tsx src/reenqueue-stub-era.ts --apply --before <iso> --reasons retries_exhausted,no_readable_text
 *
 * Idempotency: the `failed → queued` flip is guarded by `WHERE
 * status='failed' RETURNING`; the enqueue only fires for a row that was
 * actually flipped, so a re-run is a no-op.
 */

const WORKER_DATABASE_URL = process.env.WORKER_DATABASE_URL;
if (!WORKER_DATABASE_URL) throw new Error("WORKER_DATABASE_URL is required");

const args = parseReenqueueArgs(process.argv.slice(2));
assertApplyPreconditions(args);

interface CandidateRow {
  id: string;
  patient_id: string;
  storage_path: string | null;
  idempotency_key: string | null;
  mime_type: string | null;
  reason: string | null;
  updated_at: Date;
}

const boss = new PgBoss({ connectionString: WORKER_DATABASE_URL });

try {
  const candidates = await sql<CandidateRow[]>`
    SELECT id, patient_id, storage_path, idempotency_key, mime_type,
           metadata->>'reason' AS reason, updated_at
    FROM uploads
    WHERE status = 'failed'
      AND (${args.before}::timestamptz IS NULL OR updated_at < ${args.before}::timestamptz)
      AND metadata->>'reason' = ANY(${args.reasons}::text[])
    ORDER BY updated_at ASC
  `;

  console.log(
    `[reenqueue-stub-era] ${candidates.length} candidate(s) ` +
      `(before=${args.before?.toISOString() ?? "∅"}, reasons=${args.reasons.join(",")})`,
  );
  for (const row of candidates) {
    console.log(
      `  - uploadId=${row.id} patient=${row.patient_id} reason=${row.reason ?? "∅"} failedAt=${row.updated_at.toISOString()}`,
    );
  }

  if (!args.apply) {
    console.log(
      "[reenqueue-stub-era] DRY RUN — pass --apply --before <iso> to re-enqueue.",
    );
  } else {
    await boss.start();
    // Fail loud BEFORE flipping any row if the queue isn't registered
    // (pg-boss `send` throws on a missing queue; the long-running worker
    // creates it at boot). Prevents stranding rows in `queued` with no job.
    const queue = await boss.getQueue("extraction.document");
    if (!queue) {
      throw new Error(
        "extraction.document queue is not registered — start the worker once " +
          "(it calls createQueue at boot) before running this script.",
      );
    }
    let reenqueued = 0;
    let skipped = 0;
    for (const row of candidates) {
      // Reconstruct the payload BEFORE the flip so a corrupt row (missing
      // columns) is skipped without being left `queued` with no job.
      let payload: ExtractDocumentPayload;
      try {
        payload = toExtractPayload({
          uploadId: row.id,
          storagePath: row.storage_path,
          idempotencyKey: row.idempotency_key,
          mimeType: row.mime_type,
        });
      } catch (err) {
        console.warn(
          `[reenqueue-stub-era] uploadId=${row.id}: skip — ${err instanceof Error ? err.message : String(err)}`,
        );
        skipped += 1;
        continue;
      }
      // Guarded flip — only a row still `failed` is claimed; the RETURNING
      // gates the enqueue so a re-run / race never double-enqueues. Also
      // clear `processing_completed_at` so a re-processing run isn't misread
      // as "done" by `processing_completed_at IS NOT NULL` consumers.
      const flipped = await sql<{ id: string }[]>`
        UPDATE uploads
        SET status = 'queued', updated_at = now(), processing_completed_at = NULL
        WHERE id = ${row.id}::uuid AND status = 'failed'
        RETURNING id
      `;
      if (flipped.length === 0) {
        console.warn(
          `[reenqueue-stub-era] uploadId=${row.id}: skip (no longer 'failed')`,
        );
        skipped += 1;
        continue;
      }
      const wrapped: JobPayload<ExtractDocumentPayload> = {
        jobId: randomUUID(),
        patientId: row.patient_id,
        correlationId: row.id,
        payload,
        createdAt: new Date().toISOString(),
      };
      try {
        await boss.send("extraction.document", wrapped);
      } catch (err) {
        // Compensate: the flip committed but the enqueue failed. Revert
        // `queued → failed` so the row is re-runnable (a stranded `queued`
        // row with no job would never be picked up), then abort loud.
        await sql`
          UPDATE uploads SET status = 'failed'
          WHERE id = ${row.id}::uuid AND status = 'queued'
        `;
        throw new Error(
          `enqueue failed for uploadId=${row.id} (flip reverted): ${err instanceof Error ? err.message : String(err)}`,
        );
      }
      console.log(
        `[reenqueue-stub-era] re-enqueued uploadId=${row.id} (was reason=${row.reason ?? "∅"})`,
      );
      reenqueued += 1;
    }
    console.log(
      `[reenqueue-stub-era] done — re-enqueued ${reenqueued}, skipped ${skipped}.`,
    );
  }
} catch (err) {
  // A destructive operator script must signal failure (don't mask it with
  // exit 0). Partial progress is already logged per-row above.
  console.error("[reenqueue-stub-era] FAILED:", err);
  process.exitCode = 1;
} finally {
  await boss.stop();
  await sql.end();
  process.exit(process.exitCode ?? 0);
}
