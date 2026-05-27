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
    SELECT id, patient_id, format, status
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

  try {
    const artifact =
      row.format === "json"
        ? await buildJsonArtifact(deps.sql, row)
        : await buildPdfArtifact(deps.sql, row);

    const supabase = deps.supabase ?? getSupabaseClient();
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
            requestedAt: (deps.now?.() ?? new Date()).toISOString(),
          })}::jsonb
        )
      `;
    });
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
    if (!isPgError && !isNetworkError) {
      // Unrecognised shape — revert the queued→generating UPDATE so
      // the next retry re-enters the happy path (Story 4.1 F6
      // precedent in `generate-letter.ts`).
      await deps.sql`
        UPDATE exports
        SET status = 'queued'
        WHERE id = ${exportId}::uuid AND status = 'generating'
      `;
      throw err;
    }

    console.error(
      `[record.export.generate] exportId=${exportId}: failure (retrycount=${retrycount})`,
      err,
    );

    // Only persist `failed` on the final attempt — earlier attempts
    // rethrow so pg-boss actually retries. Story 5.2 R1-P6 pattern.
    if (retrycount + 1 < RETRY_LIMIT) {
      await deps.sql`
        UPDATE exports
        SET status = 'queued'
        WHERE id = ${exportId}::uuid AND status = 'generating'
      `;
      throw err;
    }

    const reason = isPgError ? "DB_ERROR" : "NETWORK_ERROR";
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
      valueNumeric: Number(o.value_numeric),
      unitUcum: o.unit_ucum,
      collectedAt: o.collected_at,
      labName: o.lab_name,
      sourceType: o.source,
    })),
    bia: bia.map((b) => ({
      collectedAt: b.collected_at,
      biomarkerName: b.biomarker_name,
      valueNumeric: Number(b.value_numeric),
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
  return await sql<ObservationDb[]>`
    SELECT
      loinc_code,
      biomarker_name,
      value_numeric::text AS value_numeric,
      unit_ucum,
      to_char(collected_at, 'YYYY-MM-DD') AS collected_at,
      lab_name,
      source::text AS source,
      reference_range_low::text AS reference_range_low,
      reference_range_high::text AS reference_range_high
    FROM observations
    WHERE patient_id = ${patientId}::uuid AND deleted_at IS NULL
    ORDER BY collected_at DESC, biomarker_name ASC
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
