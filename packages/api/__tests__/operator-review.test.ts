import { describe, expect, it, vi } from "vitest";

import { ExtractionReviewQueue } from "@healthtracker/db/schema";

import type { AuditDb } from "../src/audit";
import {
  getOperatorQueueItem,
  listOperatorReviewQueue,
} from "../src/operator-review";

const UPLOAD_ID = "11111111-1111-1111-1111-111111111111";

/**
 * Story 8.1 — unit tests for the operator review-queue helpers. Same
 * mock-DB chaining pattern as life-events.test.ts. Key invariants:
 *   - both helpers read ONLY `ExtractionReviewQueue` (anonymisation —
 *     never `users`/`uploads`); `from` is asserted against that table;
 *   - both are read-only — no `.insert` / audit write (AC8);
 *   - the detail helper coerces the numeric confidence to a JS number.
 */

describe("listOperatorReviewQueue", () => {
  it("selects only loinc_unresolved rows, grouped per upload, and maps them", async () => {
    const rows = [
      {
        uploadId: UPLOAD_ID,
        patientId: "p-1",
        labName: "Lab A",
        collectedAtText: "2024-03-12",
        flaggedFieldCount: 2,
      },
    ];
    const orderBy = vi.fn(() => Promise.resolve(rows));
    const groupBy = vi.fn(() => ({ orderBy }));
    const where = vi.fn(() => ({ groupBy }));
    const from = vi.fn(() => ({ where }));
    const select = vi.fn(() => ({ from }));
    const insert = vi.fn();
    const db = { select, insert } as unknown as AuditDb;

    const out = await listOperatorReviewQueue(db);

    expect(out).toEqual(rows);
    // Anonymisation: the ONLY table read is extraction_review_queue.
    expect(from).toHaveBeenCalledWith(ExtractionReviewQueue);
    expect(where).toHaveBeenCalledTimes(1);
    expect(groupBy).toHaveBeenCalledTimes(1);
    expect(orderBy).toHaveBeenCalledTimes(1);
    // AC8 — read-only: no mutation.
    expect(insert).not.toHaveBeenCalled();
  });
});

describe("getOperatorQueueItem", () => {
  it("filters by uploadId + loinc_unresolved and coerces confidence to a number", async () => {
    const rows = [
      {
        id: "f-1",
        biomarkerName: "TSH",
        valueText: "2,4",
        unitText: "mU/L",
        loincCode: null,
        collectedAtText: "2024-03-12",
        labName: "Lab A",
        confidenceScore: "0.71",
      },
    ];
    const orderBy = vi.fn(() => Promise.resolve(rows));
    const where = vi.fn(() => ({ orderBy }));
    const from = vi.fn(() => ({ where }));
    const select = vi.fn(() => ({ from }));
    const insert = vi.fn();
    const db = { select, insert } as unknown as AuditDb;

    const out = await getOperatorQueueItem(db, UPLOAD_ID);

    expect(out).toHaveLength(1);
    expect(out[0]?.confidenceScore).toBe(0.71);
    expect(typeof out[0]?.confidenceScore).toBe("number");
    expect(from).toHaveBeenCalledWith(ExtractionReviewQueue);
    expect(insert).not.toHaveBeenCalled();
  });

  it("defaults an unparseable confidence to 0 (a bad score must not hide a field)", async () => {
    const rows = [
      {
        id: "f-2",
        biomarkerName: "Glicose",
        valueText: "—",
        unitText: null,
        loincCode: null,
        collectedAtText: null,
        labName: null,
        confidenceScore: "not-a-number",
      },
    ];
    const orderBy = vi.fn(() => Promise.resolve(rows));
    const where = vi.fn(() => ({ orderBy }));
    const from = vi.fn(() => ({ where }));
    const select = vi.fn(() => ({ from }));
    const db = { select } as unknown as AuditDb;

    const out = await getOperatorQueueItem(db, UPLOAD_ID);

    expect(out[0]?.confidenceScore).toBe(0);
  });
});
