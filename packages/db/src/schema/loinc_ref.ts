import { pgTable } from "drizzle-orm/pg-core";

/**
 * Story 2.3 — public LOINC reference data (top-20 Brazilian
 * biomarkers seeded by `packages/db/seed/loinc-ref.ts`).
 *
 * Lookup table: case-insensitive match on `biomarker_name_pt`
 * returns the canonical `loinc_code` + `unit_ucum` for that
 * biomarker. The extraction worker's `resolveLoincCode` calls
 * `SELECT ... WHERE LOWER(biomarker_name_pt) = LOWER($1)`.
 *
 * RLS: public SELECT (no PHI). No INSERT/UPDATE/DELETE policy —
 * seed-only via `pnpm db:seed`.
 */
export const LoincRef = pgTable("loinc_ref", (t) => ({
  loincCode: t.text().notNull().primaryKey(),
  biomarkerNamePt: t.text().notNull(),
  unitUcum: t.text().notNull(),
  category: t.text().notNull(),
}));
