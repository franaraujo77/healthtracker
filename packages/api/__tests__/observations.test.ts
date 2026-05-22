import { describe, expect, it, vi } from "vitest";

import type { AuditDb } from "../src/audit";
import { writeReviewQueueEntry } from "../src/extraction-review";
import { writeObservation } from "../src/observations";

const PATIENT_ID = "33333333-3333-3333-3333-333333333333";
const UPLOAD_ID = "44444444-4444-4444-4444-444444444444";

describe("writeObservation", () => {
  it("inserts via Drizzle and returns the new row id", async () => {
    const returning = vi.fn(() => Promise.resolve([{ id: "obs-1" }]));
    const onConflictDoNothing = vi.fn(() => ({ returning }));
    const values = vi.fn(() => ({ onConflictDoNothing }));
    const db = { insert: vi.fn(() => ({ values })) } as unknown as AuditDb;

    const row = await writeObservation(db, {
      patientId: PATIENT_ID,
      uploadId: UPLOAD_ID,
      loincCode: "718-7",
      biomarkerName: "Hemoglobina",
      valueNumeric: 14.2,
      unitUcum: "g/dL",
      collectedAt: new Date("2024-03-15T00:00:00.000Z"),
      confidenceScore: 0.92,
      source: "extracted",
    });

    expect(row).toEqual({ id: "obs-1" });
    expect(values).toHaveBeenCalledWith(
      expect.objectContaining({
        patientId: PATIENT_ID,
        loincCode: "718-7",
        valueNumeric: "14.2",
        collectedAt: "2024-03-15",
        source: "extracted",
      }),
    );
  });

  it("returns null on ON CONFLICT (re-processed document)", async () => {
    const returning = vi.fn(() => Promise.resolve([]));
    const onConflictDoNothing = vi.fn(() => ({ returning }));
    const values = vi.fn(() => ({ onConflictDoNothing }));
    const db = { insert: vi.fn(() => ({ values })) } as unknown as AuditDb;

    const row = await writeObservation(db, {
      patientId: PATIENT_ID,
      uploadId: UPLOAD_ID,
      loincCode: "718-7",
      biomarkerName: "Hemoglobina",
      valueNumeric: 14.2,
      unitUcum: "g/dL",
      collectedAt: new Date("2024-03-15T00:00:00.000Z"),
      confidenceScore: 0.92,
      source: "extracted",
    });

    expect(row).toBeNull();
  });

  it("serializes optional reference ranges + labName when provided", async () => {
    const returning = vi.fn(() => Promise.resolve([{ id: "obs-2" }]));
    const onConflictDoNothing = vi.fn(() => ({ returning }));
    const values = vi.fn(() => ({ onConflictDoNothing }));
    const db = { insert: vi.fn(() => ({ values })) } as unknown as AuditDb;

    await writeObservation(db, {
      patientId: PATIENT_ID,
      uploadId: UPLOAD_ID,
      loincCode: "2093-3",
      biomarkerName: "Colesterol total",
      valueNumeric: 180,
      unitUcum: "mg/dL",
      referenceRangeLow: 100,
      referenceRangeHigh: 200,
      labName: "Fleury",
      collectedAt: new Date("2024-03-15T00:00:00.000Z"),
      confidenceScore: 0.95,
      source: "extracted",
    });

    expect(values).toHaveBeenCalledWith(
      expect.objectContaining({
        referenceRangeLow: "100",
        referenceRangeHigh: "200",
        labName: "Fleury",
      }),
    );
  });

  it("nulls optional reference ranges when omitted", async () => {
    const returning = vi.fn(() => Promise.resolve([{ id: "obs-3" }]));
    const onConflictDoNothing = vi.fn(() => ({ returning }));
    const values = vi.fn(() => ({ onConflictDoNothing }));
    const db = { insert: vi.fn(() => ({ values })) } as unknown as AuditDb;

    await writeObservation(db, {
      patientId: PATIENT_ID,
      uploadId: UPLOAD_ID,
      loincCode: "718-7",
      biomarkerName: "Hemoglobina",
      valueNumeric: 14.2,
      unitUcum: "g/dL",
      collectedAt: new Date("2024-03-15T00:00:00.000Z"),
      confidenceScore: 0.92,
      source: "extracted",
    });

    expect(values).toHaveBeenCalledWith(
      expect.objectContaining({
        referenceRangeLow: null,
        referenceRangeHigh: null,
        labName: null,
      }),
    );
  });
});

describe("writeReviewQueueEntry", () => {
  it("inserts and returns the new row id", async () => {
    const returning = vi.fn(() => Promise.resolve([{ id: "rev-1" }]));
    const values = vi.fn(() => ({ returning }));
    const db = { insert: vi.fn(() => ({ values })) } as unknown as AuditDb;

    const row = await writeReviewQueueEntry(db, {
      patientId: PATIENT_ID,
      uploadId: UPLOAD_ID,
      biomarkerName: "Unobtanium",
      valueText: "12,3",
      confidenceScore: 0.5,
      reason: "loinc_unresolved",
    });

    expect(row).toEqual({ id: "rev-1" });
    expect(values).toHaveBeenCalledWith(
      expect.objectContaining({
        biomarkerName: "Unobtanium",
        valueText: "12,3",
        reason: "loinc_unresolved",
        loincCode: null,
        unitText: null,
      }),
    );
  });

  it("propagates loincCode + unitText when provided", async () => {
    const returning = vi.fn(() => Promise.resolve([{ id: "rev-2" }]));
    const values = vi.fn(() => ({ returning }));
    const db = { insert: vi.fn(() => ({ values })) } as unknown as AuditDb;

    await writeReviewQueueEntry(db, {
      patientId: PATIENT_ID,
      uploadId: UPLOAD_ID,
      biomarkerName: "Hemoglobina",
      valueText: "14,2",
      unitText: "g/dL",
      loincCode: "718-7",
      confidenceScore: 0.5,
      reason: "low_confidence",
    });

    expect(values).toHaveBeenCalledWith(
      expect.objectContaining({
        loincCode: "718-7",
        unitText: "g/dL",
        reason: "low_confidence",
      }),
    );
  });

  it("throws if the insert returns no row (unexpected for non-ON-CONFLICT)", async () => {
    const returning = vi.fn(() => Promise.resolve([]));
    const values = vi.fn(() => ({ returning }));
    const db = { insert: vi.fn(() => ({ values })) } as unknown as AuditDb;

    await expect(
      writeReviewQueueEntry(db, {
        patientId: PATIENT_ID,
        uploadId: UPLOAD_ID,
        biomarkerName: "X",
        valueText: "1",
        confidenceScore: 0.5,
        reason: "low_confidence",
      }),
    ).rejects.toThrow(/no row/);
  });
});
