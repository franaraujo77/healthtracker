import { describe, expect, it, vi } from "vitest";

import {
  ACCESS_LOG_EVENT_KINDS,
  attachVoiceMemoInputSchema,
  isOwnVoiceMemoStoragePath,
  VOICE_MEMO_MAX_DURATION_MS,
  VOICE_MEMOS_STORAGE_BUCKET,
  voiceMemoStoragePath,
} from "@healthtracker/validators";

import type { AuditDb } from "../src/audit";

const PATIENT_ID = "11111111-1111-4111-8111-111111111111";
const UPLOAD_ID = "22222222-2222-4222-8222-222222222222";

// Mock the supabase admin client BEFORE importing the helper (since
// the helper imports getSupabaseAdminClient at module scope).
vi.mock("../src/storage", () => ({
  getSupabaseAdminClient: vi.fn(),
}));

const { getSupabaseAdminClient } = await import("../src/storage");
const { attachVoiceMemoToUpload } = await import("../src/voice-memos");

const getAdminMock = vi.mocked(getSupabaseAdminClient);

interface InsertRow {
  id: string;
  patientId: string;
  uploadId: string;
  storagePath: string;
  durationMs: number;
  privacyFlag: "patient_only";
  createdAt: Date;
}

/**
 * R1-H4 — the Storage list mock must echo the exact basename the
 * resolver searched for so the exact-name assertion passes. Pass
 * `null` to simulate a not-found probe.
 */
function makeStorageMock(matchBasename: string | null) {
  const list = vi.fn((_dir: string, opts: { search: string }) =>
    Promise.resolve({
      data: matchBasename === null ? [] : [{ name: opts.search }],
      error: null,
    }),
  );
  return {
    storage: {
      from: vi.fn(() => ({ list })),
    },
  };
}

function makeOwnershipSelect(owns: boolean) {
  const limit = vi.fn(() => Promise.resolve(owns ? [{ id: UPLOAD_ID }] : []));
  const where = vi.fn(() => ({ limit }));
  const from = vi.fn(() => ({ where }));
  return vi.fn(() => ({ from }));
}

function makeHappyPathDb(returnedRow: InsertRow) {
  const returning = vi.fn(() => Promise.resolve([returnedRow]));
  const valuesFn = vi.fn(() => ({ returning }));
  const insertFn = vi.fn(() => ({ values: valuesFn }));
  const auditValues = vi.fn(() => Promise.resolve(undefined));
  return {
    db: {
      select: makeOwnershipSelect(true),
      insert: vi
        .fn()
        .mockImplementationOnce(insertFn)
        .mockImplementationOnce(() => ({ values: auditValues })),
    } as unknown as AuditDb,
    valuesFn,
    auditValues,
  };
}

describe("Story 7.4 — validators", () => {
  it("AC6 — 'voice_memo.recorded' is NOT in ACCESS_LOG_EVENT_KINDS", () => {
    expect(ACCESS_LOG_EVENT_KINDS as readonly string[]).not.toContain(
      "voice_memo.recorded",
    );
  });

  it("voiceMemoStoragePath emits `<patientId>/<voiceMemoId>.m4a`", () => {
    expect(voiceMemoStoragePath(PATIENT_ID, "abc")).toBe(
      `${PATIENT_ID}/abc.m4a`,
    );
  });

  it("isOwnVoiceMemoStoragePath rejects foreign-prefixed paths", () => {
    expect(
      isOwnVoiceMemoStoragePath(`${PATIENT_ID}/memo.m4a`, PATIENT_ID),
    ).toBe(true);
    expect(
      isOwnVoiceMemoStoragePath(
        "33333333-3333-3333-3333-333333333333/memo.m4a",
        PATIENT_ID,
      ),
    ).toBe(false);
  });

  it("R1-M1 — isOwnVoiceMemoStoragePath rejects path traversal", () => {
    expect(
      isOwnVoiceMemoStoragePath(`${PATIENT_ID}/../foreign/x.m4a`, PATIENT_ID),
    ).toBe(false);
    expect(
      isOwnVoiceMemoStoragePath(`${PATIENT_ID}/sub/x.m4a`, PATIENT_ID),
    ).toBe(false);
    expect(
      isOwnVoiceMemoStoragePath(`${PATIENT_ID}\\foreign\\x.m4a`, PATIENT_ID),
    ).toBe(false);
  });

  it("attachVoiceMemoInputSchema enforces duration bounds and strict keys", () => {
    expect(
      attachVoiceMemoInputSchema.safeParse({
        uploadId: UPLOAD_ID,
        storagePath: `${PATIENT_ID}/x.m4a`,
        durationMs: 5000,
      }).success,
    ).toBe(true);

    expect(
      attachVoiceMemoInputSchema.safeParse({
        uploadId: UPLOAD_ID,
        storagePath: `${PATIENT_ID}/x.m4a`,
        durationMs: 0,
      }).success,
    ).toBe(false);

    expect(
      attachVoiceMemoInputSchema.safeParse({
        uploadId: UPLOAD_ID,
        storagePath: `${PATIENT_ID}/x.m4a`,
        durationMs: VOICE_MEMO_MAX_DURATION_MS + 1,
      }).success,
    ).toBe(false);

    expect(
      attachVoiceMemoInputSchema.safeParse({
        uploadId: UPLOAD_ID,
        storagePath: `${PATIENT_ID}/x.m4a`,
        durationMs: 1000,
        extra: "nope",
      }).success,
    ).toBe(false);
  });
});

describe("attachVoiceMemoToUpload", () => {
  it("happy path: inserts row + audit with metadata {uploadId, durationMs} (no storagePath)", async () => {
    const returnedRow: InsertRow = {
      id: "vm-1",
      patientId: PATIENT_ID,
      uploadId: UPLOAD_ID,
      storagePath: `${PATIENT_ID}/vm.m4a`,
      durationMs: 5000,
      privacyFlag: "patient_only",
      createdAt: new Date(),
    };
    const { db, auditValues } = makeHappyPathDb(returnedRow);
    getAdminMock.mockReturnValue(
      makeStorageMock("found") as unknown as ReturnType<
        typeof getSupabaseAdminClient
      >,
    );

    const out = await attachVoiceMemoToUpload(db, PATIENT_ID, {
      uploadId: UPLOAD_ID,
      storagePath: `${PATIENT_ID}/vm.m4a`,
      durationMs: 5000,
    });

    expect(out).toEqual(returnedRow);
    expect(auditValues).toHaveBeenCalledTimes(1);
    const firstCall = auditValues.mock.calls[0] as unknown as
      | [{ event: string; metadata: Record<string, unknown> }]
      | undefined;
    if (!firstCall) throw new Error("audit not called");
    expect(firstCall[0].event).toBe("voice_memo.recorded");
    // PII discipline — storagePath MUST NOT appear in audit metadata.
    expect(firstCall[0].metadata).toEqual({
      uploadId: UPLOAD_ID,
      durationMs: 5000,
    });
    expect(JSON.stringify(firstCall[0].metadata)).not.toContain("m4a");
  });

  it("throws NOT_FOUND when the upload does not belong to caller", async () => {
    const db = {
      select: makeOwnershipSelect(false),
      insert: vi.fn(),
    } as unknown as AuditDb;

    await expect(
      attachVoiceMemoToUpload(db, PATIENT_ID, {
        uploadId: UPLOAD_ID,
        storagePath: `${PATIENT_ID}/x.m4a`,
        durationMs: 5000,
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND", message: "UPLOAD_NOT_FOUND" });
  });

  it("throws BAD_REQUEST when the storagePath does not start with the patient id", async () => {
    const db = {
      select: makeOwnershipSelect(true),
      insert: vi.fn(),
    } as unknown as AuditDb;

    await expect(
      attachVoiceMemoToUpload(db, PATIENT_ID, {
        uploadId: UPLOAD_ID,
        storagePath: "33333333-3333-3333-3333-333333333333/x.m4a",
        durationMs: 5000,
      }),
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "INVALID_STORAGE_PATH",
    });
  });

  it("throws NOT_FOUND when the storage object does not exist", async () => {
    const db = {
      select: makeOwnershipSelect(true),
      insert: vi.fn(),
    } as unknown as AuditDb;
    getAdminMock.mockReturnValue(
      makeStorageMock(null) as unknown as ReturnType<
        typeof getSupabaseAdminClient
      >,
    );

    await expect(
      attachVoiceMemoToUpload(db, PATIENT_ID, {
        uploadId: UPLOAD_ID,
        storagePath: `${PATIENT_ID}/x.m4a`,
        durationMs: 5000,
      }),
    ).rejects.toMatchObject({
      code: "NOT_FOUND",
      message: "STORAGE_OBJECT_MISSING",
    });
  });

  it("23505 idempotency shield returns existing row, no second audit", async () => {
    const existing: InsertRow = {
      id: "vm-existing",
      patientId: PATIENT_ID,
      uploadId: UPLOAD_ID,
      storagePath: `${PATIENT_ID}/existing.m4a`,
      durationMs: 7000,
      privacyFlag: "patient_only",
      createdAt: new Date(),
    };

    const insertReturning = vi.fn(() => {
      const err = new Error("dup") as Error & {
        code?: string;
        constraint?: string;
      };
      err.code = "23505";
      err.constraint = "voice_memos_upload_unique";
      throw err;
    });
    const insertValues = vi.fn(() => ({ returning: insertReturning }));
    const insertFn = vi.fn(() => ({ values: insertValues }));

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
      select: selectFn,
      insert: vi
        .fn()
        .mockImplementationOnce(insertFn)
        .mockImplementation(auditInsertFn),
    } as unknown as AuditDb;

    getAdminMock.mockReturnValue(
      makeStorageMock("found") as unknown as ReturnType<
        typeof getSupabaseAdminClient
      >,
    );

    const out = await attachVoiceMemoToUpload(db, PATIENT_ID, {
      uploadId: UPLOAD_ID,
      storagePath: `${PATIENT_ID}/x.m4a`,
      durationMs: 5000,
    });

    expect(out).toEqual(existing);
    expect(auditValues).not.toHaveBeenCalled();
  });

  it("R1-H4 — fuzzy Storage list match that returns a non-exact name throws STORAGE_OBJECT_MISSING", async () => {
    const db = {
      select: makeOwnershipSelect(true),
      insert: vi.fn(),
    } as unknown as AuditDb;
    // Simulate Supabase's fuzzy `search` returning a different file
    // whose name CONTAINS the requested basename as a substring.
    const list = vi.fn(() =>
      Promise.resolve({
        data: [{ name: "vm-substring.m4a" }],
        error: null,
      }),
    );
    getAdminMock.mockReturnValue({
      storage: { from: vi.fn(() => ({ list })) },
    } as unknown as ReturnType<typeof getSupabaseAdminClient>);

    await expect(
      attachVoiceMemoToUpload(db, PATIENT_ID, {
        uploadId: UPLOAD_ID,
        storagePath: `${PATIENT_ID}/vm.m4a`,
        durationMs: 5000,
      }),
    ).rejects.toMatchObject({
      code: "NOT_FOUND",
      message: "STORAGE_OBJECT_MISSING",
    });
  });

  it("checks the right Storage bucket", async () => {
    const { db } = makeHappyPathDb({
      id: "vm-2",
      patientId: PATIENT_ID,
      uploadId: UPLOAD_ID,
      storagePath: `${PATIENT_ID}/y.m4a`,
      durationMs: 1000,
      privacyFlag: "patient_only",
      createdAt: new Date(),
    });
    const storageMock = makeStorageMock("found");
    getAdminMock.mockReturnValue(
      storageMock as unknown as ReturnType<typeof getSupabaseAdminClient>,
    );

    await attachVoiceMemoToUpload(db, PATIENT_ID, {
      uploadId: UPLOAD_ID,
      storagePath: `${PATIENT_ID}/y.m4a`,
      durationMs: 1000,
    });

    expect(storageMock.storage.from).toHaveBeenCalledWith(
      VOICE_MEMOS_STORAGE_BUCKET,
    );
  });
});
