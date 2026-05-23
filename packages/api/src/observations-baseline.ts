import { sql } from "@healthtracker/db";

import type { AuditDb } from "./audit";
import { writeAuditLog } from "./audit";

/**
 * Story 3.3 — `getPersonalBaseline` helper. Computes per-biomarker
 * mean / stddev_samp / latest value across the patient's full
 * observation history in a single SQL aggregate (NFR-SC4 budget:
 * p95 < 500ms at 10M rows; verified by the testcontainer fixture in
 * `packages/db/__tests__/integration/observations-baseline.
 * integration.test.ts`).
 *
 * **Soft-delete filter** (`WHERE deleted_at IS NULL`) is mandatory —
 * Epic 2 retro § "Dependencies on Epic 2"; Story 2.7 added the
 * column. Without it, soft-deleted manual-BIA overwrites would
 * contaminate the mean and stddev.
 *
 * **RLS is the security boundary.** `observations_select_own` filters
 * by `patient_id = app.current_patient_id`. The app-layer
 * `WHERE patient_id = ${patientId}` is defense-in-depth (AR5),
 * matching `getRecordForPatient`'s posture.
 *
 * **Audit emission** appends a SINGLE `observation.baseline.read` row
 * inside the `protectedProcedure` transaction (`ctx.db` is the tx
 * handle — Story 3.1 R1-P233 lesson: do NOT call
 * `database.transaction(...)` manually, postgres.js rejects nested
 * transactions). Two audits per Início mount (`observation.read` +
 * `observation.baseline.read`) is intentional — two distinct read
 * intents (AC6).
 *
 * **Grouping key.** `observations.loinc_code` is nullable (Story 2.3
 * R1-P102). Group by `COALESCE(loinc_code, '__no_loinc__|' ||
 * biomarker_name || '|' || unit_ucum)` so null-LOINC rows still
 * cluster correctly without colliding with resolved LOINC rows.
 *
 * **`sampleSize >= 2` filter.** Single-value groups have no defined
 * stddev → excluded from `baselines`. The UI falls those biomarkers
 * back to `BiomarkerCard` `cold-start` state with population range
 * (AC3).
 *
 * **`stddev = 0` z-score.** When all historical values are
 * identical, `stddev_samp` returns 0; the divide is guarded and
 * `zScore` is set to `null`. The UI maps null → `within-band` (AC2).
 *
 * **NaN guard.** Numeric values are cast to `double precision` in
 * SQL, so they come back as JS numbers — no PG-numeric string
 * coercion. The `Number.isFinite` guard is defense against an
 * upstream extractor regression.
 */

export interface BaselineRow {
  /** Nullable per Story 2.3 — the group key falls back to name+unit. */
  loincCode: string | null;
  biomarkerName: string;
  unitUcum: string;
  mean: number;
  /** `stddev_samp`; can be 0 when all historical values are identical. */
  stddev: number;
  sampleSize: number;
  latestValue: number;
  /** ISO yyyy-mm-dd. */
  latestCollectedAt: string;
  /** `(latest - mean) / stddev`; `null` when `stddev === 0`. */
  zScore: number | null;
}

export interface BaselineView {
  baselines: BaselineRow[];
  biomarkerCount: number;
  /** Distinct `collected_at` count — drives the UI `>= 2` gate. */
  drawCount: number;
}

interface AggregateRow {
  loinc_code: string | null;
  biomarker_name: string;
  unit_ucum: string;
  mean: number | null;
  stddev: number | null;
  sample_size: number;
  latest_value: number | null;
  latest_collected_at: string;
}

/**
 * `numeric` -> JS number defensive coercion. Returns `null` when the
 * input is null/undefined OR when the parsed value is non-finite.
 * The SQL already casts to `double precision`, so drizzle/postgres
 * deliver real JS numbers — this is a belt-and-braces guard against
 * unexpected upstream changes. Narrow contract (no try/catch — the
 * only failure mode is the explicit `Number.isFinite` check).
 */
function coerceFinite(
  value: number | string | null | undefined,
): number | null {
  if (value === null || value === undefined) return null;
  const parsed = typeof value === "number" ? value : Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export async function getPersonalBaselineForPatient(
  database: AuditDb,
  patientId: string,
): Promise<BaselineView> {
  // Single SQL aggregate — one round-trip; NFR-SC4 critical.
  // - `GROUP BY` on `COALESCE(loinc_code, ...)` so null-LOINC rows
  //   group by `(biomarker_name, unit_ucum)` without colliding with
  //   resolved rows.
  // - `stddev_samp` (NOT `stddev_pop`) — we're estimating the
  //   patient's true distribution from a small sample (≥ 2 draws),
  //   not characterising a fixed population.
  // - `(array_agg(value_numeric ORDER BY collected_at DESC))[1]`
  //   gives us the most recent value; `MAX(collected_at)` is the
  //   matching date. Both are returned cast to `double precision`
  //   so drizzle hands back JS numbers.
  // - `HAVING COUNT(*) >= 2` excludes single-sample biomarkers (AC3).
  // - `MAX(biomarker_name)` is deterministic + human-readable; the
  //   biomarker name should be stable within a group, but if it
  //   isn't, MAX is a defensible tiebreaker.
  // - `WHERE patient_id = $1 AND deleted_at IS NULL` — defense-in-
  //   depth + the non-negotiable soft-delete filter (Epic 2 retro).
  // - Postgres' aggregate planner uses `observations_patient_
  //   collected_idx` for the filter; verified by EXPLAIN in the
  //   integration test.
  const rows = (await database.execute(sql`
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
    WHERE patient_id = ${patientId}
      AND deleted_at IS NULL
    GROUP BY COALESCE(loinc_code, '__no_loinc__|' || biomarker_name || '|' || unit_ucum), loinc_code, unit_ucum
    HAVING COUNT(*) >= 2
    ORDER BY MAX(collected_at) DESC, MAX(biomarker_name) ASC
  `)) as unknown as AggregateRow[] | { rows: AggregateRow[] };

  // postgres.js returns an array directly; node-pg-style drivers
  // return `{ rows }`. Normalize.
  const aggregateRows: AggregateRow[] = Array.isArray(rows) ? rows : rows.rows;

  const baselines: BaselineRow[] = [];
  for (const row of aggregateRows) {
    const mean = coerceFinite(row.mean);
    const stddev = coerceFinite(row.stddev);
    const latestValue = coerceFinite(row.latest_value);
    if (mean === null || stddev === null || latestValue === null) {
      // Single-row data-quality issue — degrade by skipping. The
      // pattern matches `getRecordForPatient`'s NaN guard
      // (Story 3.1 R1-P234).
      console.warn(
        `[getPersonalBaselineForPatient] dropping baseline for biomarker=${row.biomarker_name} unit=${row.unit_ucum} — non-finite stat`,
      );
      continue;
    }
    // AC2 — divide-by-zero guard. When all historical values are
    // identical, `stddev_samp` returns 0; we return `zScore: null`
    // and the UI maps it to `within-band`.
    const zScore = stddev === 0 ? null : (latestValue - mean) / stddev;
    baselines.push({
      loincCode: row.loinc_code,
      biomarkerName: row.biomarker_name,
      unitUcum: row.unit_ucum,
      mean,
      stddev,
      sampleSize: row.sample_size,
      latestValue,
      latestCollectedAt: row.latest_collected_at,
      zScore,
    });
  }

  // `drawCount` for the audit metadata — DISTINCT collected_at
  // across the patient's non-deleted history. Tiny cost on top of
  // the aggregate (Postgres serves it from the same index scan).
  //
  // R1-P253 — Semantic note: this counts DISTINCT `collected_at`
  // dates, whereas `getRecordForPatient.drawCount` counts
  // `(collected_at, lab_name)` groups. The two can differ when a
  // patient uploads draws from two labs on the same date (one
  // logical date, two record-level draws). Audit metadata is
  // intentionally the simpler "how many sampling dates" count;
  // analytics that need lab-granular fan-out should join against
  // `observations.lab_name`.
  const drawCountRows = (await database.execute(sql`
    SELECT COUNT(DISTINCT collected_at)::int AS draw_count
    FROM observations
    WHERE patient_id = ${patientId}
      AND deleted_at IS NULL
  `)) as unknown as
    | { draw_count: number }[]
    | { rows: { draw_count: number }[] };
  const drawCountArr: { draw_count: number }[] = Array.isArray(drawCountRows)
    ? drawCountRows
    : drawCountRows.rows;
  const drawCount = drawCountArr[0]?.draw_count ?? 0;

  // AC6 — single `observation.baseline.read` audit row inside the
  // protectedProcedure transaction. `resourceType` is distinct from
  // Story 3.1's `observation_record` so the trail can answer
  // "what baseline did the patient see at time T".
  await writeAuditLog(database, {
    actorId: patientId,
    actorType: "patient",
    event: "observation.baseline.read",
    resourceId: patientId,
    resourceType: "observation_baseline",
    metadata: { biomarkerCount: baselines.length, drawCount },
  });

  return { baselines, biomarkerCount: baselines.length, drawCount };
}
