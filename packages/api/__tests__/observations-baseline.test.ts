import { describe, expect, it, vi } from "vitest";

import type { AuditDb } from "../src/audit";
import { getPersonalBaselineForPatient } from "../src/observations-baseline";

const PATIENT_ID = "55555555-5555-5555-5555-555555555555";

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
 * Mock DB: `db.execute(sql)` is called twice — once for the aggregate
 * SELECT, once for the distinct-draw COUNT. Provide responses in
 * order. `db.insert(...).values({...})` writes the audit row.
 */
function makeDb(args: { aggregateRows: AggregateRow[]; drawCount: number }) {
  const executeFn = vi
    .fn<(sql: unknown) => Promise<unknown>>()
    .mockResolvedValueOnce(args.aggregateRows)
    .mockResolvedValueOnce([{ draw_count: args.drawCount }]);

  const auditValues = vi.fn(() => Promise.resolve(undefined));
  const insertFn = vi.fn(() => ({ values: auditValues }));

  return {
    db: { execute: executeFn, insert: insertFn } as unknown as AuditDb,
    executeFn,
    insertFn,
    auditValues,
  };
}

const baseRow = (overrides: Partial<AggregateRow> = {}): AggregateRow => ({
  loinc_code: "2276-4",
  biomarker_name: "Ferritina",
  unit_ucum: "ng/mL",
  mean: 100,
  stddev: 10,
  sample_size: 3,
  latest_value: 110,
  latest_collected_at: "2024-05-20",
  ...overrides,
});

describe("getPersonalBaselineForPatient", () => {
  it("returns empty baselines + writes one observation.baseline.read audit when patient has no rows", async () => {
    const { db, auditValues } = makeDb({ aggregateRows: [], drawCount: 0 });
    const out = await getPersonalBaselineForPatient(db, PATIENT_ID);
    expect(out).toEqual({ baselines: [], biomarkerCount: 0, drawCount: 0 });
    expect(auditValues).toHaveBeenCalledTimes(1);
    expect(auditValues).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: PATIENT_ID,
        actorType: "patient",
        event: "observation.baseline.read",
        resourceType: "observation_baseline",
        resourceId: PATIENT_ID,
        metadata: { biomarkerCount: 0, drawCount: 0 },
      }),
    );
  });

  it("AC2 — computes z-score = (latest - mean) / stddev", async () => {
    const { db } = makeDb({
      aggregateRows: [baseRow({ mean: 100, stddev: 10, latest_value: 112 })],
      drawCount: 3,
    });
    const out = await getPersonalBaselineForPatient(db, PATIENT_ID);
    expect(out.baselines).toHaveLength(1);
    expect(out.baselines[0]?.zScore).toBeCloseTo(1.2, 6);
  });

  it("AC2 — stddev === 0 returns zScore: null (no divide-by-zero, no spurious chip)", async () => {
    const { db } = makeDb({
      aggregateRows: [baseRow({ mean: 100, stddev: 0, latest_value: 100 })],
      drawCount: 2,
    });
    const out = await getPersonalBaselineForPatient(db, PATIENT_ID);
    expect(out.baselines[0]?.zScore).toBeNull();
  });

  it("AC6 — emits exactly one observation.baseline.read with biomarkerCount + drawCount", async () => {
    const { db, auditValues } = makeDb({
      aggregateRows: [
        baseRow({ biomarker_name: "Ferritina" }),
        baseRow({
          loinc_code: "718-7",
          biomarker_name: "Hemoglobina",
          unit_ucum: "g/dL",
        }),
      ],
      drawCount: 4,
    });
    await getPersonalBaselineForPatient(db, PATIENT_ID);
    expect(auditValues).toHaveBeenCalledTimes(1);
    expect(auditValues).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "observation.baseline.read",
        metadata: { biomarkerCount: 2, drawCount: 4 },
      }),
    );
  });

  it("drops a baseline row when mean/stddev/latest is non-finite (NaN guard)", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { db } = makeDb({
      aggregateRows: [
        baseRow({ biomarker_name: "Good", mean: 100 }),
        baseRow({ biomarker_name: "Bad", mean: Number.NaN }),
      ],
      drawCount: 3,
    });
    const out = await getPersonalBaselineForPatient(db, PATIENT_ID);
    expect(out.baselines).toHaveLength(1);
    expect(out.baselines[0]?.biomarkerName).toBe("Good");
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it("preserves null loincCode through the aggregate (Story 2.3 R1-P102)", async () => {
    const { db } = makeDb({
      aggregateRows: [
        baseRow({
          loinc_code: null,
          biomarker_name: "Custom-extracted",
          unit_ucum: "mg/L",
        }),
      ],
      drawCount: 2,
    });
    const out = await getPersonalBaselineForPatient(db, PATIENT_ID);
    expect(out.baselines[0]?.loincCode).toBeNull();
    expect(out.baselines[0]?.biomarkerName).toBe("Custom-extracted");
  });

  it("AC4 — issues two SELECTs (aggregate + draw count) and one audit insert", async () => {
    const { db, executeFn, insertFn } = makeDb({
      aggregateRows: [],
      drawCount: 0,
    });
    await getPersonalBaselineForPatient(db, PATIENT_ID);
    expect(executeFn).toHaveBeenCalledTimes(2);
    expect(insertFn).toHaveBeenCalledTimes(1);
  });
});
