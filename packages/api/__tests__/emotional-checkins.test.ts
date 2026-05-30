import { describe, expect, it, vi } from "vitest";

import {
  ACCESS_LOG_EVENT_KINDS,
  EMOTIONAL_CHECKIN_STATES,
  recordEmotionalCheckInInputSchema,
} from "@healthtracker/validators";

import type { AuditDb } from "../src/audit";
import { recordPreResultsEmotionalCheckIn } from "../src/emotional-checkins";

describe("Story 7.2 — validators (AC7 + Zod boundary)", () => {
  it("ACCESS_LOG_EVENT_KINDS does NOT contain 'emotional_checkin.recorded' (AC7 regression lock)", () => {
    expect(ACCESS_LOG_EVENT_KINDS as readonly string[]).not.toContain(
      "emotional_checkin.recorded",
    );
  });

  it("EMOTIONAL_CHECKIN_STATES is the closed 5-value tuple in stable order", () => {
    expect(EMOTIONAL_CHECKIN_STATES).toEqual([
      "hopeful",
      "worried",
      "curious",
      "exhausted",
      "unsure",
    ]);
  });

  it("rejects type='post' (Story 7.2 only writes 'pre')", () => {
    const out = recordEmotionalCheckInInputSchema.safeParse({
      uploadId: "00000000-0000-0000-0000-000000000001",
      state: "hopeful",
      type: "post",
    });
    expect(out.success).toBe(false);
  });

  it("rejects an unknown state", () => {
    const out = recordEmotionalCheckInInputSchema.safeParse({
      uploadId: "00000000-0000-0000-0000-000000000001",
      state: "ecstatic",
      type: "pre",
    });
    expect(out.success).toBe(false);
  });

  it("rejects unknown keys (strict)", () => {
    const out = recordEmotionalCheckInInputSchema.safeParse({
      uploadId: "00000000-0000-0000-0000-000000000001",
      state: "hopeful",
      type: "pre",
      extra: "nope",
    });
    expect(out.success).toBe(false);
  });
});

const PATIENT_ID = "66666666-6666-6666-6666-666666666666";
const UPLOAD_ID = "77777777-7777-7777-7777-777777777777";

interface InsertRow {
  id: string;
  patientId: string;
  uploadId: string;
  state: "hopeful" | "worried" | "curious" | "exhausted" | "unsure";
  type: "pre" | "post";
  privacyFlag: "patient_only";
  createdAt: Date;
}

/**
 * Story 7.2 — unit tests for the emotional-checkins helper. Mirrors
 * `life-events.test.ts` mock-DB pattern.
 *
 * R1-H2 — every test must stub the ownership precondition
 * (`SELECT id FROM uploads WHERE id=? AND patient_id=?`) so the
 * helper proceeds past the new gate. `selectOwnedUpload=true` is
 * the default (caller owns the upload); set `false` to simulate a
 * cross-patient probe.
 */
function makeOwnershipSelect(ownsUpload: boolean) {
  const limit = vi.fn(() =>
    Promise.resolve(ownsUpload ? [{ id: UPLOAD_ID }] : []),
  );
  const where = vi.fn(() => ({ limit }));
  const from = vi.fn(() => ({ where }));
  const select = vi.fn(() => ({ from }));
  return select;
}

function makeInsertDb(
  returnedRow: InsertRow,
  opts: { ownsUpload?: boolean } = {},
) {
  const returning = vi.fn(() => Promise.resolve([returnedRow]));
  const valuesFn = vi.fn(() => ({ returning }));
  const insertFn = vi.fn(() => ({ values: valuesFn }));
  const auditValues = vi.fn(() => Promise.resolve(undefined));
  return {
    db: {
      select: makeOwnershipSelect(opts.ownsUpload ?? true),
      insert: vi
        .fn()
        .mockImplementationOnce(insertFn)
        .mockImplementationOnce(() => ({ values: auditValues })),
    } as unknown as AuditDb,
    insertFn,
    valuesFn,
    auditValues,
  };
}

describe("recordPreResultsEmotionalCheckIn", () => {
  it("inserts the row and writes an emotional_checkin.recorded audit row with {uploadId, type, state}", async () => {
    const createdAt = new Date("2026-05-30T12:00:00Z");
    const returnedRow: InsertRow = {
      id: "ec-1",
      patientId: PATIENT_ID,
      uploadId: UPLOAD_ID,
      state: "hopeful",
      type: "pre",
      privacyFlag: "patient_only",
      createdAt,
    };
    const { db, valuesFn, auditValues } = makeInsertDb(returnedRow);

    const out = await recordPreResultsEmotionalCheckIn(db, PATIENT_ID, {
      uploadId: UPLOAD_ID,
      state: "hopeful",
      type: "pre",
    });

    expect(out).toEqual(returnedRow);
    expect(valuesFn).toHaveBeenCalledWith(
      expect.objectContaining({
        patientId: PATIENT_ID,
        uploadId: UPLOAD_ID,
        state: "hopeful",
        type: "pre",
      }),
    );
    expect(auditValues).toHaveBeenCalledTimes(1);
    const firstCall = auditValues.mock.calls[0] as
      | [
          {
            event: string;
            resourceType: string;
            resourceId: string;
            actorType: string;
            actorId: string;
            metadata: Record<string, unknown>;
          },
        ]
      | undefined;
    if (!firstCall) throw new Error("audit values not called");
    const auditArg = firstCall[0];
    expect(auditArg.event).toBe("emotional_checkin.recorded");
    expect(auditArg.resourceType).toBe("emotional_checkin");
    expect(auditArg.resourceId).toBe("ec-1");
    expect(auditArg.actorType).toBe("patient");
    expect(auditArg.actorId).toBe(PATIENT_ID);
    expect(auditArg.metadata).toEqual({
      uploadId: UPLOAD_ID,
      type: "pre",
      state: "hopeful",
    });
  });

  it("on 23505 unique-violation against (upload_id, type), returns existing row WITHOUT writing a second audit", async () => {
    const createdAt = new Date("2026-05-30T12:00:00Z");
    const existing: InsertRow = {
      id: "ec-existing",
      patientId: PATIENT_ID,
      uploadId: UPLOAD_ID,
      state: "curious",
      type: "pre",
      privacyFlag: "patient_only",
      createdAt,
    };

    const insertReturning = vi.fn(() => {
      const err = new Error("duplicate") as Error & {
        code?: string;
        constraint?: string;
      };
      err.code = "23505";
      err.constraint = "emotional_checkins_upload_type_unique";
      throw err;
    });
    const insertValuesFn = vi.fn(() => ({ returning: insertReturning }));
    const insertFn = vi.fn(() => ({ values: insertValuesFn }));

    // Two SELECTs in this path: (1) ownership precondition (R1-H2),
    // (2) idempotency-shield existing-row lookup. Both return a
    // single row keyed to PATIENT_ID.
    const ownershipLimit = vi.fn(() => Promise.resolve([{ id: UPLOAD_ID }]));
    const ownershipWhere = vi.fn(() => ({ limit: ownershipLimit }));
    const ownershipFrom = vi.fn(() => ({ where: ownershipWhere }));

    const existingLimit = vi.fn(() => Promise.resolve([existing]));
    const existingWhere = vi.fn(() => ({ limit: existingLimit }));
    const existingFrom = vi.fn(() => ({ where: existingWhere }));

    const selectFn = vi
      .fn()
      .mockImplementationOnce(() => ({ from: ownershipFrom }))
      .mockImplementationOnce(() => ({ from: existingFrom }));

    const auditValues = vi.fn(() => Promise.resolve(undefined));
    const auditInsertFn = vi.fn(() => ({ values: auditValues }));

    const db = {
      insert: vi
        .fn()
        .mockImplementationOnce(insertFn)
        .mockImplementation(auditInsertFn),
      select: selectFn,
    } as unknown as AuditDb;

    const out = await recordPreResultsEmotionalCheckIn(db, PATIENT_ID, {
      uploadId: UPLOAD_ID,
      state: "worried",
      type: "pre",
    });

    expect(out).toEqual(existing);
    // Crucial: NO second audit row on idempotent retry.
    expect(auditValues).not.toHaveBeenCalled();
  });

  it("R1-H2 — throws NOT_FOUND when the upload does NOT belong to the caller", async () => {
    const ownershipLimit = vi.fn(() => Promise.resolve([]));
    const ownershipWhere = vi.fn(() => ({ limit: ownershipLimit }));
    const ownershipFrom = vi.fn(() => ({ where: ownershipWhere }));
    const selectFn = vi.fn(() => ({ from: ownershipFrom }));

    const insertFn = vi.fn();

    const db = {
      select: selectFn,
      insert: insertFn,
    } as unknown as AuditDb;

    await expect(
      recordPreResultsEmotionalCheckIn(db, PATIENT_ID, {
        uploadId: UPLOAD_ID,
        state: "hopeful",
        type: "pre",
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    // Crucial: no INSERT attempted on foreign upload.
    expect(insertFn).not.toHaveBeenCalled();
  });

  it("re-throws non-23505 errors from insert", async () => {
    const insertReturning = vi.fn(() => {
      throw new Error("boom");
    });
    const insertValuesFn = vi.fn(() => ({ returning: insertReturning }));
    const db = {
      select: makeOwnershipSelect(true),
      insert: vi.fn(() => ({ values: insertValuesFn })),
    } as unknown as AuditDb;

    await expect(
      recordPreResultsEmotionalCheckIn(db, PATIENT_ID, {
        uploadId: UPLOAD_ID,
        state: "hopeful",
        type: "pre",
      }),
    ).rejects.toThrow(/boom/);
  });

  it("re-throws 23505 against an UNRELATED constraint", async () => {
    const insertReturning = vi.fn(() => {
      const err = new Error("dup") as Error & {
        code?: string;
        constraint?: string;
      };
      err.code = "23505";
      err.constraint = "some_other_constraint";
      throw err;
    });
    const insertValuesFn = vi.fn(() => ({ returning: insertReturning }));
    const db = {
      select: makeOwnershipSelect(true),
      insert: vi.fn(() => ({ values: insertValuesFn })),
    } as unknown as AuditDb;

    await expect(
      recordPreResultsEmotionalCheckIn(db, PATIENT_ID, {
        uploadId: UPLOAD_ID,
        state: "hopeful",
        type: "pre",
      }),
    ).rejects.toThrow(/dup/);
  });

  it("throws when insert returns no row", async () => {
    const returning = vi.fn(() => Promise.resolve([]));
    const valuesFn = vi.fn(() => ({ returning }));
    const db = {
      select: makeOwnershipSelect(true),
      insert: vi.fn(() => ({ values: valuesFn })),
    } as unknown as AuditDb;

    await expect(
      recordPreResultsEmotionalCheckIn(db, PATIENT_ID, {
        uploadId: UPLOAD_ID,
        state: "hopeful",
        type: "pre",
      }),
    ).rejects.toThrow(/no row/);
  });
});
