import type { SupabaseClient } from "@supabase/supabase-js";
import type { PgBoss } from "pg-boss";
import type postgres from "postgres";
import { createElement } from "react";
import { renderToBuffer } from "@react-pdf/renderer";

import type { JobPayload } from "@healthtracker/types";

import type {
  PdfBia,
  PdfObservation,
  PdfUpload,
  RecordExportPdfData,
} from "../pdf/RecordExportPdf.js";
import { RecordExportPdf } from "../pdf/RecordExportPdf.js";
import { EXPORTS_BUCKET, getSupabaseClient } from "../supabase.js";

interface GenerateExportPayload {
  exportId: string;
}

interface ExportRowDb {
  id: string;
  patient_id: string;
  format: "json" | "pdf";
  status: "queued" | "generating" | "ready" | "failed";
  /**
   * Story 5.5 review-fix Patch #4 — surfaces the resolver-side INSERT
   * time to the `record.exported` audit metadata (worker completion
   * time is misleading for the patient-facing Access Log).
   */
  requested_at: string;
}

interface ObservationDb {
  loinc_code: string | null;
  biomarker_name: string;
  value_numeric: string;
  unit_ucum: string;
  collected_at: string;
  lab_name: string | null;
  source: string;
  reference_range_low: string | null;
  reference_range_high: string | null;
}

interface UploadDb {
  id: string;
  created_at: string;
  source: string;
  status: string;
}

const RETRY_LIMIT = 3;
/**
 * UTF-8 BOM prefix on the JSON output (AC3 — "Excel-as-UTF-8 friendly").
 * Three bytes (encoded as a single U+FEFF code point at the string
 * level). Spelled as the escape sequence so ESLint doesn't flag the
 * literal as "irregular whitespace".
 */
const UTF8_BOM = "\uFEFF";

const JSON_SCHEMA_VERSION = "1.0.0";

/**
 * Story 5.5 AC8 — `record.export.generate` consumer. Mirrors the
 * structure of `generate-letter.ts` / `generate-conversation-starter.ts`:
 *
 *   - load the `exports` row + the patient's data,
 *   - serialize JSON (AC3) or render PDF (AC4) via react-pdf,
 *   - upload the artifact to the private `exports` bucket
 *     (`exports/{patient_id}/{export_id}.{format}`),
 *   - UPDATE `exports.status='ready'` + write the patient-actor
 *     `record.exported` audit row (Access Log surface) + the system-
 *     actor `export.generated` audit row, all inside one tx.
 *
 * Narrow catches per CLAUDE.md §"Narrow catches":
 *   - Postgres errors with `code` field (driver shape)
 *   - Error instances whose message matches network shapes
 * Programmer errors (TypeError / ReferenceError / SyntaxError) that
 * don't fit those rethrow so pg-boss retries surface the bug.
 *
 * After retry exhaustion: UPDATE `status='failed'` + audit
 * `export.failed`. Patient sees the AC2 failed state on next poll.
 */
export interface GenerateExportDeps {
  sql: postgres.Sql;
  supabase?: SupabaseClient;
  now?: () => Date;
}

export async function registerGenerateExportConsumer(
  boss: PgBoss,
  deps: GenerateExportDeps,
): Promise<void> {
  await boss.work<JobPayload<GenerateExportPayload>>(
    "record.export.generate",
    { localConcurrency: 2, batchSize: 1 },
    async (jobs) => {
      for (const job of jobs) {
        const { exportId } = job.data.payload;
        const rawRetrycount = (job as unknown as { retrycount?: unknown })
          .retrycount;
        const retrycount =
          typeof rawRetrycount === "number" ? rawRetrycount : 0;
        await processOne(deps, exportId, retrycount);
      }
    },
  );
}

export async function processOne(
  deps: GenerateExportDeps,
  exportId: string,
  retrycount: number,
): Promise<void> {
  const rows = await deps.sql<ExportRowDb[]>`
    SELECT id, patient_id, format, status, requested_at::text AS requested_at
    FROM exports
    WHERE id = ${exportId}::uuid
    LIMIT 1
  `;
  const row = rows[0];
  if (!row) {
    console.warn(
      `[record.export.generate] exportId=${exportId}: row missing — skipping`,
    );
    return;
  }
  if (row.status === "ready" || row.status === "failed") {
    console.log(
      `[record.export.generate] exportId=${exportId}: already ${row.status} — skipping`,
    );
    return;
  }

  await deps.sql`
    UPDATE exports
    SET status = 'generating'
    WHERE id = ${exportId}::uuid AND status = 'queued'
  `;

  // Track the uploaded object path so the failure paths can best-
  // effort delete it (Patch #3 — orphan cleanup). `null` means "no
  // upload happened yet" so we don't issue a delete against a path
  // that was never written.
  let uploadedObjectPath: string | null = null;
  const supabase = deps.supabase ?? getSupabaseClient();

  try {
    const artifact =
      row.format === "json"
        ? await buildJsonArtifact(deps.sql, row)
        : await buildPdfArtifact(deps.sql, row);

    const objectPath = `${row.patient_id}/${row.id}.${row.format}`;
    const { error: uploadErr } = await supabase.storage
      .from(EXPORTS_BUCKET)
      .upload(objectPath, artifact.bytes, {
        contentType:
          row.format === "json" ? "application/json" : "application/pdf",
        upsert: true,
      });
    if (uploadErr) {
      throw new Error(`storage.upload failed: ${uploadErr.message}`);
    }
    uploadedObjectPath = objectPath;

    try {
      await deps.sql.begin(async (tx) => {
        await tx`
          UPDATE exports
          SET status = 'ready',
              object_path = ${objectPath},
              file_size_bytes = ${artifact.bytes.byteLength},
              completed_at = now()
          WHERE id = ${exportId}::uuid
        `;
        // System-actor telemetry — operational. NOT in
        // ACCESS_LOG_EVENT_KINDS; the patient never sees this row.
        await tx`
          INSERT INTO audit_log
            (actor_id, actor_type, event, resource_id, resource_type, metadata)
          VALUES (
            ${row.patient_id}::uuid,
            'system',
            'export.generated',
            ${exportId}::uuid,
            'export',
            ${JSON.stringify({
              format: row.format,
              fileSizeBytes: artifact.bytes.byteLength,
            })}::jsonb
          )
        `;
        // Patient-actor surface (AC5 verbatim) — the Access Log row.
        // The patient's effective "I exported my record" event.
        // Story 5.5 review-fix Patch #4 — `requestedAt` is the
        // resolver INSERT timestamp loaded with the export row, NOT
        // the worker's completion clock.
        await tx`
          INSERT INTO audit_log
            (actor_id, actor_type, event, resource_id, resource_type, metadata)
          VALUES (
            ${row.patient_id}::uuid,
            'patient',
            'record.exported',
            ${exportId}::uuid,
            'export',
            ${JSON.stringify({
              format: row.format,
              requestedAt: row.requested_at,
            })}::jsonb
          )
        `;
      });
    } catch (txErr) {
      // Story 5.5 review-fix Patch #3 — tx failed AFTER the Storage
      // upload landed. Best-effort delete so we don't accumulate
      // orphaned blobs. Ignore the cleanup's own error (Storage may
      // be transiently unreachable too; the tx error is the one we
      // surface to pg-boss).
      await tryDeleteStorageObject(supabase, uploadedObjectPath);
      throw txErr;
    }
  } catch (err) {
    const isPgError =
      typeof err === "object" &&
      err !== null &&
      "code" in err &&
      typeof (err as { code?: unknown }).code === "string";
    const isNetworkError =
      err instanceof Error &&
      /ECONNRESET|ECONN|ETIMEDOUT|fetch failed|network|storage\.upload/i.test(
        err.message,
      );
    const recognized = isPgError || isNetworkError;

    console.error(
      `[record.export.generate] exportId=${exportId}: failure (retrycount=${retrycount}, recognized=${recognized})`,
      err,
    );

    // Story 5.5 review-fix Patch #2 — on the FINAL attempt we persist
    // `failed` + emit the `export.failed` audit row regardless of
    // error recognition. Previously unrecognised shapes
    // (TypeError/ReferenceError/SyntaxError) re-threw on every
    // attempt including the last, leaving the row stuck at `queued`
    // forever. Sentry still sees the rethrow on programmer errors.
    if (retrycount + 1 < RETRY_LIMIT) {
      // Earlier attempts — revert queued→generating so the next
      // retry re-enters the happy path. Storage cleanup on the
      // upload-success-then-tx-failed branch already happened above.
      await deps.sql`
        UPDATE exports
        SET status = 'queued'
        WHERE id = ${exportId}::uuid AND status = 'generating'
      `;
      throw err;
    }

    // Final attempt — terminal failure. Clean the orphan if we got
    // far enough to upload, then persist `failed` + audit, then
    // rethrow (so pg-boss + Sentry record the underlying error).
    if (uploadedObjectPath !== null) {
      await tryDeleteStorageObject(supabase, uploadedObjectPath);
    }
    const reason = isPgError
      ? "DB_ERROR"
      : isNetworkError
        ? "NETWORK_ERROR"
        : "INTERNAL_ERROR";
    await deps.sql.begin(async (tx) => {
      await tx`
        UPDATE exports
        SET status = 'failed',
            failure_reason = ${reason}
        WHERE id = ${exportId}::uuid
      `;
      await tx`
        INSERT INTO audit_log
          (actor_id, actor_type, event, resource_id, resource_type, metadata)
        VALUES (
          ${row.patient_id}::uuid,
          'system',
          'export.failed',
          ${exportId}::uuid,
          'export',
          ${JSON.stringify({ format: row.format, reason })}::jsonb
        )
      `;
    });
    throw err;
  }
}

/**
 * Story 5.5 review-fix Patch #3 — best-effort delete. Swallows the
 * Storage delete error (cleanup is opportunistic; the caller already
 * has a more interesting error to surface).
 */
async function tryDeleteStorageObject(
  supabase: SupabaseClient,
  objectPath: string,
): Promise<void> {
  try {
    await supabase.storage.from(EXPORTS_BUCKET).remove([objectPath]);
  } catch (cleanupErr) {
    console.warn(
      `[record.export.generate] orphan cleanup failed for ${objectPath}`,
      cleanupErr,
    );
  }
}

interface ArtifactBytes {
  bytes: Buffer;
}

export async function buildJsonArtifact(
  sql: postgres.Sql,
  row: ExportRowDb,
): Promise<ArtifactBytes> {
  const observations = await loadObservations(sql, row.patient_id);
  const uploads = await loadUploads(sql, row.patient_id);
  const { extracted, bia } = splitObservations(observations);

  const payload = {
    schemaVersion: JSON_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    patient: { id: row.patient_id }, // UUID only — NO PII (AC3).
    observations: extracted.map((o) => ({
      loincCode: o.loinc_code,
      biomarkerName: o.biomarker_name,
      valueNumeric: parseNumericOrNull(o.value_numeric),
      unitUcum: o.unit_ucum,
      collectedAt: o.collected_at,
      labName: o.lab_name,
      sourceType: o.source,
    })),
    bia: bia.map((b) => ({
      collectedAt: b.collected_at,
      biomarkerName: b.biomarker_name,
      valueNumeric: parseNumericOrNull(b.value_numeric),
      unitUcum: b.unit_ucum,
      labName: b.lab_name,
    })),
    uploads: uploads.map((u) => ({
      id: u.id,
      uploadedAt: u.created_at,
      sourceType: u.source,
      status: u.status,
    })),
    // Epic 7 placeholder — Story 5.5 ships an empty array slot.
    lifeEvents: [] as unknown[],
  };

  const text = UTF8_BOM + JSON.stringify(payload, null, 2);
  return { bytes: Buffer.from(text, "utf8") };
}

export async function buildPdfArtifact(
  sql: postgres.Sql,
  row: ExportRowDb,
): Promise<ArtifactBytes> {
  const observations = await loadObservations(sql, row.patient_id);
  const uploads = await loadUploads(sql, row.patient_id);
  const { extracted, bia } = splitObservations(observations);

  const data: RecordExportPdfData = {
    patientId: row.patient_id,
    generatedAt: new Date().toISOString(),
    observations: extracted.map(
      (o): PdfObservation => ({
        loincCode: o.loinc_code,
        biomarkerName: o.biomarker_name,
        valueNumeric: Number(o.value_numeric),
        unitUcum: o.unit_ucum,
        collectedAt: o.collected_at,
        labName: o.lab_name,
        referenceRangeLow:
          o.reference_range_low !== null ? Number(o.reference_range_low) : null,
        referenceRangeHigh:
          o.reference_range_high !== null
            ? Number(o.reference_range_high)
            : null,
      }),
    ),
    bia: bia.map(
      (b): PdfBia => ({
        collectedAt: b.collected_at,
        biomarkerName: b.biomarker_name,
        valueNumeric: Number(b.value_numeric),
        unitUcum: b.unit_ucum,
        labName: b.lab_name,
      }),
    ),
    uploads: uploads.map(
      (u): PdfUpload => ({
        id: u.id,
        uploadedAt: u.created_at,
        sourceType: u.source,
        status: u.status,
      }),
    ),
  };

  // `renderToBuffer` types narrow the root element to
  // `ReactElement<DocumentProps>`. Our component returns a
  // `<Document>` root but TS only sees the wrapping function-component
  // props (the `data` prop). Cast through `unknown` is the canonical
  // workaround used in the react-pdf docs for server-side render of
  // wrapped components.
  const element = createElement(RecordExportPdf, {
    data,
  }) as unknown as Parameters<typeof renderToBuffer>[0];
  const bytes = await renderToBuffer(element);
  return { bytes };
}

async function loadObservations(
  sql: postgres.Sql,
  patientId: string,
): Promise<ObservationDb[]> {
  // Story 5.5 review-fix Decision B — LEFT JOIN `loinc_ref` so the
  // canonical pt-BR biomarker name wins when the LOINC code resolves.
  // `loinc_ref.biomarker_name_pt` is the actual column (verified in
  // `packages/db/src/schema/loinc_ref.ts`). Falls back to the
  // extraction-time `observations.biomarker_name` when the LOINC code
  // isn't in the seeded top-20 set (or is null).
  return await sql<ObservationDb[]>`
    SELECT
      observations.loinc_code,
      coalesce(lr.biomarker_name_pt, observations.biomarker_name) AS biomarker_name,
      observations.value_numeric::text AS value_numeric,
      observations.unit_ucum,
      to_char(observations.collected_at, 'YYYY-MM-DD') AS collected_at,
      observations.lab_name,
      observations.source::text AS source,
      observations.reference_range_low::text AS reference_range_low,
      observations.reference_range_high::text AS reference_range_high
    FROM observations
    LEFT JOIN loinc_ref lr ON lr.loinc_code = observations.loinc_code
    WHERE observations.patient_id = ${patientId}::uuid
      AND observations.deleted_at IS NULL
    ORDER BY observations.collected_at DESC, biomarker_name ASC
  `;
}

async function loadUploads(
  sql: postgres.Sql,
  patientId: string,
): Promise<UploadDb[]> {
  return await sql<UploadDb[]>`
    SELECT id, created_at::text AS created_at, source::text AS source, status::text AS status
    FROM uploads
    WHERE patient_id = ${patientId}::uuid
    ORDER BY created_at DESC
  `;
}

/**
 * Story 5.5 review-fix Patch #7 — parse the `::text`-coerced numeric
 * back into a JS number with explicit NaN handling. Contract:
 *   - JSON exports emit `valueNumeric: <number>` when the column
 *     round-trips through `Number(...)` to a finite value.
 *   - Non-numeric / NULL / NaN sources emit `valueNumeric: null`
 *     (JSON.stringify on NaN already coerces to `null`; making it
 *     explicit here documents the contract for downstream consumers).
 * High-precision decimals lose digits at the JS-Number boundary; the
 * `value_numeric` column is `numeric(N, M)` so the loss is bounded by
 * the schema. A future revision can switch to string-preserving
 * payload if a consumer hits the precision ceiling.
 */
function parseNumericOrNull(raw: string | null): number | null {
  if (raw === null || raw === "") return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Story 2.7 leaves BIA inside `observations` with `source = 'manual_bia'`.
 * No standalone `bia` table exists today (verified at Story 5.5 dev
 * time). When a dedicated `bia` table lands, this split becomes a
 * direct query — schema slot doesn't change.
 */
function splitObservations(rows: ObservationDb[]): {
  extracted: ObservationDb[];
  bia: ObservationDb[];
} {
  const extracted: ObservationDb[] = [];
  const bia: ObservationDb[] = [];
  for (const r of rows) {
    if (r.source === "manual_bia") bia.push(r);
    else extracted.push(r);
  }
  return { extracted, bia };
}
