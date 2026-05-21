import type { ExtractDocumentPayload, JobPayload } from "@healthtracker/types";
import { sql } from "@healthtracker/db";
import { Uploads } from "@healthtracker/db/schema";

import type { AuditDb } from "./audit";

export interface UploadInsert {
  patientId: string;
  idempotencyKey: string;
  storagePath: string;
  mimeType: string;
  sizeBytes: number;
  originalFilename: string;
  source: "onboarding_import" | "post_onboarding";
}

/**
 * Story 1.5 — sanctioned write path for `uploads` rows. Mirrors
 * `writeAuditLog` / `writeConsentGrant`: every INSERT goes through this
 * function so future cross-cutting concerns (telemetry, idempotency
 * variants) live in one place.
 *
 * Idempotent on the `idempotency_key` UNIQUE seam (FR8 — offline-retry
 * sends the same key; the second INSERT hits `ON CONFLICT DO NOTHING`
 * and the helper returns `null`, signalling the router to skip the
 * extraction enqueue + audit emit).
 */
export async function writeUpload(
  database: AuditDb,
  entry: UploadInsert,
): Promise<{ id: string } | null> {
  const [row] = await database
    .insert(Uploads)
    .values({
      patientId: entry.patientId,
      idempotencyKey: entry.idempotencyKey,
      storagePath: entry.storagePath,
      mimeType: entry.mimeType,
      sizeBytes: entry.sizeBytes,
      originalFilename: entry.originalFilename,
      source: entry.source,
      status: "queued",
    })
    // Review P41 — ON CONFLICT target matches the now-composite UNIQUE
    // `(patient_id, idempotency_key)`. Single-column conflict targeting
    // would silently fail to match the partial index after the schema
    // change.
    .onConflictDoNothing({
      target: [Uploads.patientId, Uploads.idempotencyKey],
    })
    .returning({ id: Uploads.id });
  return row ?? null;
}

/**
 * Enqueues an `extraction.document` job onto pg-boss directly via SQL.
 *
 * **Why raw SQL instead of the pg-boss client?** The API server runs on
 * the request-scoped Drizzle connection. Adding a separate pg-boss
 * client here would open a second connection pool and require us to
 * call `boss.start()` to run pg-boss schema migrations from the API
 * process — which contradicts Story 0.5's design (only the worker
 * process owns the queue schema). Inserting directly into `pgboss.job`
 * with the same `JobPayload<T>` shape pg-boss expects keeps the API
 * server stateless w.r.t. queue infrastructure.
 *
 * The job lands in `state = 'created'` (pg-boss default); the worker
 * picks it up via `boss.work('extraction.document', ...)`. The queue
 * itself must already exist — `services/extraction/src/index.ts` calls
 * `boss.createQueue('extraction.document', ...)` at worker startup.
 *
 * Because this runs inside `protectedProcedure`'s transaction wrap,
 * the enqueue is rolled back together with the upload row if the
 * subsequent audit insert throws (Story 1.4 P27 investigation).
 *
 * Trade-off acknowledged: this couples us to pg-boss's internal
 * `pgboss.job` schema. If pg-boss's job-table shape changes in a major
 * version bump, this helper breaks. Flag as a follow-up to wrap with
 * pg-boss's official client once we're willing to spend the extra
 * connection budget on the API server.
 */
/**
 * Per-queue retry policy for `extraction.document`. Must stay in sync
 * with `services/extraction/src/index.ts#createQueue('extraction.document')`.
 *
 * Round-2 P48 — pg-boss v12's `pgboss.job` table uses snake_case
 * column names (`retry_limit`, `retry_delay`, `retry_backoff`,
 * `dead_letter`). Round-1 P40 wrote against pg-boss v10 docs and used
 * the wrong column names, which would have thrown
 * `column "retrylimit" does not exist` at runtime. Verified against
 * `node_modules/.pnpm/pg-boss@12.18.2/.../plans.js#createTableJob`.
 *
 * The policy is stored per-ROW (not per-queue): `boss.createQueue(...)`
 * writes the template to `pgboss.queue`, and `boss.send()` does a
 * SELECT-JOIN-COALESCE against `pgboss.queue` to copy the defaults
 * into each new job row. A raw INSERT that omits these columns lands
 * with the table-level defaults (`retry_limit=2, retry_delay=0,
 * retry_backoff=false`, no `dead_letter`) — not the queue's
 * configured policy. We therefore set them explicitly to match the
 * queue config in `services/extraction/src/index.ts`. The two
 * constants must drift together; flag as a known coupling.
 */
const EXTRACTION_DOCUMENT_RETRY_LIMIT = 3;
const EXTRACTION_DOCUMENT_RETRY_DELAY = 60;
const EXTRACTION_DOCUMENT_RETRY_BACKOFF = true;
const EXTRACTION_DOCUMENT_DEAD_LETTER = "extraction.dead_letter";

export async function enqueueExtractDocument(
  database: AuditDb,
  args: {
    patientId: string;
    payload: ExtractDocumentPayload;
  },
): Promise<void> {
  const wrapped: JobPayload<ExtractDocumentPayload> = {
    jobId: crypto.randomUUID(),
    patientId: args.patientId,
    correlationId: args.payload.uploadId,
    payload: args.payload,
    createdAt: new Date().toISOString(),
  };
  await database.execute(sql`
    INSERT INTO pgboss.job
      (name, data, retry_limit, retry_delay, retry_backoff, dead_letter)
    VALUES (
      'extraction.document',
      ${JSON.stringify(wrapped)}::jsonb,
      ${EXTRACTION_DOCUMENT_RETRY_LIMIT},
      ${EXTRACTION_DOCUMENT_RETRY_DELAY},
      ${EXTRACTION_DOCUMENT_RETRY_BACKOFF},
      ${EXTRACTION_DOCUMENT_DEAD_LETTER}
    )
  `);
}
