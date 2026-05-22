import type postgres from "postgres";

import type { RawExtractedField } from "../textract/adapter.js";
import { parseCollectedAt } from "../normalize/collected-at.js";
import { parseBrazilianDecimal } from "../normalize/decimal.js";
import { resolveLoincCode } from "../normalize/loinc.js";

/**
 * Story 2.3 — confidence gate + per-field dispatch.
 *
 * For each `RawExtractedField`:
 *   1. Normalize: decimal-comma → numeric; collected-at → Date;
 *      LOINC + UCUM via `loinc_ref` lookup.
 *   2. Branch on confidence + structural success:
 *      - `confidence >= 0.85` AND LOINC resolved AND value parsed →
 *        publish to `observations` (`source: 'extracted'`).
 *      - `confidence >= 0.01` AND (low confidence OR LOINC unresolved
 *        OR value unparseable OR date unparseable) → enqueue review
 *        queue entry with the matching `reason`.
 *      - `confidence < 0.01` → contribute to the dead-letter count;
 *        the document-consumer decides whether to dead-letter the
 *        whole upload based on the aggregate.
 *
 * Returns aggregate counts so the document-consumer can decide the
 * upload's terminal status (`complete` / `pending_review` / `failed`).
 *
 * Pure-ish: takes a postgres connection (for LOINC lookup) and a
 * worker `sql` connection for the row inserts. No state machine
 * transitions here — the consumer owns those.
 */

const CONFIDENCE_THRESHOLD = 0.85;
const DEAD_LETTER_THRESHOLD = 0.01;

export interface DispatchInput {
  uploadId: string;
  patientId: string;
  fields: RawExtractedField[];
}

export interface DispatchOutcome {
  publishedCount: number;
  reviewQueueCount: number;
  deadLetterCount: number;
}

/**
 * The worker `sql` (postgres-driver) handles both LOINC lookup AND
 * the row inserts. We don't go through Drizzle / `@healthtracker/api`'s
 * `writeObservation` here because the worker is on a separate
 * connection pool (direct, non-PgBouncer) — Drizzle would need its
 * own client wired to that connection. Story 2.3 keeps the worker
 * stack minimal: `postgres` driver + raw SQL for writes that mirror
 * the helper's contract.
 *
 * The SQL below stays in sync with `packages/api/src/observations.ts`'s
 * `writeObservation`. If that helper's shape changes, this SQL changes
 * too — flagged in the dev notes as a deliberate duplication.
 */
export async function dispatchExtractedFields(
  sql: postgres.Sql,
  input: DispatchInput,
): Promise<DispatchOutcome> {
  let publishedCount = 0;
  let reviewQueueCount = 0;
  let deadLetterCount = 0;

  for (const field of input.fields) {
    if (field.confidence < DEAD_LETTER_THRESHOLD) {
      deadLetterCount += 1;
      continue;
    }

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

    const lowConfidence = field.confidence < CONFIDENCE_THRESHOLD;
    const loincUnresolved = loinc === null;
    const structurallyBad = valueNumeric === null || collectedAt === null;

    if (lowConfidence || loincUnresolved || structurallyBad) {
      // Route to review queue. Choose `loinc_unresolved` when LOINC
      // is the failure; otherwise `low_confidence` (which doubles as
      // "structurally bad value / date" — Story 8.x may split the
      // enum if operators need finer triage).
      const reason: "low_confidence" | "loinc_unresolved" = loincUnresolved
        ? "loinc_unresolved"
        : "low_confidence";
      await sql`INSERT INTO extraction_review_queue
        (patient_id, upload_id, biomarker_name, value_text, unit_text,
         loinc_code, confidence_score, reason)
        VALUES (
          ${input.patientId}::uuid,
          ${input.uploadId}::uuid,
          ${field.biomarkerName},
          ${field.valueText},
          ${field.unitText ?? null},
          ${loinc?.loincCode ?? null},
          ${field.confidence},
          ${reason}::review_reason_enum
        )`;
      reviewQueueCount += 1;
      continue;
    }

    // Publish path. TS has narrowed `loinc` to non-null,
    // `valueNumeric` to number, and `collectedAt` to Date from the
    // prior `if (lowConfidence || loincUnresolved || structurallyBad)
    // continue;` guard above.
    const result = await sql`INSERT INTO observations
      (patient_id, upload_id, loinc_code, biomarker_name, value_numeric,
       unit_ucum, reference_range_low, reference_range_high, lab_name,
       collected_at, confidence_score, source)
      VALUES (
        ${input.patientId}::uuid,
        ${input.uploadId}::uuid,
        ${loinc.loincCode},
        ${field.biomarkerName},
        ${valueNumeric},
        ${loinc.unitUcum},
        ${refLow},
        ${refHigh},
        ${field.labName ?? null},
        ${collectedAt.toISOString().slice(0, 10)}::date,
        ${field.confidence},
        'extracted'::observation_source_enum
      )
      ON CONFLICT (patient_id, upload_id, loinc_code, collected_at)
      DO NOTHING
      RETURNING id`;
    if (result.length > 0) publishedCount += 1;
    // ON CONFLICT no-op (re-processed document): don't double-count;
    // the existing row already counted on the original run.
  }

  return { publishedCount, reviewQueueCount, deadLetterCount };
}

/** Exported for test assertions on the threshold constants. */
export const CONFIDENCE_GATE_THRESHOLD = CONFIDENCE_THRESHOLD;
export const DEAD_LETTER_FIELD_THRESHOLD = DEAD_LETTER_THRESHOLD;
