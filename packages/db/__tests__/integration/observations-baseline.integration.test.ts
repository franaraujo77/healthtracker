/**
 * Story 3.3 — integration test for the SQL aggregate behind
 * `getPersonalBaselineForPatient`. The helper lives in
 * `@healthtracker/api` (which `@healthtracker/db` does not depend
 * on), so this test exercises the equivalent SQL directly against
 * a testcontainer Postgres.
 *
 * **Scope:**
 *   - Correctness: per-(LOINC, unit) `avg` / `stddev_samp` / `count`
 *     match a hand-computed reference; `sampleSize < 2` excluded;
 *     soft-deleted rows excluded; null-LOINC rows fall back to
 *     `(biomarker_name, unit_ucum)` grouping.
 *   - RLS analogue: a second patient's rows are not aggregated into
 *     patient A's baseline (the helper's app-layer `WHERE
 *     patient_id = $1` is mirrored here).
 *   - NFR-SC4 load fixture: seed `N` rows, warm the plan, run 100
 *     iterations, assert p95 < target. CI default: `N = 100_000`,
 *     p95 < 50 ms (1% of the 10M / 500 ms target — extrapolates
 *     linearly for an index scan). Full-scale local: gated on
 *     `NFR_SC4_FULL=1`, seeds 10M rows, asserts p95 < 500 ms.
 *
 * **Index check:** the aggregate must use
 * `observations_patient_collected_idx`. An `EXPLAIN (ANALYZE,
 * BUFFERS)` assertion catches a regression where the planner flips
 * to a sequential scan at scale.
 *
 * **F-item gate** — this test runs only when Docker is available
 * (`@testcontainers/postgresql`). Per CLAUDE.md "Database tests"
 * section, integration tests are explicitly opt-in.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { IntegrationDb } from "./setup.js";
import { startIntegrationDb } from "./setup.js";

const PATIENT_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const PATIENT_B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const UPLOAD_1 = "c1111111-1111-1111-1111-111111111111";
const UPLOAD_2 = "c2222222-2222-2222-2222-222222222222";

const BASELINE_AGGREGATE_SQL = `
  SELECT
    loinc_code,
    MAX(biomarker_name) AS biomarker_name,
    unit_ucum,
    AVG(value_numeric)::double precision AS mean,
    STDDEV_SAMP(value_numeric)::double precision AS stddev,
    COUNT(*)::int AS sample_size,
    ((ARRAY_AGG(value_numeric::double precision ORDER BY collected_at DESC))[1])::double precision AS latest_value,
    MAX(collected_at)::text AS latest_collected_at
  FROM observations
  WHERE patient_id = $1
    AND deleted_at IS NULL
  GROUP BY COALESCE(loinc_code, '__no_loinc__|' || biomarker_name || '|' || unit_ucum), loinc_code, unit_ucum
  HAVING COUNT(*) >= 2
  ORDER BY MAX(collected_at) DESC, MAX(biomarker_name) ASC
`;

describe("observations baseline aggregate — Story 3.3", () => {
  let db: IntegrationDb;

  beforeAll(async () => {
    db = await startIntegrationDb();
    // Seed the patient rows the observations FK (Story 5.6:
    // observations.patient_id → users.id) requires.
    await db.sql`INSERT INTO users (id) VALUES (${PATIENT_A}::uuid), (${PATIENT_B}::uuid)`;
  }, 120_000);

  afterAll(async () => {
    await db.sql.end();
    await db.container.stop();
  });

  it("groups by (loinc, unit), computes mean/stddev/count, excludes sampleSize<2 and soft-deleted, ignores other patients (AC4)", async () => {
    // Patient A — Ferritina: 3 draws [80, 100, 120] → mean 100,
    // stddev_samp ≈ 20, count 3, latest 120 (most recent date).
    // Patient A — Hemoglobina: 2 draws [14, 16] → mean 15,
    // stddev_samp ≈ 1.4142, count 2.
    // Patient A — Vitamina D: 1 draw [30] → EXCLUDED (count < 2).
    // Patient A — Colesterol: 2 draws but one is soft-deleted →
    // count 1 → EXCLUDED.
    // Patient B — Ferritina: 2 draws [200, 400] → MUST NOT
    // contaminate patient A's Ferritina.
    await db.sql`INSERT INTO observations
      (patient_id, upload_id, loinc_code, biomarker_name,
       value_numeric, unit_ucum, lab_name, collected_at,
       confidence_score, source)
      VALUES
      (${PATIENT_A}::uuid, ${UPLOAD_1}::uuid, '2276-4', 'Ferritina',
        '80', 'ng/mL', 'Fleury', '2024-01-10'::date, '0.97', 'extracted'),
      (${PATIENT_A}::uuid, ${UPLOAD_1}::uuid, '2276-4', 'Ferritina',
        '100', 'ng/mL', 'Fleury', '2024-03-15'::date, '0.97', 'extracted'),
      (${PATIENT_A}::uuid, ${UPLOAD_2}::uuid, '2276-4', 'Ferritina',
        '120', 'ng/mL', 'Fleury', '2024-05-20'::date, '0.97', 'extracted'),
      (${PATIENT_A}::uuid, ${UPLOAD_1}::uuid, '718-7', 'Hemoglobina',
        '14', 'g/dL', 'Fleury', '2024-01-10'::date, '0.95', 'extracted'),
      (${PATIENT_A}::uuid, ${UPLOAD_2}::uuid, '718-7', 'Hemoglobina',
        '16', 'g/dL', 'Fleury', '2024-05-20'::date, '0.95', 'extracted'),
      (${PATIENT_A}::uuid, ${UPLOAD_1}::uuid, '1989-3', 'Vitamina D',
        '30', 'ng/mL', 'Fleury', '2024-03-15'::date, '0.93', 'extracted'),
      (${PATIENT_A}::uuid, ${UPLOAD_1}::uuid, '2093-3', 'Colesterol',
        '180', 'mg/dL', 'Fleury', '2024-01-10'::date, '0.93', 'extracted'),
      (${PATIENT_B}::uuid, ${UPLOAD_1}::uuid, '2276-4', 'Ferritina',
        '200', 'ng/mL', 'Fleury', '2024-01-10'::date, '0.97', 'extracted'),
      (${PATIENT_B}::uuid, ${UPLOAD_1}::uuid, '2276-4', 'Ferritina',
        '400', 'ng/mL', 'Fleury', '2024-05-20'::date, '0.97', 'extracted')`;

    // Soft-delete one of the Colesterol rows so its surviving count
    // falls to 1 → must be excluded from the baselines.
    await db.sql`INSERT INTO observations
      (patient_id, upload_id, loinc_code, biomarker_name,
       value_numeric, unit_ucum, lab_name, collected_at,
       confidence_score, source, deleted_at)
      VALUES (${PATIENT_A}::uuid, ${UPLOAD_2}::uuid, '2093-3',
        'Colesterol', '220', 'mg/dL', 'Fleury', '2024-05-20'::date,
        '0.93', 'extracted', NOW())`;

    interface Row {
      loinc_code: string | null;
      biomarker_name: string;
      unit_ucum: string;
      mean: number;
      stddev: number;
      sample_size: number;
      latest_value: number;
      latest_collected_at: string;
    }
    const rows = await db.sql.unsafe<Row[]>(BASELINE_AGGREGATE_SQL, [
      PATIENT_A,
    ]);
    const byLoinc = new Map(rows.map((r) => [r.loinc_code, r]));

    // Ferritina present, mean 100, stddev ≈ 20.
    const ferritina = byLoinc.get("2276-4");
    expect(ferritina).toBeDefined();
    expect(ferritina?.mean).toBeCloseTo(100, 4);
    expect(ferritina?.stddev).toBeCloseTo(20, 2);
    expect(ferritina?.sample_size).toBe(3);
    expect(ferritina?.latest_value).toBe(120);
    expect(ferritina?.latest_collected_at).toBe("2024-05-20");

    // Hemoglobina present, mean 15, stddev = sqrt(((14-15)^2 +
    // (16-15)^2) / (2-1)) = sqrt(2) ≈ 1.4142.
    const hemoglobina = byLoinc.get("718-7");
    expect(hemoglobina).toBeDefined();
    expect(hemoglobina?.mean).toBeCloseTo(15, 4);
    expect(hemoglobina?.stddev).toBeCloseTo(Math.SQRT2, 4);
    expect(hemoglobina?.sample_size).toBe(2);

    // Vitamina D excluded (count = 1).
    expect(byLoinc.has("1989-3")).toBe(false);
    // Colesterol excluded (the live row count = 1 after soft-delete).
    expect(byLoinc.has("2093-3")).toBe(false);

    // Patient B's data did not contaminate patient A's mean.
    expect(ferritina?.mean).not.toBeCloseTo(160, 1);
  });

  it("falls back to (biomarker_name, unit_ucum) grouping when loinc_code is NULL (Story 2.3 R1-P102)", async () => {
    // Re-use the existing patient A schema, add a custom-extracted
    // biomarker with NULL loinc_code on 2 distinct dates.
    await db.sql`INSERT INTO observations
      (patient_id, upload_id, loinc_code, biomarker_name,
       value_numeric, unit_ucum, lab_name, collected_at,
       confidence_score, source)
      VALUES
      (${PATIENT_A}::uuid, ${UPLOAD_1}::uuid, NULL, 'CustomMarker',
        '5', 'mg/L', 'Fleury', '2024-02-01'::date, '0.80', 'extracted'),
      (${PATIENT_A}::uuid, ${UPLOAD_2}::uuid, NULL, 'CustomMarker',
        '7', 'mg/L', 'Fleury', '2024-04-01'::date, '0.80', 'extracted')`;

    interface Row {
      loinc_code: string | null;
      biomarker_name: string;
      unit_ucum: string;
      mean: number;
      sample_size: number;
    }
    const rows = await db.sql.unsafe<Row[]>(BASELINE_AGGREGATE_SQL, [
      PATIENT_A,
    ]);
    const custom = rows.find(
      (r) => r.biomarker_name === "CustomMarker" && r.unit_ucum === "mg/L",
    );
    expect(custom).toBeDefined();
    expect(custom?.loinc_code).toBeNull();
    expect(custom?.sample_size).toBe(2);
    expect(custom?.mean).toBeCloseTo(6, 4);
  });

  // NFR-SC4 load fixture. CI default seeds 100k rows; full 10M run
  // is gated on `NFR_SC4_FULL=1`. The CI target is p95 < 50 ms (1%
  // of the 10M/500ms budget — linear extrapolation for an index
  // scan). EXPLAIN must show the
  // `observations_patient_collected_idx` is used.
  it.skipIf(process.env.SKIP_NFR_SC4 === "1")(
    "NFR-SC4 — aggregate stays under the latency budget at scale",
    async () => {
      const isFullScale = process.env.NFR_SC4_FULL === "1";
      const N = isFullScale ? 10_000_000 : 100_000;
      const p95Budget = isFullScale ? 500 : 50;

      // Seed an at-scale, MULTI-PATIENT table: ~N rows spread across many
      // patients, with PATIENT_A as a small slice. This mirrors production
      // (many patients) so `patient_id = PATIENT_A` is selective and the
      // planner uses `observations_patient_collected_idx` — a single-patient
      // table makes that filter match 100% of rows, so Postgres rationally
      // Seq Scans and the plan-shape guard below would (correctly) fail.
      //
      // Unique upload_id per row avoids colliding on
      // observations_patient_upload_loinc_date_unique (patient, upload,
      // loinc, date); upload_id isn't FK'd and the aggregate groups by
      // (loinc, unit), so randomising it is safe.
      const NOISE_PATIENTS = 200;
      const noiseRowsPerPatient = Math.ceil(N / NOISE_PATIENTS);
      const A_ROWS = 1_000; // PATIENT_A's selective slice (>=2 per biomarker)
      const ARRAYS = `(SELECT ARRAY['2276-4','718-7','1989-3','2093-3','2085-9'] AS loinc_codes,
                  ARRAY['Ferritina','Hemoglobina','Vitamina D','Colesterol','HDL'] AS biomarker_names) names`;
      const ROW_COLS = `(patient_id, upload_id, loinc_code, biomarker_name,
           value_numeric, unit_ucum, lab_name, collected_at,
           confidence_score, source)`;
      const ROW_SELECT = `loinc_codes[1 + (g % 5)], biomarker_names[1 + (g % 5)],
          (90 + random() * 20)::numeric(10, 4), 'ng/mL', 'Fleury',
          (DATE '2020-01-01' + ((g % 1825) || ' days')::interval)::date,
          '0.95', 'extracted'`;
      await db.sql`TRUNCATE observations`;
      // Noise patients (FK targets for the bulk rows).
      await db.sql.unsafe(
        `INSERT INTO users (id) SELECT gen_random_uuid() FROM generate_series(1, $1)`,
        [NOISE_PATIENTS],
      );
      // Bulk noise rows distributed across the noise patients.
      await db.sql.unsafe(
        `INSERT INTO observations ${ROW_COLS}
         SELECT u.id, gen_random_uuid(), ${ROW_SELECT}
         FROM (SELECT id FROM users WHERE id <> $1::uuid AND id <> $2::uuid) u,
              generate_series(1, $3) g, ${ARRAYS}`,
        [PATIENT_A, PATIENT_B, noiseRowsPerPatient],
      );
      // PATIENT_A's small slice — the aggregate subject.
      await db.sql.unsafe(
        `INSERT INTO observations ${ROW_COLS}
         SELECT $1::uuid, gen_random_uuid(), ${ROW_SELECT}
         FROM generate_series(1, $2) g, ${ARRAYS}`,
        [PATIENT_A, A_ROWS],
      );
      await db.sql`ANALYZE observations`;

      // Plan-shape guard. The aggregate MUST use the
      // `observations_patient_collected_idx` and NOT a sequential
      // scan. The exact shape varies (index scan vs bitmap heap
      // scan); we assert both (a) no Seq Scan AND (b) the specific
      // index name appears in the plan. R3-P269 — Dev Notes
      // § "Load fixture scaling" mandates the index name check;
      // the prior `not.toMatch(/Seq Scan/)` alone would silently
      // pass if the planner picked one of the partial unique indexes
      // on `patient_id` (which have `WHERE deleted_at IS NULL AND
      // upload_id IS NOT NULL` predicates that don't match this
      // aggregate's filter) — that would be a real regression
      // hiding behind a green test.
      const plan = await db.sql.unsafe(
        `EXPLAIN (FORMAT JSON) ${BASELINE_AGGREGATE_SQL}`,
        [PATIENT_A],
      );
      const planText = JSON.stringify(plan);
      expect(planText).not.toMatch(/Seq Scan/);
      expect(planText).toMatch(/observations_patient_collected_idx/);

      // Warm the plan + buffer cache.
      for (let i = 0; i < 3; i++) {
        await db.sql.unsafe(BASELINE_AGGREGATE_SQL, [PATIENT_A]);
      }

      const samples: number[] = [];
      for (let i = 0; i < 100; i++) {
        const t0 = performance.now();
        await db.sql.unsafe(BASELINE_AGGREGATE_SQL, [PATIENT_A]);
        samples.push(performance.now() - t0);
      }
      samples.sort((a, b) => a - b);
      const p95 = samples[Math.floor(samples.length * 0.95)] ?? 0;
      console.log(
        `[NFR-SC4] N=${N} p95=${p95.toFixed(1)}ms budget=${p95Budget}ms`,
      );
      expect(p95).toBeLessThan(p95Budget);
    },
    600_000,
  );
});
