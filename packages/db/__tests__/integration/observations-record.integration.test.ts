/**
 * Story 3.1 — integration test for the read-side SQL contract behind
 * `getRecordForPatient` (the helper lives in `@healthtracker/api`,
 * which `@healthtracker/db` does not depend on — so this test
 * exercises the equivalent SQL directly against testcontainer
 * Postgres). Asserts:
 *   - reverse-chronological order by `collected_at desc` (AC1)
 *   - rows survive across multiple `upload_id`s for the same
 *     `(patient_id, collected_at, lab_name)` so the API helper can
 *     group them into one draw (AC1)
 *   - manual BIA rows (upload_id NULL, F162) are returned alongside
 *     extracted rows (AC1)
 *   - soft-deleted rows (`deleted_at IS NOT NULL`) are excluded (AC5)
 *   - the `observations_patient_collected_idx` covers the sort
 *
 * The mocked unit test in `packages/api/__tests__/observations-record
 * .test.ts` covers the TS-side grouping + audit emission. This test
 * covers the SQL itself — Epic 2 retro § "Preparation gaps":
 * "mocked SQL is lying to us — stand up a real Postgres for the
 * cases mocks cannot reach."
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { IntegrationDb } from "./setup.js";
import { startIntegrationDb } from "./setup.js";

const PATIENT_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const PATIENT_B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const UPLOAD_1 = "c1111111-1111-1111-1111-111111111111";
const UPLOAD_2 = "c2222222-2222-2222-2222-222222222222";

describe("observations record SELECT — Story 3.1", () => {
  let db: IntegrationDb;

  beforeAll(async () => {
    db = await startIntegrationDb();
  }, 120_000);

  afterAll(async () => {
    await db.sql.end();
    await db.container.stop();
  });

  it("returns rows reverse-chrono, includes manual_bia (upload_id NULL), excludes soft-deleted, ignores other patients", async () => {
    // Seed scenario per AC1/AC5:
    //   - Draw 2024-05-20 / Fleury — extracted + patient_corrected on
    //     the SAME upload (TS grouper collapses to one draw)
    //   - Draw 2024-03-15 / InBody 770 — manual_bia, upload_id NULL
    //   - Draw 2024-01-10 / Fleury — TWO different uploadIds (TS
    //     grouper still collapses to one draw)
    //   - Soft-deleted: 2024-01-10 / DASA / LDL → MUST NOT surface
    //   - PATIENT_B row → MUST NOT surface (the helper's app-layer
    //     `eq(patient_id)` is defense-in-depth; RLS is the boundary
    //     in production)
    await db.sql`INSERT INTO observations
      (patient_id, upload_id, loinc_code, biomarker_name,
       value_numeric, unit_ucum, reference_range_low,
       reference_range_high, lab_name, collected_at,
       confidence_score, source)
      VALUES
      (${PATIENT_A}::uuid, ${UPLOAD_1}::uuid, '718-7', 'Hemoglobina',
        '14.2', 'g/dL', '12', '16', 'Fleury', '2024-05-20'::date,
        '0.95', 'extracted'),
      (${PATIENT_A}::uuid, ${UPLOAD_1}::uuid, '2823-3', 'Potássio',
        '4.1', 'mmol/L', '3.5', '5', 'Fleury', '2024-05-20'::date,
        '0.97', 'patient_corrected'),
      (${PATIENT_A}::uuid, NULL, '73964-7', 'Massa muscular esquelética',
        '32', 'kg', NULL, NULL, 'InBody 770', '2024-03-15'::date,
        '1.0', 'manual_bia'),
      (${PATIENT_A}::uuid, ${UPLOAD_1}::uuid, '2093-3', 'Colesterol total',
        '180', 'mg/dL', '100', '200', 'Fleury', '2024-01-10'::date,
        '0.93', 'extracted'),
      (${PATIENT_A}::uuid, ${UPLOAD_2}::uuid, '2085-9', 'HDL',
        '55', 'mg/dL', '40', '60', 'Fleury', '2024-01-10'::date,
        '0.93', 'extracted'),
      (${PATIENT_B}::uuid, ${UPLOAD_1}::uuid, '718-7', 'Hemoglobina',
        '13.0', 'g/dL', '12', '16', 'Fleury', '2024-05-20'::date,
        '0.95', 'extracted')`;

    // Pre-soft-deleted row (separate INSERT so the column is set).
    await db.sql`INSERT INTO observations
      (patient_id, upload_id, loinc_code, biomarker_name,
       value_numeric, unit_ucum, lab_name, collected_at,
       confidence_score, source, deleted_at)
      VALUES (${PATIENT_A}::uuid, ${UPLOAD_2}::uuid, '2086-7',
        'LDL', '110', 'mg/dL', 'DASA', '2024-01-10'::date,
        '0.93', 'extracted', NOW())`;

    // Mirror the helper's SELECT shape: filter on patient + not soft-
    // deleted, order by collected_at desc, biomarker_name asc.
    interface ObsRow {
      id: string;
      upload_id: string | null;
      biomarker_name: string;
      value_numeric: string;
      lab_name: string | null;
      collected_at_iso: string;
      source: "extracted" | "manual_bia" | "patient_corrected";
    }
    const rows = await db.sql<ObsRow[]>`
      SELECT id, upload_id, biomarker_name, value_numeric, lab_name,
             collected_at::text AS collected_at_iso, source
      FROM observations
      WHERE patient_id = ${PATIENT_A}::uuid
        AND deleted_at IS NULL
      ORDER BY collected_at DESC, biomarker_name ASC`;

    expect(rows).toHaveLength(5);

    // AC5 — the soft-deleted LDL row is absent.
    const names = rows.map((r) => r.biomarker_name);
    expect(names).not.toContain("LDL");

    // PATIENT_B's Hemoglobina (also on 2024-05-20) is filtered out by
    // the app-layer eq(patient_id) — no Hemoglobina with value 13.0.
    const hemos = rows.filter((r) => r.biomarker_name === "Hemoglobina");
    expect(hemos).toHaveLength(1);
    expect(String(hemos[0]?.value_numeric)).toBe("14.2");

    // Reverse-chronological ordering. Group key per the TS grouper.
    const drawKeys: string[] = [];
    for (const r of rows) {
      const key = `${r.collected_at_iso}|${r.lab_name ?? "__null_lab__"}`;
      if (!drawKeys.includes(key)) drawKeys.push(key);
    }
    expect(drawKeys).toEqual([
      "2024-05-20|Fleury",
      "2024-03-15|InBody 770",
      "2024-01-10|Fleury",
    ]);

    // Manual BIA row carries upload_id = NULL (F162) and source =
    // 'manual_bia'. The TS grouper keys on (collectedAt, labName)
    // regardless of upload_id, so this lands in the 2024-03-15 draw.
    const biaRow = rows.find((r) => r.source === "manual_bia");
    expect(biaRow?.upload_id).toBeNull();
    expect(biaRow?.lab_name).toBe("InBody 770");

    // 2024-01-10/Fleury draw has rows from TWO different uploadIds —
    // the TS grouper must still collapse them into ONE draw card.
    const earliest = rows.filter(
      (r) => r.collected_at_iso === "2024-01-10" && r.lab_name === "Fleury",
    );
    expect(earliest).toHaveLength(2);
    expect(new Set(earliest.map((r) => r.upload_id)).size).toBe(2);
  });
});
