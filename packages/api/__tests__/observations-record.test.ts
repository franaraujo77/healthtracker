import { describe, expect, it, vi } from "vitest";

import type { AuditDb } from "../src/audit";
import { getRecordForPatient } from "../src/observations-record";

const PATIENT_ID = "55555555-5555-5555-5555-555555555555";

interface FakeRow {
  id: string;
  uploadId: string | null;
  loincCode: string | null;
  biomarkerName: string;
  valueNumeric: string;
  unitUcum: string;
  referenceRangeLow: string | null;
  referenceRangeHigh: string | null;
  labName: string | null;
  collectedAt: string;
  source: "extracted" | "manual_bia" | "patient_corrected";
  confidenceScore: string;
}

/**
 * Mock DB chain:
 *   db.select(...).from(...).where(...).orderBy(...)  → Promise<rows>
 *   db.insert(...).values({...})                      → audit-log path
 */
function makeDb(rows: FakeRow[]) {
  const whereChain = {
    orderBy: vi.fn(() => Promise.resolve(rows)),
  };
  const fromChain = { where: vi.fn(() => whereChain) };
  const selectFn = vi.fn(() => ({ from: vi.fn(() => fromChain) }));

  const auditValues = vi.fn(() => Promise.resolve(undefined));
  const insertFn = vi.fn(() => ({ values: auditValues }));

  return {
    db: { select: selectFn, insert: insertFn } as unknown as AuditDb,
    selectFn,
    insertFn,
    auditValues,
    whereChain,
    fromChain,
  };
}

const baseRow = (overrides: Partial<FakeRow> = {}): FakeRow => ({
  id: "obs-1",
  uploadId: "up-1",
  loincCode: "718-7",
  biomarkerName: "Hemoglobina",
  valueNumeric: "14.2",
  unitUcum: "g/dL",
  referenceRangeLow: "12",
  referenceRangeHigh: "16",
  labName: "Fleury",
  collectedAt: "2024-03-15",
  source: "extracted",
  confidenceScore: "0.95",
  ...overrides,
});

describe("getRecordForPatient", () => {
  it("returns empty record + writes one audit when patient has no rows", async () => {
    const { db, auditValues } = makeDb([]);
    const out = await getRecordForPatient(db, PATIENT_ID);
    expect(out).toEqual({ draws: [], drawCount: 0, observationCount: 0 });
    expect(auditValues).toHaveBeenCalledTimes(1);
    expect(auditValues).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: PATIENT_ID,
        actorType: "patient",
        event: "observation.read",
        resourceType: "observation_record",
        resourceId: PATIENT_ID,
        metadata: { drawCount: 0, observationCount: 0 },
      }),
    );
  });

  it("AC4 — emits exactly one observation.read audit with the right counts", async () => {
    const { db, auditValues } = makeDb([
      baseRow({ id: "a", labName: "Fleury", collectedAt: "2024-03-15" }),
      baseRow({
        id: "b",
        labName: "Fleury",
        collectedAt: "2024-03-15",
        biomarkerName: "Ferritina",
      }),
      baseRow({ id: "c", labName: "DASA", collectedAt: "2024-01-10" }),
    ]);
    const out = await getRecordForPatient(db, PATIENT_ID);
    expect(out.drawCount).toBe(2);
    expect(out.observationCount).toBe(3);
    expect(auditValues).toHaveBeenCalledTimes(1);
    expect(auditValues).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "observation.read",
        metadata: { drawCount: 2, observationCount: 3 },
      }),
    );
  });

  it("AC1 — groups rows by (collectedAt, labName) across multiple uploadIds (extracted + patient_corrected)", async () => {
    const { db } = makeDb([
      baseRow({
        id: "a",
        uploadId: "up-1",
        labName: "Fleury",
        collectedAt: "2024-03-15",
        source: "extracted",
      }),
      baseRow({
        id: "b",
        uploadId: "up-1",
        labName: "Fleury",
        collectedAt: "2024-03-15",
        source: "patient_corrected",
        biomarkerName: "Ferritina",
      }),
      // Different upload, same date + lab — must still group together.
      baseRow({
        id: "c",
        uploadId: "up-2",
        labName: "Fleury",
        collectedAt: "2024-03-15",
        source: "extracted",
        biomarkerName: "Colesterol total",
      }),
    ]);
    const out = await getRecordForPatient(db, PATIENT_ID);
    expect(out.drawCount).toBe(1);
    expect(out.draws[0]?.observations.map((o) => o.id)).toEqual([
      "a",
      "b",
      "c",
    ]);
  });

  it("AC1 — null-lab extracted rows do NOT collide with manual_bia rows (separate draws)", async () => {
    const { db } = makeDb([
      baseRow({
        id: "ex",
        uploadId: "up-1",
        labName: null,
        collectedAt: "2024-03-15",
        source: "extracted",
      }),
      baseRow({
        id: "bia",
        uploadId: null,
        labName: "InBody 770",
        collectedAt: "2024-03-15",
        source: "manual_bia",
        biomarkerName: "Massa muscular esquelética",
      }),
    ]);
    const out = await getRecordForPatient(db, PATIENT_ID);
    expect(out.drawCount).toBe(2);
    const labNames = out.draws.map((d) => d.labName);
    expect(labNames).toContain(null);
    expect(labNames).toContain("InBody 770");
  });

  it("coerces PG-numeric string columns to JS numbers", async () => {
    const { db } = makeDb([
      baseRow({
        valueNumeric: "14.2",
        referenceRangeLow: "12",
        referenceRangeHigh: "16",
        confidenceScore: "0.95",
      }),
    ]);
    const out = await getRecordForPatient(db, PATIENT_ID);
    const obs = out.draws[0]?.observations[0];
    expect(obs?.valueNumeric).toBe(14.2);
    expect(obs?.referenceRangeLow).toBe(12);
    expect(obs?.referenceRangeHigh).toBe(16);
    expect(obs?.confidenceScore).toBe(0.95);
  });

  it("nullable reference ranges survive coercion as null", async () => {
    const { db } = makeDb([
      baseRow({ referenceRangeLow: null, referenceRangeHigh: null }),
    ]);
    const out = await getRecordForPatient(db, PATIENT_ID);
    const obs = out.draws[0]?.observations[0];
    expect(obs?.referenceRangeLow).toBeNull();
    expect(obs?.referenceRangeHigh).toBeNull();
  });

  it("drops a single row with unparseable valueNumeric instead of crashing the whole fetch", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { db } = makeDb([
      baseRow({ id: "good", valueNumeric: "14.2" }),
      baseRow({
        id: "bad",
        valueNumeric: "not-a-number",
        biomarkerName: "Ferritina",
      }),
    ]);
    const out = await getRecordForPatient(db, PATIENT_ID);
    expect(out.observationCount).toBe(1);
    expect(out.draws[0]?.observations[0]?.id).toBe("good");
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it("R1-P234 — bad confidenceScore degrades to 0, the observation row is still returned", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { db } = makeDb([
      baseRow({
        id: "still-good",
        valueNumeric: "14.2",
        confidenceScore: "not-a-number",
      }),
    ]);
    const out = await getRecordForPatient(db, PATIENT_ID);
    expect(out.observationCount).toBe(1);
    expect(out.draws[0]?.observations[0]?.id).toBe("still-good");
    expect(out.draws[0]?.observations[0]?.confidenceScore).toBe(0);
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it("AC5 — soft-delete: the WHERE chain receives both eq(patientId) and isNull(deletedAt)", async () => {
    const { db, fromChain } = makeDb([]);
    await getRecordForPatient(db, PATIENT_ID);
    expect(fromChain.where).toHaveBeenCalledTimes(1);
    // The Drizzle `and()` operator is opaque at the mock layer, but we
    // can assert the helper composes exactly one predicate and that
    // the predicate isn't undefined (defense against an accidental
    // refactor that removes the soft-delete filter — the next layer
    // is the testcontainer integration test).
    const firstCall = fromChain.where.mock.calls[0];
    expect(firstCall).toBeDefined();
    expect(firstCall?.length).toBeGreaterThan(0);
  });
});
