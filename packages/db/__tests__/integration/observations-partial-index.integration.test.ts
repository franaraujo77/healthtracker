/**
 * Integration test exercising the Epic 2 retro F162 schema change:
 * the partial unique indexes on `observations` actually behave as
 * declared against a real Postgres.
 *
 * Mocked-SQL unit tests in `services/extraction/__tests__/document-
 * consumer.test.ts` and `packages/api/__tests__/observations-bia.
 * test.ts` cannot catch a wrong WHERE clause on a partial index —
 * the planner ignores the WHERE in mocks. This test does.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { IntegrationDb } from "./setup.js";
import { startIntegrationDb } from "./setup.js";

const PATIENT_A = "11111111-1111-1111-1111-111111111111";
const UPLOAD_A = "22222222-2222-2222-2222-222222222222";
const LOINC_HEMOGLOBIN = "718-7";

describe("observations partial unique indexes — F162", () => {
  let db: IntegrationDb;

  beforeAll(async () => {
    db = await startIntegrationDb();
  }, 120_000);

  afterAll(async () => {
    await db.sql.end();
    await db.container.stop();
  });

  it("extracted-style duplicate (same upload + loinc + date) is dedup'd by the partial index", async () => {
    const insert = (note: string) =>
      db.sql`INSERT INTO observations
        (patient_id, upload_id, loinc_code, biomarker_name,
         value_numeric, unit_ucum, collected_at, confidence_score, source)
        VALUES (
          ${PATIENT_A}::uuid, ${UPLOAD_A}::uuid, ${LOINC_HEMOGLOBIN},
          ${`Hemoglobina (${note})`}, '14.2', 'g/dL',
          '2024-03-15'::date, '0.95', 'extracted'
        )
        ON CONFLICT (patient_id, upload_id, loinc_code, collected_at)
        WHERE deleted_at IS NULL AND upload_id IS NOT NULL
        DO NOTHING
        RETURNING id`;

    const first = await insert("first");
    const second = await insert("second");

    expect(first).toHaveLength(1);
    expect(second).toHaveLength(0);
  });

  it("manual BIA rows (upload_id NULL) do NOT collide with extracted rows on the extracted partial index", async () => {
    // Manual BIA writes upload_id = NULL — F162. Same patient + loinc
    // + collected_at as an extracted row must not raise unique_violation.
    const bia = await db.sql`INSERT INTO observations
      (patient_id, upload_id, loinc_code, biomarker_name,
       value_numeric, unit_ucum, lab_name, collected_at,
       confidence_score, source)
      VALUES (
        ${PATIENT_A}::uuid, NULL, ${LOINC_HEMOGLOBIN}, 'Hemoglobina (BIA)',
        '14.0', 'g/dL', 'InBody 770', '2024-03-15'::date, '1.0', 'manual_bia'
      )
      RETURNING id`;

    expect(bia).toHaveLength(1);
  });
});
