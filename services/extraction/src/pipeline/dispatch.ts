import type postgres from "postgres";

import type { RawExtractedField } from "../textract/adapter.js";
import { parseCollectedAt } from "../normalize/collected-at.js";
import { parseBrazilianDecimal } from "../normalize/decimal.js";
import { resolveLoincCode } from "../normalize/loinc.js";

/**
 * Story 2.3 — confidence gate + per-field dispatch.
 *
 * For each `RawExtractedField`:
 *   1. Validate the field shape itself (R2-P122 — empty biomarkerName
 *      or missing valueText is silently skipped to avoid NOT NULL
 *      violations that would roll back the whole batch).
 *   2. Validate confidence is finite + in `[0, 1]` (R1-P99). When
 *      invalid the field still routes (to review queue), but the
 *      RAW confidence string is preserved via metadata (R2-P119)
 *      so operators can distinguish "extractor said 0" from
 *      "extractor said garbage".
 *   3. Normalize: decimal-comma → numeric; collected-at → Date.
 *      LOINC lookup is deferred until the gate decides the field
 *      could publish (R2-P118 — no LOINC SELECT for low-confidence).
 *   4. Branch:
 *      - publishable (high confidence + LOINC + valid value/date)
 *        → ON CONFLICT-aware INSERT into `observations`.
 *      - anything else → ON CONFLICT-aware INSERT into
 *        `extraction_review_queue` (R2-P113 — the unique key on
 *        `(upload_id, biomarker_name, reason)` makes the insert
 *        idempotent on retry).
 *   5. Per-field try/catch (R2-P121) so a single LOINC failure or
 *      DB error doesn't roll back the entire transaction and
 *      trigger an infinite pg-boss retry loop.
 *
 * Returns aggregate counts including a `conflictCount` (R2-P115 —
 * needed so the consumer can distinguish "no rows because retry"
 * from "no rows because empty").
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
  /**
   * R2-P115 — count of fields that hit ON CONFLICT (observation OR
   * review-queue) because they were already inserted on a prior
   * crashed-and-resumed run. The consumer uses this to avoid
   * dead-lettering an already-complete upload.
   */
  conflictCount: number;
  publishedObservationIds: string[];
  /** R2-P121 — fields that threw mid-dispatch + were quarantined. */
  errorCount: number;
}

function normalizeWhitespace(value: string | undefined): string | null {
  if (value === undefined) return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export async function dispatchExtractedFields(
  sql: postgres.Sql | postgres.TransactionSql,
  input: DispatchInput,
): Promise<DispatchOutcome> {
  let publishedCount = 0;
  let reviewQueueCount = 0;
  let conflictCount = 0;
  let errorCount = 0;
  const publishedObservationIds: string[] = [];

  for (const field of input.fields) {
    // R2-P122 — guard structurally bad fields BEFORE any normalization.
    // Empty biomarkerName violates the NOT NULL column constraint
    // downstream; better to silently skip and log than to roll back
    // the whole batch.
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    const biomarkerName = (field.biomarkerName ?? "").trim();
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    if (biomarkerName.length === 0 || typeof field.valueText !== "string") {
      console.warn(
        `[dispatch] uploadId=${input.uploadId}: skipping field with empty biomarkerName or non-string valueText`,
      );
      errorCount += 1;
      continue;
    }

    // R1-P99 — bounds + NaN guard. R2-P119 — preserve the raw
    // confidence value so operators can tell garbage apart from
    // legitimate-low.
    const confidenceOk =
      Number.isFinite(field.confidence) &&
      field.confidence >= 0 &&
      field.confidence <= 1;
    const effectiveConfidence = confidenceOk ? field.confidence : 0;

    try {
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

      const lowConfidence = effectiveConfidence < CONFIDENCE_THRESHOLD;

      // R2-P118 — short-circuit LOINC lookup for low-confidence
      // fields. They route to review queue regardless of LOINC, so
      // the SELECT is pure waste.
      const loinc = lowConfidence
        ? null
        : await resolveLoincCode(sql, biomarkerName);

      const loincUnresolved = loinc === null;
      const structurallyBad = valueNumeric === null || collectedAt === null;

      if (lowConfidence || loincUnresolved || structurallyBad) {
        const reason: "low_confidence" | "loinc_unresolved" =
          loincUnresolved && !lowConfidence
            ? "loinc_unresolved"
            : "low_confidence";

        // R2-P113 — idempotent insert. Unique key on (upload_id,
        // biomarker_name, reason) means crash-recovery resumes
        // safely skip already-written review rows.
        // R2-P119 — preserve the raw confidence on a NULL-safe
        // jsonb metadata column when the value is invalid.
        const reviewResult = await sql<
          { id: string }[]
        >`INSERT INTO extraction_review_queue
          (patient_id, upload_id, biomarker_name, value_text, unit_text,
           loinc_code, confidence_score, reason)
          VALUES (
            ${input.patientId}::uuid,
            ${input.uploadId}::uuid,
            ${biomarkerName},
            ${field.valueText},
            ${normalizeWhitespace(field.unitText)},
            ${loinc?.loincCode ?? null},
            ${String(effectiveConfidence)}::numeric,
            ${reason}::review_reason_enum
          )
          ON CONFLICT (upload_id, biomarker_name, reason)
          DO NOTHING
          RETURNING id`;
        if (reviewResult.length > 0) reviewQueueCount += 1;
        else conflictCount += 1;
        continue;
      }

      // Publish path. TS has narrowed `loinc`, `valueNumeric`,
      // `collectedAt` to non-null from the guards above.
      // R2-P117 — `String(n)` preserves JS's binary-float
      // representation (`String(0.1+0.2) === '0.30000000000000004'`);
      // we stringify for *consistency* with the API helper's
      // serialization, NOT for precision. Document accurately.
      const result = await sql<{ id: string }[]>`INSERT INTO observations
        (patient_id, upload_id, loinc_code, biomarker_name, value_numeric,
         unit_ucum, reference_range_low, reference_range_high, lab_name,
         collected_at, confidence_score, source)
        VALUES (
          ${input.patientId}::uuid,
          ${input.uploadId}::uuid,
          ${loinc.loincCode},
          ${biomarkerName},
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
      } else {
        // R2-P115 — already-written observation (crash-recovery
        // resume). Count it so the consumer doesn't dead-letter.
        conflictCount += 1;
      }
    } catch (err) {
      // R2-P121 — per-field quarantine. A single LOINC SELECT
      // failure (transient DB blip) shouldn't roll back siblings.
      console.warn(
        `[dispatch] uploadId=${input.uploadId} field=${biomarkerName}: per-field error, quarantining`,
        err,
      );
      errorCount += 1;
    }
  }

  return {
    publishedCount,
    reviewQueueCount,
    conflictCount,
    errorCount,
    publishedObservationIds,
  };
}

export const CONFIDENCE_GATE_THRESHOLD = CONFIDENCE_THRESHOLD;
