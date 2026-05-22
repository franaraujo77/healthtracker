import type postgres from "postgres";

/**
 * Story 2.3 — LOINC normalization.
 *
 * Case-insensitive lookup in `loinc_ref` by `biomarker_name_pt`.
 * Returns `null` on miss → the dispatcher routes the field to
 * `extraction_review_queue` with reason `loinc_unresolved` (AC4).
 *
 * For top-20 biomarkers this is a single SELECT; no fuzzy matching
 * this story (Story 8.x will add a "did you mean…" reviewer hint).
 *
 * The worker uses the `postgres` driver (NOT Drizzle) per
 * `services/extraction/src/db.ts` — that connection is direct
 * (non-pooled) so pg-boss's advisory locks work. We bind the same
 * connection here.
 */
export interface LoincResolution {
  loincCode: string;
  unitUcum: string;
}

export async function resolveLoincCode(
  sql: postgres.Sql,
  biomarkerNamePt: string,
): Promise<LoincResolution | null> {
  const rows = await sql<
    { loinc_code: string; unit_ucum: string }[]
  >`SELECT loinc_code, unit_ucum
    FROM loinc_ref
    WHERE LOWER(biomarker_name_pt) = LOWER(${biomarkerNamePt})
    LIMIT 1`;
  const row = rows[0];
  if (!row) return null;
  return { loincCode: row.loinc_code, unitUcum: row.unit_ucum };
}
