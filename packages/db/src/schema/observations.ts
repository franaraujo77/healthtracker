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
    // Story 2.3 R1-P102 — NULLABLE per Task 1 spec. The current
    // pipeline routes LOINC-unresolved fields to
    // `extraction_review_queue` so `observations` rows always have a
    // resolved code in practice — but the schema must allow NULL so
    // a future Story 2.4 patient-corrected path or operator
    // confirm-with-original-name can land a row with `loinc_code IS NULL`.
    loincCode: t.text(),
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
    /**
     * Story 2.7 — soft-delete for the BIA overwrite path (AC3). When
     * a patient overwrites a same-date+device manual BIA entry, the
     * prior rows are stamped with `deleted_at = now()`; the unique
     * index below is partial (`WHERE deleted_at IS NULL`) so the
     * re-insert with the same key succeeds. Future Fingerprint
     * consumers MUST filter `WHERE deleted_at IS NULL`.
     */
    deletedAt: t.timestamp({ mode: "date", withTimezone: true }),
  }),
  (table) => [
    // Story 2.3 — dedupes re-processing of the same extraction document.
    // R1-P199 — partial scope was widened to also exclude manual BIA
    // rows: every manual BIA shares `SENTINEL_UPLOAD_UUID`, so two
    // devices on the same day with the same LOINC (e.g. InBody + Tanita
    // both reporting body-fat %) would collide on this index. Manual
    // BIA has its own dedup (R1-P199's second index below) keyed on
    // `lab_name`, so excluding `source='manual_bia'` here is safe.
    //
    // Story 2.7 — partial `WHERE deleted_at IS NULL` so a soft-deleted
    // row doesn't block the new insert on the same key.
    uniqueIndex("observations_patient_upload_loinc_date_unique")
      .on(table.patientId, table.uploadId, table.loincCode, table.collectedAt)
      .where(
        sql`${table.deletedAt} IS NULL AND ${table.source} <> 'manual_bia'`,
      ),
    // R1-P199 — manual BIA dedup includes `lab_name` so two devices
    // on the same date don't collide. `writeBiaObservations` enforces
    // the same semantic at the application layer (SELECT-then-UPDATE);
    // this index is defense-in-depth against direct INSERTs.
    uniqueIndex("observations_manual_bia_patient_date_lab_loinc_unique")
      .on(table.patientId, table.collectedAt, table.labName, table.loincCode)
      .where(
        sql`${table.deletedAt} IS NULL AND ${table.source} = 'manual_bia'`,
      ),
    // Fingerprint query (Story 3.1+): "most recent observations per
    // patient, ordered by collection date desc".
    index("observations_patient_collected_idx").on(
      table.patientId,
      sql`${table.collectedAt} desc`,
    ),
  ],
);
