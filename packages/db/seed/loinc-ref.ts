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
 * Categories: CBC (4), lipid_panel (4), metabolic (5), thyroid (2),
 * iron (2), crp (1), additional (2). Total 20.
 *
 * Idempotent via `ON CONFLICT DO NOTHING` keyed on `loinc_code`.
 */

interface LoincSeedEntry {
  loinc_code: string;
  biomarker_name_pt: string;
  unit_ucum: string;
  category: string;
}

const LOINC_SEED: LoincSeedEntry[] = [
  // CBC — Complete Blood Count
  {
    loinc_code: "718-7",
    biomarker_name_pt: "Hemoglobina",
    unit_ucum: "g/dL",
    category: "CBC",
  },
  {
    loinc_code: "4544-3",
    biomarker_name_pt: "Hematócrito",
    unit_ucum: "%",
    category: "CBC",
  },
  {
    loinc_code: "6690-2",
    biomarker_name_pt: "Leucócitos totais",
    unit_ucum: "10*3/uL",
    category: "CBC",
  },
  {
    loinc_code: "777-3",
    biomarker_name_pt: "Plaquetas",
    unit_ucum: "10*3/uL",
    category: "CBC",
  },
  // Lipid panel
  {
    loinc_code: "2093-3",
    biomarker_name_pt: "Colesterol total",
    unit_ucum: "mg/dL",
    category: "lipid_panel",
  },
  {
    loinc_code: "2085-9",
    biomarker_name_pt: "HDL",
    unit_ucum: "mg/dL",
    category: "lipid_panel",
  },
  {
    loinc_code: "2089-1",
    biomarker_name_pt: "LDL",
    unit_ucum: "mg/dL",
    category: "lipid_panel",
  },
  {
    loinc_code: "2571-8",
    biomarker_name_pt: "Triglicerídeos",
    unit_ucum: "mg/dL",
    category: "lipid_panel",
  },
  // Metabolic
  {
    loinc_code: "2345-7",
    biomarker_name_pt: "Glicose",
    unit_ucum: "mg/dL",
    category: "metabolic",
  },
  {
    loinc_code: "2160-0",
    biomarker_name_pt: "Creatinina",
    unit_ucum: "mg/dL",
    category: "metabolic",
  },
  {
    loinc_code: "3094-0",
    biomarker_name_pt: "Ureia",
    unit_ucum: "mg/dL",
    category: "metabolic",
  },
  {
    loinc_code: "2951-2",
    biomarker_name_pt: "Sódio",
    unit_ucum: "mmol/L",
    category: "metabolic",
  },
  {
    loinc_code: "2823-3",
    biomarker_name_pt: "Potássio",
    unit_ucum: "mmol/L",
    category: "metabolic",
  },
  // Thyroid
  {
    loinc_code: "3016-3",
    biomarker_name_pt: "TSH",
    unit_ucum: "mU/L",
    category: "thyroid",
  },
  {
    loinc_code: "3024-7",
    biomarker_name_pt: "T4 livre",
    unit_ucum: "ng/dL",
    category: "thyroid",
  },
  // Iron
  {
    loinc_code: "2498-4",
    biomarker_name_pt: "Ferro sérico",
    unit_ucum: "ug/dL",
    category: "iron",
  },
  {
    loinc_code: "2276-4",
    biomarker_name_pt: "Ferritina",
    unit_ucum: "ng/mL",
    category: "iron",
  },
  // CRP
  {
    loinc_code: "1988-5",
    biomarker_name_pt: "PCR",
    unit_ucum: "mg/L",
    category: "crp",
  },
  // Additional commonly-tested
  {
    loinc_code: "4548-4",
    biomarker_name_pt: "Hemoglobina glicada",
    unit_ucum: "%",
    category: "metabolic",
  },
  {
    loinc_code: "1742-6",
    biomarker_name_pt: "ALT",
    unit_ucum: "U/L",
    category: "metabolic",
  },
];

/**
 * Seeds `loinc_ref` with the top-20 Brazilian biomarker entries.
 * Idempotent — re-running this function after rows already exist
 * is a no-op.
 */
export async function seedLoincRef(
  database: typeof Database,
): Promise<{ inserted: number }> {
  const result = await database
    .insert(LoincRef)
    .values(
      LOINC_SEED.map((entry) => ({
        loincCode: entry.loinc_code,
        biomarkerNamePt: entry.biomarker_name_pt,
        unitUcum: entry.unit_ucum,
        category: entry.category,
      })),
    )
    .onConflictDoNothing({ target: LoincRef.loincCode })
    .returning({ loincCode: LoincRef.loincCode });
  return { inserted: result.length };
}

/** Exported for unit tests + the `pnpm db:seed` runner. */
export const LOINC_SEED_ENTRIES = LOINC_SEED;
