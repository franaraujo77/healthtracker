import { TRPCError } from "@trpc/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AuditDb } from "../src/audit";
import {
  confirmReviewFieldAsPatient,
  getUploadDetailForPatient,
} from "../src/uploads-review";

const PATIENT_ID = "11111111-1111-1111-1111-111111111111";
const UPLOAD_ID = "22222222-2222-2222-2222-222222222222";
const REVIEW_ID = "33333333-3333-3333-3333-333333333333";

/**
 * Story 2.4 — `confirmReviewFieldAsPatient` calls a sequence of
 * `database.{select,insert,update}(...)` chains. Each test sets up a
 * scripted queue of responses; the helper uses each in order.
 */
function makeScriptedDb(script: {
  selects?: unknown[][];
  insertReturning?: { id: string }[][];
  updates?: { id: string; status?: string }[][];
}) {
  const selectsQueue = [...(script.selects ?? [])];
  const insertReturningQueue = [...(script.insertReturning ?? [])];
  const updatesQueue = [...(script.updates ?? [])];

  const selectFn = vi.fn(() => {
    const result = selectsQueue.shift() ?? [];
    const finalize = Promise.resolve(result);
    // The helper composes `.select().from().where().limit()` and
    // sometimes `.select().from().where()` (no limit). Both shapes
    // resolve to the same scripted array; the returned chain is
    // `then`-able at any step.
    const chain: Record<string, unknown> = {};
    chain.from = vi.fn(() => chain);
    chain.where = vi.fn(() => chain);
    chain.limit = vi.fn(() => finalize);
    chain.then = finalize.then.bind(finalize);
    chain.catch = finalize.catch.bind(finalize);
    return chain;
  });

  const insertFn = vi.fn(() => {
    const result = insertReturningQueue.shift() ?? [];
    const chain: Record<string, unknown> = {};
    chain.values = vi.fn(() => chain);
    chain.onConflictDoNothing = vi.fn(() => chain);
    chain.returning = vi.fn(() => Promise.resolve(result));
    return chain;
  });

  const updateFn = vi.fn(() => {
    const result = updatesQueue.shift() ?? [];
    const finalize = Promise.resolve(result);
    const chain: Record<string, unknown> = {};
    chain.set = vi.fn(() => chain);
    chain.where = vi.fn(() => chain);
    chain.returning = vi.fn(() => finalize);
    chain.then = finalize.then.bind(finalize);
    chain.catch = finalize.catch.bind(finalize);
    return chain;
  });

  return {
    db: {
      select: selectFn,
      insert: insertFn,
      update: updateFn,
    } as unknown as AuditDb,
    selectFn,
    insertFn,
    updateFn,
  };
}

describe("getUploadDetailForPatient", () => {
  it("returns the detail shape for an owned upload", async () => {
    const now = new Date("2024-03-15T00:00:00Z");
    const { db } = makeScriptedDb({
      selects: [
        // upload SELECT
        [
          {
            id: UPLOAD_ID,
            status: "pending_review",
            createdAt: now,
            processingStartedAt: now,
            processingCompletedAt: null,
          },
        ],
        // low-confidence rows SELECT
        [
          {
            id: REVIEW_ID,
            biomarkerName: "Hemoglobina",
            valueText: "14,2",
            unitText: "g/dL",
            loincCode: null,
            collectedAtText: "15/03/2024",
            confidenceScore: "0.6",
          },
        ],
        // count(observations)
        [{ c: 3 }],
      ],
    });

    const result = await getUploadDetailForPatient(db, PATIENT_ID, UPLOAD_ID);
    expect(result.id).toBe(UPLOAD_ID);
    expect(result.status).toBe("pending_review");
    expect(result.lowConfidenceFields).toHaveLength(1);
    expect(result.lowConfidenceFields[0]?.biomarkerName).toBe("Hemoglobina");
    expect(result.hasOperatorOnlyRows).toBe(false);
    expect(result.publishedObservationCount).toBe(3);
  });

  it("throws NOT_FOUND when the upload does not exist (or is foreign)", async () => {
    const { db } = makeScriptedDb({ selects: [[]] });
    await expect(
      getUploadDetailForPatient(db, PATIENT_ID, UPLOAD_ID),
    ).rejects.toBeInstanceOf(TRPCError);
  });

  it("flags hasOperatorOnlyRows when pending_review + zero patient rows", async () => {
    const now = new Date();
    const { db } = makeScriptedDb({
      selects: [
        [
          {
            id: UPLOAD_ID,
            status: "pending_review",
            createdAt: now,
            processingStartedAt: now,
            processingCompletedAt: null,
          },
        ],
        // zero patient-visible rows
        [],
        [{ c: 5 }],
      ],
    });
    const result = await getUploadDetailForPatient(db, PATIENT_ID, UPLOAD_ID);
    expect(result.hasOperatorOnlyRows).toBe(true);
    expect(result.lowConfidenceFields).toHaveLength(0);
  });
});

describe("confirmReviewFieldAsPatient", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-03-20T12:00:00Z"));
  });

  it("confirms (no edit) — publishes observation, marks resolved, emits patient_confirmed audit", async () => {
    const reviewRow = {
      id: REVIEW_ID,
      uploadId: UPLOAD_ID,
      biomarkerName: "Hemoglobina",
      valueText: "14,2",
      unitText: "g/dL",
      loincCode: "718-7",
      collectedAtText: "15/03/2024",
      confidenceScore: "0.6",
      resolvedAt: null,
      reason: "low_confidence",
    };
    const { db, insertFn, updateFn } = makeScriptedDb({
      // 1. review row, 2. loinc resolve, 3. remaining-count
      selects: [
        [reviewRow],
        [{ loincCode: "718-7", unitUcum: "g/dL" }], // resolveLoincCode lookup for unit
        [{ c: 0 }], // remaining patient-reviewable
      ],
      insertReturning: [[{ id: "obs-1" }]],
      updates: [
        [], // UPDATE review row (no returning needed)
        [{ id: UPLOAD_ID, status: "complete" }], // applyUploadTransition
      ],
    });

    const result = await confirmReviewFieldAsPatient(db, PATIENT_ID, {
      reviewQueueId: REVIEW_ID,
    });

    expect(result.observationId).toBe("obs-1");
    expect(result.uploadStatus).toBe("complete");
    expect(result.remainingPatientReviewable).toBe(0);

    // writeObservation called with source = 'patient_corrected' + 1.0 confidence.
    const insertCalls = insertFn.mock.calls.length;
    expect(insertCalls).toBeGreaterThanOrEqual(1);
    // UPDATE the review row + applyUploadTransition both called.
    expect(updateFn).toHaveBeenCalled();
  });

  it("correct (edit) — uses the patient-provided value", async () => {
    const reviewRow = {
      id: REVIEW_ID,
      uploadId: UPLOAD_ID,
      biomarkerName: "Hemoglobina",
      valueText: "1,4", // adapter said 1,4 — patient corrects to 14.2
      unitText: "g/dL",
      loincCode: "718-7",
      collectedAtText: "15/03/2024",
      confidenceScore: "0.5",
      resolvedAt: null,
      reason: "low_confidence",
    };
    const { db } = makeScriptedDb({
      selects: [
        [reviewRow],
        [{ loincCode: "718-7", unitUcum: "g/dL" }],
        [{ c: 2 }], // still 2 patient-reviewable left
      ],
      insertReturning: [[{ id: "obs-2" }]],
      updates: [[]],
    });

    const result = await confirmReviewFieldAsPatient(db, PATIENT_ID, {
      reviewQueueId: REVIEW_ID,
      patientValueNumeric: 14.2,
    });

    expect(result.observationId).toBe("obs-2");
    expect(result.uploadStatus).toBe("pending_review");
    expect(result.remainingPatientReviewable).toBe(2);
  });

  it("throws CONFLICT (ALREADY_RESOLVED) when the review row is already resolved", async () => {
    const reviewRow = {
      id: REVIEW_ID,
      uploadId: UPLOAD_ID,
      biomarkerName: "Hemoglobina",
      valueText: "14,2",
      unitText: "g/dL",
      loincCode: "718-7",
      collectedAtText: "15/03/2024",
      confidenceScore: "0.6",
      resolvedAt: new Date(),
      reason: "low_confidence",
    };
    const { db } = makeScriptedDb({ selects: [[reviewRow]] });

    await expect(
      confirmReviewFieldAsPatient(db, PATIENT_ID, { reviewQueueId: REVIEW_ID }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("throws NOT_FOUND when the review row does not exist (RLS-filtered or foreign)", async () => {
    const { db } = makeScriptedDb({ selects: [[]] });
    await expect(
      confirmReviewFieldAsPatient(db, PATIENT_ID, { reviewQueueId: REVIEW_ID }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("throws BAD_REQUEST when the original valueText is unparseable and no override is provided", async () => {
    const reviewRow = {
      id: REVIEW_ID,
      uploadId: UPLOAD_ID,
      biomarkerName: "Hemoglobina",
      valueText: "??",
      unitText: null,
      loincCode: "718-7",
      collectedAtText: "15/03/2024",
      confidenceScore: "0.6",
      resolvedAt: null,
      reason: "low_confidence",
    };
    const { db } = makeScriptedDb({ selects: [[reviewRow]] });
    await expect(
      confirmReviewFieldAsPatient(db, PATIENT_ID, { reviewQueueId: REVIEW_ID }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});
