# LOINC Seed Reference

The `packages/db/seed/loinc-ref.ts` module seeds the top-20 Brazilian
biomarker LOINC codes used by Story 2.3's extraction worker.

## Source

- **LOINC codes**: [loinc.org](https://loinc.org) — public reference.
- **pt-BR biomarker names**: lifted from common Fleury / DASA / Hermes
  Pardini lab report headers (the three labs called out in Story 2.3 AC1).
- **UCUM units**: canonical SI form (`g/dL`, `mmol/L`, `mg/dL`, etc.).

## Refresh

When a new biomarker is added or a unit changes:

1. Update `LOINC_SEED` in `packages/db/seed/loinc-ref.ts`.
2. Run `pnpm db:seed`. The `ON CONFLICT DO NOTHING` makes existing rows
   safe; new rows are inserted.
3. **Note**: the seed does NOT update existing rows. If a `unit_ucum`
   needs to change for an existing LOINC code, do a manual UPDATE — and
   coordinate with the extraction worker (cached normalization) +
   `observations` rows that reference the old unit.

## Categories

| Category    | Count | Examples                            |
| ----------- | ----- | ----------------------------------- |
| CBC         | 4     | Hemoglobina, Hematócrito, Plaquetas |
| lipid_panel | 4     | Colesterol total, HDL, LDL          |
| metabolic   | 5–7   | Glicose, Creatinina, ALT, HbA1c     |
| thyroid     | 2     | TSH, T4 livre                       |
| iron        | 2     | Ferro sérico, Ferritina             |
| crp         | 1     | PCR                                 |

Total 20 — the minimum that exercises every confidence-gate branch
(high, low, LOINC-unresolved) without the engineering overhead of a
full LOINC migration (~80k codes; deferred per architecture concern #12).
