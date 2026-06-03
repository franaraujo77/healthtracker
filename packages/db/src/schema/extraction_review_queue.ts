import { pgEnum, pgTable, uniqueIndex } from "drizzle-orm/pg-core";

import { Users } from "./users";

/**
 * Story 2.3 — operator-only review queue for extracted fields that
 * fail the confidence gate (`< 0.85`) or fail LOINC resolution.
 *
 * Story 2.4 — patient-facing surface for `reason = 'low_confidence'`
 * rows: the patient confirms or corrects the extracted value; the
 * helper writes the resulting observation, marks the row resolved
 * (`resolved_at`, `resolved_by_patient_id`, `correction_metadata`).
 * `reason = 'loinc_unresolved'` remains operator-only (Story 8.1).
 *
 * RLS: see `custom_rls_extraction_review_queue.sql`. Patients SELECT
 * + UPDATE their own `low_confidence` rows; the Story 8.1 operator role
 * SELECTs `loinc_unresolved` rows (anonymised — `lab_name` below removes
 * the need to join `uploads`); service-role retains full access; doctors
 * / anon have no access.
 */
export const reviewReasonEnum = pgEnum("review_reason_enum", [
  "low_confidence",
  "loinc_unresolved",
]);

/**
 * Story 8.2 — closed set of operator rejection reasons. pt-BR labels live
 * in `packages/validators/src/operator.ts` (greppable-copy discipline).
 */
export const rejectionReasonEnum = pgEnum("rejection_reason_enum", [
  "decimal_separator",
  "illegible",
  "wrong_unit",
]);

export const ExtractionReviewQueue = pgTable(
  "extraction_review_queue",
  (t) => ({
    id: t.uuid().notNull().primaryKey().defaultRandom(),
    // Story 5.6 FK cascade audit.
    patientId: t
      .uuid()
      .notNull()
      .references(() => Users.id, { onDelete: "cascade" }),
    uploadId: t.uuid().notNull(),
    biomarkerName: t.text().notNull(),
    /** Original textual value from the source, NOT parsed. */
    valueText: t.text().notNull(),
    unitText: t.text(),
    loincCode: t.text(),
    /**
     * Story 8.1 — denormalised lab name (from the field's source) so the
     * operator review queue can render the lab without ever joining
     * `uploads` (whose `original_filename` can carry patient PII). The
     * operator RLS principal has zero read access to `uploads`/`users`;
     * this column keeps the anonymisation boundary at the RLS layer.
     * NULL for rows written before Story 8.1.
     */
    labName: t.text(),
    /**
     * Story 2.4 — the original `collected_at` text from the source
     * (the worker carries it through unparsed so the patient confirm
     * path can publish the observation with the lab's draw date,
     * not the upload date). Nullable when the source had no date.
     */
    collectedAtText: t.text(),
    confidenceScore: t.numeric().notNull(),
    reason: reviewReasonEnum("reason").notNull(),
    createdAt: t
      .timestamp({ mode: "date", withTimezone: true })
      .defaultNow()
      .notNull(),
    resolvedAt: t.timestamp({ mode: "date", withTimezone: true }),
    /** Story 2.4 — patient who resolved the row (null if operator-resolved or unresolved). */
    resolvedByPatientId: t.uuid(),
    /**
     * Story 8.2 — operator who resolved the row (confirm OR reject); null
     * if patient-resolved or unresolved. Bare uuid, NO FK (mirrors
     * `resolvedByPatientId`): the operator's account deletion must not
     * cascade-delete the patient's review row — a bare uuid sidesteps the
     * FK-cascade rule entirely.
     */
    resolvedByOperatorId: t.uuid(),
    /**
     * Story 8.2 — set when an OPERATOR rejects the field. `rejection_reason
     * IS NOT NULL` is the discriminator for a rejected row; a resolved row
     * with `rejection_reason IS NULL` + `resolved_by_operator_id IS NOT
     * NULL` is operator-confirmed (published to `observations`).
     */
    rejectionReason: rejectionReasonEnum("rejection_reason"),
    /**
     * Story 2.4 — when the patient EDITED the extracted value, the
     * original textual value + the patient's numeric override are
     * preserved here for audit. NULL when the patient confirmed-as-is.
     */
    correctionMetadata: t.jsonb().$type<{
      patientValue: number;
      originalValueText: string;
      correctedAt: string;
    }>(),
  }),
  (table) => [
    // R2-P113 — idempotency seam for crash-recovery resume. Without
    // this, R1-P95's resume path duplicates review-queue rows when
    // the prior run committed dispatch but crashed before the
    // terminal UPDATE. The 3-column key matches the dedup contract
    // the operator UI assumes.
    uniqueIndex("extraction_review_queue_upload_biomarker_reason_unique").on(
      table.uploadId,
      table.biomarkerName,
      table.reason,
    ),
  ],
);
