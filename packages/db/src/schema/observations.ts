import { sql } from "drizzle-orm";
import { index, pgEnum, pgTable, uniqueIndex } from "drizzle-orm/pg-core";

import { Users } from "./users";

/**
 * Story 2.3 — `observations` schema (replaces the Story 1.5-era stub).
 *
 * Stores LOINC-normalized biomarker measurements per patient. Rows
 * originate from one of four sources (Story 2.3 ships `'extracted'`
 * only; Story 2.4 adds `'patient_corrected'`; Story 2.7 adds
 * `'manual_bia'`; Story 8.2 adds `'operator_confirmed'` — an operator
 * blessed a `loinc_unresolved` field, so `loinc_code` stays NULL).
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
  "operator_confirmed",
]);

export const Observations = pgTable(
  "observations",
  (t) => ({
    id: t.uuid().notNull().primaryKey().defaultRandom(),
    // Story 5.6 FK cascade audit — `users(id)` cascades through
    // `patient_id` (LGPD Art. 18 right-to-erasure).
    patientId: t
      .uuid()
      .notNull()
      .references(() => Users.id, { onDelete: "cascade" }),
    /**
     * Epic 2 retro F162 — NULLABLE. Manual BIA submissions (Story 2.7)
     * have no source upload; previously these rows used
     * `SENTINEL_UPLOAD_UUID = '00000000-…'`, which conflated "no
     * upload" with a real UUID and forced the partial unique index
     * to discriminate on `source <> 'manual_bia'` (an indirect
     * proxy for "extracted-style rows only"). With this column
     * nullable, manual BIA writes pass `null` directly and the
     * non-manual partial index uses `upload_id IS NOT NULL` as the
     * clean discriminator.
     *
     * **Ops note:** changing this column from NOT NULL to NULL is a
     * trivial `ALTER TABLE … ALTER COLUMN upload_id DROP NOT NULL`,
     * safe via `pnpm db:push`. The accompanying partial-index
     * WHERE-clause change (`source <> 'manual_bia'` → `upload_id IS
     * NOT NULL`) is NOT db:push-safe in prod per CLAUDE.md; apply
     * via `CREATE UNIQUE INDEX CONCURRENTLY` + `DROP INDEX
     * CONCURRENTLY` in a migration when this lands against a
     * non-empty production database.
     */
    uploadId: t.uuid(),
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
    // R1-P199 — partial scope was widened to exclude manual BIA rows
    // (they shared `SENTINEL_UPLOAD_UUID`, which would have collided
    // two devices on the same day + same LOINC under this index).
    // Manual BIA has its own dedup (next index) keyed on `lab_name`.
    //
    // Epic 2 retro F162 — discriminator is now `upload_id IS NOT NULL`
    // since manual BIA rows write `upload_id = NULL` (no source upload)
    // rather than the sentinel. Equivalent in semantics; cleaner intent.
    //
    // Story 2.7 — partial `WHERE deleted_at IS NULL` so a soft-deleted
    // row doesn't block the new insert on the same key.
    uniqueIndex("observations_patient_upload_loinc_date_unique")
      .on(table.patientId, table.uploadId, table.loincCode, table.collectedAt)
      .where(sql`${table.deletedAt} IS NULL AND ${table.uploadId} IS NOT NULL`),
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
