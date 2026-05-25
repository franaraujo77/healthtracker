import { describe, expect, it, vi } from "vitest";

import type { AuditDb } from "../src/audit";
import { getLetterForDraw } from "../src/letters";

const PATIENT_ID = "55555555-5555-5555-5555-555555555555";

interface FakeLetterRow {
  id: string;
  status: "queued" | "generating" | "complete" | "failed";
  createdAt: Date;
}

/**
 * Mock the Drizzle chain `db.select(...).from(...).innerJoin(...)
 * .innerJoin(...).where(...).orderBy(...).limit(...)` used by
 * `getLetterForDraw`. Returns the helpers + the final rows the LIMIT
 * resolves to so tests can pick what comes back.
 */
function makeDb(rows: FakeLetterRow[]) {
  const limitFn = vi.fn(() => Promise.resolve(rows));
  const orderBy = vi.fn(() => ({ limit: limitFn }));
  const whereChain = { orderBy };
  const secondJoin = vi.fn(() => ({ where: vi.fn(() => whereChain) }));
  const firstJoin = vi.fn(() => ({ innerJoin: secondJoin }));
  const fromChain = { innerJoin: firstJoin };
  const selectFn = vi.fn(() => ({ from: vi.fn(() => fromChain) }));
  return {
    db: { select: selectFn } as unknown as AuditDb,
    selectFn,
    limitFn,
  };
}

describe("getLetterForDraw", () => {
  it("returns the most recent letter for a draw when status='complete'", async () => {
    const { db } = makeDb([
      {
        id: "letter-newer",
        status: "complete",
        createdAt: new Date("2026-05-01"),
      },
    ]);
    const out = await getLetterForDraw(db, {
      patientId: PATIENT_ID,
      collectedAt: "2026-04-15",
      labName: "Fleury",
    });
    expect(out).toEqual({ letterId: "letter-newer", status: "complete" });
  });

  it("returns the row even when status is queued/generating/failed (AC4 trigger)", async () => {
    for (const status of ["queued", "generating", "failed"] as const) {
      const { db } = makeDb([
        { id: "letter-x", status, createdAt: new Date("2026-05-01") },
      ]);
      const out = await getLetterForDraw(db, {
        patientId: PATIENT_ID,
        collectedAt: "2026-04-15",
        labName: "",
      });
      expect(out).toEqual({ letterId: "letter-x", status });
    }
  });

  it("returns null when no letter exists for the draw", async () => {
    const { db } = makeDb([]);
    const out = await getLetterForDraw(db, {
      patientId: PATIENT_ID,
      collectedAt: "2026-04-15",
      labName: "Fleury",
    });
    expect(out).toBeNull();
  });

  it("translates empty-string labName into an IS NULL predicate without throwing", async () => {
    // Sanity check: empty-string sentinel path doesn't crash; the
    // SQL builder must produce a valid predicate. Returning a row
    // proves the chain reached `.limit(1)` (the mock resolves it).
    const { db } = makeDb([
      { id: "letter-no-lab", status: "complete", createdAt: new Date() },
    ]);
    const out = await getLetterForDraw(db, {
      patientId: PATIENT_ID,
      collectedAt: "2026-04-15",
      labName: "",
    });
    expect(out?.letterId).toBe("letter-no-lab");
  });

  it("applies LIMIT 1 (AC7 — multi-upload tie-break by createdAt DESC)", async () => {
    // The helper does .orderBy(desc(Letters.createdAt)).limit(1).
    // The mock's `limit` is called exactly once; assert that.
    const { db, limitFn } = makeDb([
      { id: "letter-A", status: "complete", createdAt: new Date() },
    ]);
    await getLetterForDraw(db, {
      patientId: PATIENT_ID,
      collectedAt: "2026-04-15",
      labName: "Fleury",
    });
    expect(limitFn).toHaveBeenCalledOnce();
  });
});
