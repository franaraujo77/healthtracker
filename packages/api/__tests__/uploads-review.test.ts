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

  // P141 — capture the actual values argument to every `.insert(...).values(...)`
  // + every `.update(...).set(...)` call, so tests can assert the
  // serialization (source, confidence, audit event name, etc.).
  const insertValuesArgs: unknown[] = [];
  const updateSetArgs: unknown[] = [];

  const selectFn = vi.fn(() => {
    const result = selectsQueue.shift() ?? [];
    const finalize = Promise.resolve(result);
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
    chain.values = vi.fn((arg: unknown) => {
      insertValuesArgs.push(arg);
      return chain;
    });
    chain.onConflictDoNothing = vi.fn(() => chain);
    chain.returning = vi.fn(() => Promise.resolve(result));
    // Make values() also thenable so `await database.insert().values()`
    // works for inserts that don't .returning() (writeAuditLog).
    const valuesPromise = Promise.resolve(undefined);
    const originalValues = chain.values as (a: unknown) => unknown;
    chain.values = vi.fn((arg: unknown) => {
      originalValues(arg);
      const inner: Record<string, unknown> = {
        onConflictDoNothing: vi.fn(() => ({
          returning: vi.fn(() => Promise.resolve(result)),
        })),
        returning: vi.fn(() => Promise.resolve(result)),
        then: valuesPromise.then.bind(valuesPromise),
        catch: valuesPromise.catch.bind(valuesPromise),
      };
      return inner;
    });
    return chain;
  });

  const updateFn = vi.fn(() => {
    const result = updatesQueue.shift() ?? [];
    const finalize = Promise.resolve(result);
    const chain: Record<string, unknown> = {};
    chain.set = vi.fn((arg: unknown) => {
      updateSetArgs.push(arg);
      return chain;
    });
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
    insertValuesArgs,
    updateSetArgs,
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

  it("flags hasOperatorOnlyRows when pending_review + zero patient rows + processing finished", async () => {
    const now = new Date();
    const { db } = makeScriptedDb({
      selects: [
        [
          {
            id: UPLOAD_ID,
            status: "pending_review",
            createdAt: now,
            processingStartedAt: now,
            // P135 — the heuristic now requires processingCompletedAt
            // so a mid-dispatch refetch doesn't show a misleading
            // "Aguardando revisão da equipe" banner.
            processingCompletedAt: now,
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
    const { db, insertFn, updateFn, insertValuesArgs, updateSetArgs } =
      makeScriptedDb({
        // 1. review row, 2. loinc resolve (unit lookup), 3. remaining-count
        selects: [
          [reviewRow],
          [{ loincCode: "718-7", unitUcum: "g/dL" }],
          [{ c: 0 }],
        ],
        insertReturning: [[{ id: "obs-1" }]],
        updates: [
          [], // UPDATE review row
          [{ id: UPLOAD_ID, status: "complete" }], // applyUploadTransition
        ],
      });

    const result = await confirmReviewFieldAsPatient(db, PATIENT_ID, {
      reviewQueueId: REVIEW_ID,
    });

    expect(result.observationId).toBe("obs-1");
    expect(result.uploadStatus).toBe("complete");
    expect(result.remainingPatientReviewable).toBe(0);

    // P141 — observation written with source = 'patient_corrected' +
    // confidence 1.0 + patient's parsed value (14.2).
    expect(insertValuesArgs[0]).toMatchObject({
      source: "patient_corrected",
      confidenceScore: "1",
      valueNumeric: "14.2",
    });
    // P141 — audit event is `observation.patient_confirmed` (no edit
    // branch); actor type is 'patient'; resourceId is the new
    // observation id (not the review row id — P130).
    expect(insertValuesArgs[1]).toMatchObject({
      actorType: "patient",
      event: "observation.patient_confirmed",
      resourceId: "obs-1",
    });
    expect(insertFn).toHaveBeenCalled();
    // P141 — review row marked resolved with NULL correction_metadata
    // (no edit) AND the patient as resolver.
    expect(updateSetArgs[0]).toMatchObject({
      resolvedByPatientId: PATIENT_ID,
      correctionMetadata: null,
    });
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
    const { db, insertValuesArgs, updateSetArgs } = makeScriptedDb({
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

    // P141 — observation written with the PATIENT-provided value (14.2)
    // not the original adapter value (1.4). source = 'patient_corrected'.
    expect(insertValuesArgs[0]).toMatchObject({
      source: "patient_corrected",
      valueNumeric: "14.2",
    });
    // P141 — audit event is `observation.patient_corrected` (edit branch).
    expect(insertValuesArgs[1]).toMatchObject({
      event: "observation.patient_corrected",
    });
    // P141 — correction_metadata is populated with the patient's value
    // AND the original valueText.
    expect(updateSetArgs[0]).toMatchObject({
      resolvedByPatientId: PATIENT_ID,
      correctionMetadata: expect.objectContaining({
        patientValue: 14.2,
        originalValueText: "1,4",
      }) as unknown,
    });
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
