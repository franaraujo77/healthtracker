import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AuditDb } from "../src/audit";

// Mock the sibling write helpers so we assert the resolver's orchestration
// (what it publishes / audits / notifies) without a real DB. `vi.hoisted`
// so the spies exist when the hoisted vi.mock factories run.
const {
  writeObservation,
  applyUploadTransition,
  writeAuditLog,
  writeAuditLogIfNew,
  enqueueNotificationSend,
} = vi.hoisted(() => ({
  writeObservation: vi.fn(),
  applyUploadTransition: vi.fn(),
  writeAuditLog: vi.fn(),
  writeAuditLogIfNew: vi.fn(),
  enqueueNotificationSend: vi.fn(),
}));

vi.mock("../src/observations", () => ({ writeObservation }));
vi.mock("../src/upload-transitions", () => ({ applyUploadTransition }));
vi.mock("../src/audit", () => ({ writeAuditLog, writeAuditLogIfNew }));
vi.mock("../src/notifications", () => ({ enqueueNotificationSend }));

const { confirmReviewFieldAsOperator, rejectReviewFieldAsOperator } =
  await import("../src/operator-resolve");

const OPERATOR_ID = "0e0e0e0e-0e0e-0e0e-0e0e-0e0e0e0e0e0e";
const REVIEW_ID = "1a1a1a1a-1a1a-1a1a-1a1a-1a1a1a1a1a1a";

const ROW = {
  id: REVIEW_ID,
  uploadId: "22222222-2222-2222-2222-222222222222",
  patientId: "33333333-3333-3333-3333-333333333333",
  biomarkerName: "TSH",
  valueText: "2,4",
  unitText: "mU/L",
  collectedAtText: "2024-03-12",
  labName: "Lab A",
  resolvedAt: null as Date | null,
};

/**
 * Build a mock DB whose `.select()` consumes one preset result-set per
 * call (thenable builder → works for both `.limit()` and bare count
 * queries) and whose `.update()` resolves.
 */
function makeDb(resultSets: unknown[][]) {
  const queue = [...resultSets];
  const update = vi.fn(() => ({
    set: () => ({ where: () => Promise.resolve(undefined) }),
  }));
  const select = vi.fn(() => {
    const result = queue.shift() ?? [];
    const builder: Record<string, unknown> = {};
    builder.from = () => builder;
    builder.where = () => builder;
    builder.limit = () => Promise.resolve(result);
    builder.then = (
      res: (v: unknown) => unknown,
      rej: (e: unknown) => unknown,
    ) => Promise.resolve(result).then(res, rej);
    return builder;
  });
  return { select, update } as unknown as AuditDb;
}

beforeEach(() => {
  vi.clearAllMocks();
  writeObservation.mockResolvedValue({ id: "obs-1" });
  applyUploadTransition.mockResolvedValue({
    updated: true,
    currentStatus: "complete",
  });
  writeAuditLog.mockResolvedValue(undefined);
  writeAuditLogIfNew.mockResolvedValue({ written: true });
  enqueueNotificationSend.mockResolvedValue(undefined);
});

describe("confirmReviewFieldAsOperator", () => {
  it("publishes the value with null LOINC + operator_confirmed source, audits, and notifies complete", async () => {
    // selects: [fetch row], [count remaining=0], [count rejected=0]
    const db = makeDb([[ROW], [{ c: 0 }], [{ c: 0 }]]);

    const out = await confirmReviewFieldAsOperator(db, OPERATOR_ID, {
      reviewQueueId: REVIEW_ID,
    });

    expect(out.uploadStatus).toBe("complete");
    // AC1 / decision 2 — null LOINC, operator_confirmed, full confidence.
    expect(writeObservation).toHaveBeenCalledTimes(1);
    const obsArg = writeObservation.mock.calls[0]?.[1] as Record<
      string,
      unknown
    >;
    expect(obsArg.source).toBe("operator_confirmed");
    expect(obsArg.loincCode).toBeUndefined();
    expect(obsArg.confidenceScore).toBe(1.0);
    expect(obsArg.valueNumeric).toBeCloseTo(2.4);
    // AC3 — confirmed audit, actorType operator, loincCode null in metadata.
    const auditArg = writeAuditLog.mock.calls[0]?.[1] as {
      event: string;
      actorType: string;
      actorId: string;
      metadata: Record<string, unknown>;
    };
    expect(auditArg.event).toBe("extraction_field.operator_confirmed");
    expect(auditArg.actorType).toBe("operator");
    expect(auditArg.actorId).toBe(OPERATOR_ID);
    expect(auditArg.metadata.loincCode).toBeNull();
    // AC1 — all resolved + no rejections → 'complete' notification.
    expect(enqueueNotificationSend).toHaveBeenCalledWith(
      db,
      expect.objectContaining({ kind: "complete" }),
    );
  });

  it("does NOT finalize while other rows remain unresolved", async () => {
    const db = makeDb([[ROW], [{ c: 2 }]]); // remaining > 0
    const out = await confirmReviewFieldAsOperator(db, OPERATOR_ID, {
      reviewQueueId: REVIEW_ID,
    });
    expect(out.uploadStatus).toBe("pending_review");
    expect(applyUploadTransition).not.toHaveBeenCalled();
    expect(enqueueNotificationSend).not.toHaveBeenCalled();
  });

  it("throws CONFLICT when the row is already resolved", async () => {
    const db = makeDb([[{ ...ROW, resolvedAt: new Date() }]]);
    await expect(
      confirmReviewFieldAsOperator(db, OPERATOR_ID, {
        reviewQueueId: REVIEW_ID,
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(writeObservation).not.toHaveBeenCalled();
  });
});

describe("rejectReviewFieldAsOperator", () => {
  it("marks rejected (no observation), audits with the reason, and notifies manual entry", async () => {
    // selects: [fetch row], [count remaining=0], [count rejected=1]
    const db = makeDb([[ROW], [{ c: 0 }], [{ c: 1 }]]);

    const out = await rejectReviewFieldAsOperator(db, OPERATOR_ID, {
      reviewQueueId: REVIEW_ID,
      rejectionReason: "decimal_separator",
    });

    expect(out.uploadStatus).toBe("complete");
    // AC2 — no publish on reject.
    expect(writeObservation).not.toHaveBeenCalled();
    const auditArg = writeAuditLog.mock.calls[0]?.[1] as {
      event: string;
      metadata: Record<string, unknown>;
    };
    expect(auditArg.event).toBe("extraction_field.operator_rejected");
    expect(auditArg.metadata.rejectionReason).toBe("decimal_separator");
    // AC4 — a rejected field present at finalization → manual_entry_required.
    expect(enqueueNotificationSend).toHaveBeenCalledWith(
      db,
      expect.objectContaining({ kind: "manual_entry_required" }),
    );
  });
});
