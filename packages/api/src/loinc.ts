import { sql } from "@healthtracker/db";
import { LoincRef } from "@healthtracker/db/schema";

import type { AuditDb } from "./audit";

export interface LoincResolution {
  loincCode: string;
  unitUcum: string;
}

/**
 * Story 2.4 — API-side LOINC resolver mirroring the worker's
 * `resolveLoincCode` (services/extraction/src/normalize/loinc.ts).
 * Used by the patient-confirm path: when a `low_confidence` review
 * row was stored without a resolved `loinc_code` (the worker only
 * resolves LOINC for fields it intends to publish — R2-P118), the
 * confirm helper re-queries here.
 *
 * Case-insensitive match on `biomarker_name_pt`. Returns null on miss.
 *
 * The worker uses raw `postgres` SQL on its own connection; this
 * version uses Drizzle bound to the API's shared postgres-js client
 * (`packages/db/src/client.ts`). The semantic contract is identical
 * (snapshot-pinned by tests).
 */
export async function resolveLoincCode(
  database: AuditDb,
  biomarkerNamePt: string,
): Promise<LoincResolution | null> {
  const normalized = biomarkerNamePt.trim();
  const rows = await database
    .select({
      loincCode: LoincRef.loincCode,
      unitUcum: LoincRef.unitUcum,
    })
    .from(LoincRef)
    .where(sql`LOWER(${LoincRef.biomarkerNamePt}) = LOWER(${normalized})`)
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  return row;
}
