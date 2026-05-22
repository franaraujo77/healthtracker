import type { db as Database } from "../src/client";
import { LoincRef } from "../src/schema";

/**
 * Story 2.3 — top-20 Brazilian biomarker seed for `loinc_ref`.
 *
 * Source: LOINC codes from loinc.org; pt-BR biomarker names from
 * common Fleury / DASA / Hermes Pardini lab report headers. UCUM
 * units are the canonical SI form.
 *
 * See `docs/loinc-seed.md` for the source / refresh process.
 *
 * Round-1 R1-P112 — authored in camelCase matching the Drizzle schema
 * directly; the previous snake_case→camelCase mapper at insert time
 * was pointless transformation.
 *
 * Idempotent via `ON CONFLICT DO NOTHING` keyed on `loinc_code`.
 */

interface LoincSeedEntry {
  loincCode: string;
  biomarkerNamePt: string;
  unitUcum: string;
  category: string;
}

const LOINC_SEED: LoincSeedEntry[] = [
  // CBC — Complete Blood Count
  {
    loincCode: "718-7",
    biomarkerNamePt: "Hemoglobina",
    unitUcum: "g/dL",
    category: "CBC",
  },
  {
    loincCode: "4544-3",
    biomarkerNamePt: "Hematócrito",
    unitUcum: "%",
    category: "CBC",
  },
  {
    loincCode: "6690-2",
    biomarkerNamePt: "Leucócitos totais",
    unitUcum: "10*3/uL",
    category: "CBC",
  },
  {
    loincCode: "777-3",
    biomarkerNamePt: "Plaquetas",
    unitUcum: "10*3/uL",
    category: "CBC",
  },
  // Lipid panel
  {
    loincCode: "2093-3",
    biomarkerNamePt: "Colesterol total",
    unitUcum: "mg/dL",
    category: "lipid_panel",
  },
  {
    loincCode: "2085-9",
    biomarkerNamePt: "HDL",
    unitUcum: "mg/dL",
    category: "lipid_panel",
  },
  {
    loincCode: "2089-1",
    biomarkerNamePt: "LDL",
    unitUcum: "mg/dL",
    category: "lipid_panel",
  },
  {
    loincCode: "2571-8",
    biomarkerNamePt: "Triglicerídeos",
    unitUcum: "mg/dL",
    category: "lipid_panel",
  },
  // Metabolic
  {
    loincCode: "2345-7",
    biomarkerNamePt: "Glicose",
    unitUcum: "mg/dL",
    category: "metabolic",
  },
  {
    loincCode: "2160-0",
    biomarkerNamePt: "Creatinina",
    unitUcum: "mg/dL",
    category: "metabolic",
  },
  {
    loincCode: "3094-0",
    biomarkerNamePt: "Ureia",
    unitUcum: "mg/dL",
    category: "metabolic",
  },
  {
    loincCode: "2951-2",
    biomarkerNamePt: "Sódio",
    unitUcum: "mmol/L",
    category: "metabolic",
  },
  {
    loincCode: "2823-3",
    biomarkerNamePt: "Potássio",
    unitUcum: "mmol/L",
    category: "metabolic",
  },
  // Thyroid
  {
    loincCode: "3016-3",
    biomarkerNamePt: "TSH",
    unitUcum: "mU/L",
    category: "thyroid",
  },
  {
    loincCode: "3024-7",
    biomarkerNamePt: "T4 livre",
    unitUcum: "ng/dL",
    category: "thyroid",
  },
  // Iron
  {
    loincCode: "2498-4",
    biomarkerNamePt: "Ferro sérico",
    unitUcum: "ug/dL",
    category: "iron",
  },
  {
    loincCode: "2276-4",
    biomarkerNamePt: "Ferritina",
    unitUcum: "ng/mL",
    category: "iron",
  },
  // CRP
  {
    loincCode: "1988-5",
    biomarkerNamePt: "PCR",
    unitUcum: "mg/L",
    category: "crp",
  },
  // Additional commonly-tested
  {
    loincCode: "4548-4",
    biomarkerNamePt: "Hemoglobina glicada",
    unitUcum: "%",
    category: "metabolic",
  },
  {
    loincCode: "1742-6",
    biomarkerNamePt: "ALT",
    unitUcum: "U/L",
    category: "metabolic",
  },
];

/**
 * Seeds `loinc_ref` with the top-20 Brazilian biomarker entries.
 * Idempotent — re-running after rows exist is a no-op.
 */
export async function seedLoincRef(
  database: typeof Database,
): Promise<{ inserted: number }> {
  const result = await database
    .insert(LoincRef)
    .values(LOINC_SEED)
    .onConflictDoNothing({ target: LoincRef.loincCode })
    .returning({ loincCode: LoincRef.loincCode });
  return { inserted: result.length };
}

/** Exported for unit tests + the `pnpm db:seed` runner. */
export const LOINC_SEED_ENTRIES = LOINC_SEED;
