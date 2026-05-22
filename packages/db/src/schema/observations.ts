import { sql } from "drizzle-orm";
import { index, pgEnum, pgTable, uniqueIndex } from "drizzle-orm/pg-core";

/**
 * Story 2.3 — `observations` schema (replaces the Story 1.5-era stub).
 *
 * Stores LOINC-normalized biomarker measurements per patient. Rows
 * originate from one of three sources (Story 2.3 ships `'extracted'`
 * only; Story 2.4 adds `'patient_corrected'`; Story 2.7 adds
 * `'manual_bia'`).
 *
 * Append-only at the patient layer:
 *   - SELECT own (RLS, custom_rls_observations.sql)
 *   - NO patient-facing INSERT / UPDATE / DELETE — writes come from
 *     the extraction worker via service-role connection (mirrors
 *     `uploads` from Story 1.5).
 *
 * Every `observations` row has a resolved `loinc_code` — when LOINC
 * resolution fails the field goes to `extraction_review_queue`
 * (Story 8.1 ops surface), not here.
 */
export const observationSourceEnum = pgEnum("observation_source_enum", [
  "extracted",
  "manual_bia",
  "patient_corrected",
]);

export const Observations = pgTable(
  "observations",
  (t) => ({
    id: t.uuid().notNull().primaryKey().defaultRandom(),
    patientId: t.uuid().notNull(),
    uploadId: t.uuid().notNull(),
    loincCode: t.text().notNull(),
    biomarkerName: t.text().notNull(),
    valueNumeric: t.numeric().notNull(),
    unitUcum: t.text().notNull(),
    referenceRangeLow: t.numeric(),
    referenceRangeHigh: t.numeric(),
    labName: t.text(),
    collectedAt: t.date().notNull(),
    confidenceScore: t.numeric().notNull(),
    source: observationSourceEnum("source").notNull(),
    createdAt: t
      .timestamp({ mode: "date", withTimezone: true })
      .defaultNow()
      .notNull(),
  }),
  (table) => [
    // Story 2.3 — dedupes re-processing of the same document. If the
    // extraction worker re-runs (idempotency replay, dead-letter
    // retry), the same (patient, upload, loinc, date) combination
    // hits ON CONFLICT and the `writeObservation` helper returns null.
    uniqueIndex("observations_patient_upload_loinc_date_unique").on(
      table.patientId,
      table.uploadId,
      table.loincCode,
      table.collectedAt,
    ),
    // Fingerprint query (Story 3.1+): "most recent observations per
    // patient, ordered by collection date desc".
    index("observations_patient_collected_idx").on(
      table.patientId,
      sql`${table.collectedAt} desc`,
    ),
  ],
);
