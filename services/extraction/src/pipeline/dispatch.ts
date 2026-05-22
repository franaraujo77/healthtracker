import type postgres from "postgres";

import type { RawExtractedField } from "../textract/adapter.js";
import { parseCollectedAt } from "../normalize/collected-at.js";
import { parseBrazilianDecimal } from "../normalize/decimal.js";
import { resolveLoincCode } from "../normalize/loinc.js";

/**
 * Story 2.3 — confidence gate + per-field dispatch.
 *
 * For each `RawExtractedField`:
 *   1. Validate confidence is finite + in `[0, 1]` (R1-P99 — buggy
 *      adapter output gets routed to review queue, not silently
 *      published or silently dropped).
 *   2. Normalize: decimal-comma → numeric; collected-at → Date;
 *      LOINC + UCUM via `loinc_ref` lookup.
 *   3. Branch:
 *      - `confidence >= 0.85` AND LOINC resolved AND value parsed AND
 *        date parsed → publish to `observations` (`source: 'extracted'`).
 *      - Anything else → write to `extraction_review_queue` with the
 *        matching `reason`. (R1-P100: no silent per-field drop; every
 *        field is either published or routed to review.)
 *   4. The consumer dead-letters the upload only when
 *      `publishedCount === 0 && reviewQueueCount === 0` OR when
 *      `fields.length === 0`.
 *
 * Returns aggregate counts + the list of published observation ids so
 * the consumer can emit `observation.write` audit events (R1-P93).
 *
 * R1-P109 — wrap the per-upload work in `sql.begin(async tx => { ... })`
 * at the consumer layer so all-or-nothing per upload (mid-batch DB
 * error leaves no partial state).
 *
 * R1-P94 — the worker writes raw SQL (NOT the API helpers
 * `writeObservation` / `writeReviewQueueEntry`) because the worker
 * uses the `postgres` driver on a direct connection while the helpers
 * are Drizzle-bound to `@vercel/postgres`. The deviation is documented
 * in the spec scope guardrails; the SQL shape must stay in sync with
 * the helpers (R1-P110 ships a snapshot-style sync test).
 */

const CONFIDENCE_THRESHOLD = 0.85;

export interface DispatchInput {
  uploadId: string;
  patientId: string;
  fields: RawExtractedField[];
}

export interface DispatchOutcome {
  publishedCount: number;
  reviewQueueCount: number;
  /** R1-P93 — observation ids the consumer must audit-emit for. */
  publishedObservationIds: string[];
}

function normalizeWhitespace(value: string | undefined): string | null {
  if (value === undefined) return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

// Accept either a top-level `Sql` or a `TransactionSql` (returned by
// `sql.begin(async tx => ...)`). The two share the tagged-template
// shape we use; widening this signature lets the consumer call
// dispatch from inside the per-upload transaction wrapper.
type WorkerSql = postgres.Sql | postgres.TransactionSql;

export async function dispatchExtractedFields(
  sql: WorkerSql,
  input: DispatchInput,
): Promise<DispatchOutcome> {
  let publishedCount = 0;
  let reviewQueueCount = 0;
  const publishedObservationIds: string[] = [];

  for (const field of input.fields) {
    // R1-P99 — bounds + NaN guard. NaN compares always false, so an
    // unguarded NaN would slip past `< 0.85` and `>= 0.01` checks.
    const confidenceOk =
      Number.isFinite(field.confidence) &&
      field.confidence >= 0 &&
      field.confidence <= 1;
    const effectiveConfidence = confidenceOk ? field.confidence : 0;

    const valueNumeric = parseBrazilianDecimal(field.valueText);
    const refLow = field.referenceRangeLowText
      ? parseBrazilianDecimal(field.referenceRangeLowText)
      : null;
    const refHigh = field.referenceRangeHighText
      ? parseBrazilianDecimal(field.referenceRangeHighText)
      : null;
    const collectedAt = field.collectedAtText
      ? parseCollectedAt(field.collectedAtText)
      : null;
    const loinc = await resolveLoincCode(sql, field.biomarkerName);

    const lowConfidence = effectiveConfidence < CONFIDENCE_THRESHOLD;
    const loincUnresolved = loinc === null;
    const structurallyBad = valueNumeric === null || collectedAt === null;

    if (lowConfidence || loincUnresolved || structurallyBad) {
      // R1-P100 — route EVERY non-publishable field to the review
      // queue. No silent per-field drops. The reason discriminator
      // prefers LOINC-unresolved (since that's the most actionable
      // operator hint); structural failures collapse into
      // `low_confidence` (F111 deferred for a finer enum).
      const reason: "low_confidence" | "loinc_unresolved" = loincUnresolved
        ? "loinc_unresolved"
        : "low_confidence";
      // R1-P101 — stringify numerics to match the API helper's
      // serialization (`String(valueNumeric)` etc.). Avoids
      // binary-float precision artifacts at `0.85`-class boundaries.
      // R1-P105 — empty-string units/labName → null (`?? null` only
      // triggers on undefined; the OR-then-null pattern treats empty
      // and whitespace-only as missing).
      await sql`INSERT INTO extraction_review_queue
        (patient_id, upload_id, biomarker_name, value_text, unit_text,
         loinc_code, confidence_score, reason)
        VALUES (
          ${input.patientId}::uuid,
          ${input.uploadId}::uuid,
          ${field.biomarkerName.trim()},
          ${field.valueText},
          ${normalizeWhitespace(field.unitText)},
          ${loinc?.loincCode ?? null},
          ${String(effectiveConfidence)}::numeric,
          ${reason}::review_reason_enum
        )`;
      reviewQueueCount += 1;
      continue;
    }

    // Publish path. TS has narrowed `loinc`, `valueNumeric`,
    // `collectedAt` to non-null from the guard above.
    const result = await sql<{ id: string }[]>`INSERT INTO observations
      (patient_id, upload_id, loinc_code, biomarker_name, value_numeric,
       unit_ucum, reference_range_low, reference_range_high, lab_name,
       collected_at, confidence_score, source)
      VALUES (
        ${input.patientId}::uuid,
        ${input.uploadId}::uuid,
        ${loinc.loincCode},
        ${field.biomarkerName.trim()},
        ${String(valueNumeric)}::numeric,
        ${loinc.unitUcum},
        ${refLow !== null ? String(refLow) : null}::numeric,
        ${refHigh !== null ? String(refHigh) : null}::numeric,
        ${normalizeWhitespace(field.labName)},
        ${collectedAt.toISOString().slice(0, 10)}::date,
        ${String(effectiveConfidence)}::numeric,
        'extracted'::observation_source_enum
      )
      ON CONFLICT (patient_id, upload_id, loinc_code, collected_at)
      DO NOTHING
      RETURNING id`;
    const row = result[0];
    if (row) {
      publishedCount += 1;
      publishedObservationIds.push(row.id);
    }
    // ON CONFLICT no-op (re-processed document): don't double-count
    // or re-audit; the existing row's audit row was emitted on the
    // original run.
  }

  return { publishedCount, reviewQueueCount, publishedObservationIds };
}

export const CONFIDENCE_GATE_THRESHOLD = CONFIDENCE_THRESHOLD;

// Re-exported for the snapshot sync test (R1-P110): expose the bare
// templated SQL shape so a test can normalize-and-compare against the
// API helper's expected output.
export const OBSERVATIONS_INSERT_SQL_SHAPE = `INSERT INTO observations
  (patient_id, upload_id, loinc_code, biomarker_name, value_numeric,
   unit_ucum, reference_range_low, reference_range_high, lab_name,
   collected_at, confidence_score, source)
  VALUES (...)
  ON CONFLICT (patient_id, upload_id, loinc_code, collected_at)
  DO NOTHING
  RETURNING id`;

/** Helper passthrough — exported so a future caller / test can reuse. */
export { normalizeWhitespace as _normalizeWhitespaceForTests };
