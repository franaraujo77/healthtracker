import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AuditLog, Uploads } from "@healthtracker/db/schema";

import type { AuditDb } from "../src/audit";
import { appRouter } from "../src/root";
import { enqueueExtractDocument, writeUpload } from "../src/uploads";

type CallerCtx = Parameters<typeof appRouter.createCaller>[0];

const PATIENT_ID = "33333333-3333-3333-3333-333333333333";
const IDEMPOTENCY_KEY = "44444444-4444-4444-8444-444444444444";
const STORAGE_PATH = `${PATIENT_ID}/${IDEMPOTENCY_KEY}/exam.pdf`;

interface MockOpts {
  /** Rows returned by the upload INSERT's `.returning()`. Empty = conflict. */
  insertReturning?: { id: string }[];
}

/**
 * Builds a tRPC caller whose `ctx.db` mocks just enough Drizzle chain to
 * exercise the uploads router's request/confirm paths. Also stubs the
 * Supabase Storage signed-URL creation via env-vars so the resolver
 * doesn't touch network.
 */
function makeCaller(opts: MockOpts = {}) {
  const insertReturning = opts.insertReturning ?? [{ id: "upload-1" }];

  const uploadChain = {
    values: vi.fn(() => uploadChain),
    onConflictDoNothing: vi.fn(() => uploadChain),
    returning: vi.fn(() => Promise.resolve(insertReturning)),
  };
  const auditValues = vi.fn(() => Promise.resolve(undefined));

  const insert = vi.fn((table: unknown) =>
    table === Uploads ? uploadChain : { values: auditValues },
  );

  const execute = vi.fn(() => Promise.resolve(undefined));

  const tx = {
    execute,
    select: vi.fn(),
    insert,
    update: vi.fn(),
  };
  const db = { transaction: (cb: (tx: unknown) => unknown) => cb(tx) };

  const ctx = {
    session: { user: { id: PATIENT_ID } },
    db,
    headers: new Headers(),
    shareTokenId: undefined,
  } as unknown as CallerCtx;

  return {
    caller: appRouter.createCaller(ctx),
    insert,
    uploadChain,
    auditValues,
    execute,
  };
}

beforeEach(() => {
  // The signed-URL helper reads SUPABASE_SERVICE_ROLE_KEY +
  // NEXT_PUBLIC_SUPABASE_URL from process.env and constructs a Supabase
  // client. For unit tests we monkey-patch the `createClient` import
  // from `@healthtracker/auth` via vi.mock below.
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://stub.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role";
});

afterEach(() => {
  vi.resetModules();
});

// Per-test override hook for the storage list() mock so the
// confirmImport tests can simulate object-not-found vs object-present.
const storageListHandler = {
  current: (
    _prefix: string,
    _search: string | undefined,
  ): Promise<{
    data: { name: string; metadata?: { size: number; mimetype: string } }[];
    error: null;
  }> =>
    Promise.resolve({
      data: [
        {
          name: "exam.pdf",
          metadata: { size: 2048, mimetype: "application/pdf" },
        },
      ],
      error: null,
    }),
};

vi.mock("@healthtracker/auth", () => {
  return {
    createClient: vi.fn(() => ({
      storage: {
        from: () => ({
          createSignedUploadUrl: vi.fn((path: string) =>
            Promise.resolve({
              data: {
                signedUrl: `https://stub.supabase.co/storage/v1/object/upload/sign/${path}?token=stub`,
              },
              error: null,
            }),
          ),
          list: vi.fn(
            (prefix: string, opts?: { search?: string; limit?: number }) =>
              storageListHandler.current(prefix, opts?.search),
          ),
        }),
      },
    })),
  };
});

describe("uploads.requestImport", () => {
  it("returns a signed upload URL with patient-prefixed storagePath", async () => {
    const { caller } = makeCaller();

    const result = await caller.uploads.requestImport({
      originalFilename: "exam.pdf",
      mimeType: "application/pdf",
      sizeBytes: 1024,
    });

    expect(result.idempotencyKey).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
    expect(result.storagePath.startsWith(`${PATIENT_ID}/`)).toBe(true);
    expect(result.storagePath.endsWith("/exam.pdf")).toBe(true);
    expect(result.uploadUrl).toContain("/storage/v1/object/upload/sign/");
  });

  it("sanitizes the filename — strips path separators before signing", async () => {
    const { caller } = makeCaller();

    const result = await caller.uploads.requestImport({
      originalFilename: "../../etc/passwd",
      mimeType: "application/pdf",
      sizeBytes: 512,
    });

    // The sanitized filename must not contain path separators.
    expect(result.storagePath).not.toContain("../");
    expect(result.storagePath.startsWith(`${PATIENT_ID}/`)).toBe(true);
  });

  it("rejects files larger than UPLOAD_MAX_BYTES via Zod", async () => {
    const { caller } = makeCaller();

    await expect(
      caller.uploads.requestImport({
        originalFilename: "huge.pdf",
        mimeType: "application/pdf",
        sizeBytes: 10 * 1024 * 1024,
      }),
    ).rejects.toThrow();
  });

  it("rejects unsupported mime types via Zod", async () => {
    const { caller } = makeCaller();

    await expect(
      caller.uploads.requestImport({
        originalFilename: "doc.docx",
        mimeType:
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document" as never,
        sizeBytes: 1024,
      }),
    ).rejects.toThrow();
  });
});

describe("uploads.confirmImport", () => {
  it("inserts the uploads row, enqueues a job, and emits an upload.queued audit event when none exists", async () => {
    const { caller, uploadChain, insert, auditValues, execute } = makeCaller({
      insertReturning: [{ id: "upload-1" }],
    });

    const result = await caller.uploads.confirmImport({
      idempotencyKey: IDEMPOTENCY_KEY,
      originalFilename: "exam.pdf",
      mimeType: "application/pdf",
      sizeBytes: 2048,
    });

    expect(result).toEqual({ uploadId: "upload-1", created: true });
    expect(insert).toHaveBeenCalledWith(Uploads);
    expect(uploadChain.values).toHaveBeenCalledWith(
      expect.objectContaining({
        patientId: PATIENT_ID,
        idempotencyKey: IDEMPOTENCY_KEY,
        // Review P38 — server-derived storagePath, not client-supplied.
        storagePath: STORAGE_PATH,
        mimeType: "application/pdf",
        // Review P42 — server-reported size from storage.list.
        sizeBytes: 2048,
        originalFilename: "exam.pdf",
        source: "onboarding_import",
        status: "queued",
      }),
    );
    expect(uploadChain.onConflictDoNothing).toHaveBeenCalled();
    // Enqueue: one extra `tx.execute(...)` for the pgboss.job INSERT on
    // top of the two `SET LOCAL` calls protectedProcedure issues per
    // resolver. Total: 3 executes (2 RLS + 1 enqueue).
    expect(execute).toHaveBeenCalledTimes(3);
    // Audit emitted once with the upload row id.
    expect(insert).toHaveBeenCalledWith(AuditLog);
    expect(auditValues).toHaveBeenCalledWith({
      actorId: PATIENT_ID,
      actorType: "patient",
      event: "upload.queued",
      resourceId: "upload-1",
      resourceType: "upload",
      metadata: {
        source: "onboarding_import",
        mimeType: "application/pdf",
        // Review P42 — audit records the storage-reported size, not
        // the patient's claim.
        sizeBytes: 2048,
        actor: "self",
      },
    });
  });

  it("is idempotent: ON CONFLICT returns empty → returns { created: false }, no enqueue, no audit", async () => {
    const { caller, insert, auditValues, execute } = makeCaller({
      insertReturning: [],
    });

    const result = await caller.uploads.confirmImport({
      idempotencyKey: IDEMPOTENCY_KEY,
      originalFilename: "exam.pdf",
      mimeType: "application/pdf",
      sizeBytes: 2048,
    });

    expect(result).toEqual({ uploadId: null, created: false });
    // `execute` is still called twice for the protectedProcedure
    // SET-LOCAL setup; but the pgboss.job INSERT (the third call we'd
    // see on the happy path) must NOT happen on the idempotent path.
    expect(execute).toHaveBeenCalledTimes(2);
    expect(insert).not.toHaveBeenCalledWith(AuditLog);
    expect(auditValues).not.toHaveBeenCalled();
  });

  it("rejects with NOT_FOUND when no storage object exists at the server-derived path (round-1 P39)", async () => {
    const { caller, insert, auditValues } = makeCaller();
    const previous = storageListHandler.current;
    storageListHandler.current = () =>
      Promise.resolve({ data: [], error: null });
    try {
      await expect(
        caller.uploads.confirmImport({
          idempotencyKey: IDEMPOTENCY_KEY,
          originalFilename: "exam.pdf",
          mimeType: "application/pdf",
          sizeBytes: 2048,
        }),
      ).rejects.toMatchObject({
        code: "NOT_FOUND",
        message: "UPLOAD_OBJECT_NOT_FOUND",
      });
      expect(insert).not.toHaveBeenCalledWith(Uploads);
      expect(insert).not.toHaveBeenCalledWith(AuditLog);
      expect(auditValues).not.toHaveBeenCalled();
    } finally {
      storageListHandler.current = previous;
    }
  });

  it("rejects with PAYLOAD_TOO_LARGE when the storage object exceeds UPLOAD_MAX_BYTES (round-2 P51)", async () => {
    const { caller, insert } = makeCaller();
    const previous = storageListHandler.current;
    // 10 MB — beyond the 5 MB UPLOAD_MAX_BYTES cap.
    storageListHandler.current = () =>
      Promise.resolve({
        data: [
          {
            name: "exam.pdf",
            metadata: { size: 10 * 1024 * 1024, mimetype: "application/pdf" },
          },
        ],
        error: null,
      });
    try {
      await expect(
        caller.uploads.confirmImport({
          idempotencyKey: IDEMPOTENCY_KEY,
          originalFilename: "exam.pdf",
          mimeType: "application/pdf",
          sizeBytes: 1024,
        }),
      ).rejects.toMatchObject({
        code: "PAYLOAD_TOO_LARGE",
        message: "UPLOAD_OBJECT_TOO_LARGE",
      });
      expect(insert).not.toHaveBeenCalledWith(Uploads);
    } finally {
      storageListHandler.current = previous;
    }
  });

  it("rejects with BAD_REQUEST when Supabase reports a non-allowlisted content type (round-2 P49)", async () => {
    const { caller, insert } = makeCaller();
    const previous = storageListHandler.current;
    storageListHandler.current = () =>
      Promise.resolve({
        data: [
          {
            name: "exam.pdf",
            metadata: { size: 2048, mimetype: "application/octet-stream" },
          },
        ],
        error: null,
      });
    try {
      await expect(
        caller.uploads.confirmImport({
          idempotencyKey: IDEMPOTENCY_KEY,
          originalFilename: "exam.pdf",
          mimeType: "application/pdf",
          sizeBytes: 2048,
        }),
      ).rejects.toMatchObject({
        code: "BAD_REQUEST",
        message: "UPLOAD_OBJECT_UNSUPPORTED_MIME",
      });
      expect(insert).not.toHaveBeenCalledWith(Uploads);
    } finally {
      storageListHandler.current = previous;
    }
  });
});

describe("writeUpload", () => {
  it("inserts via Drizzle and returns the new row id", async () => {
    const returning = vi.fn(() => Promise.resolve([{ id: "u-1" }]));
    const onConflictDoNothing = vi.fn(() => ({ returning }));
    const values = vi.fn(() => ({ onConflictDoNothing }));
    const db = { insert: vi.fn(() => ({ values })) } as unknown as AuditDb;

    const row = await writeUpload(db, {
      patientId: PATIENT_ID,
      idempotencyKey: IDEMPOTENCY_KEY,
      storagePath: STORAGE_PATH,
      mimeType: "application/pdf",
      sizeBytes: 1024,
      originalFilename: "exam.pdf",
      source: "onboarding_import",
    });

    expect(row).toEqual({ id: "u-1" });
    expect(values).toHaveBeenCalledWith(
      expect.objectContaining({
        patientId: PATIENT_ID,
        idempotencyKey: IDEMPOTENCY_KEY,
        status: "queued",
      }),
    );
  });

  it("returns null when ON CONFLICT collapses a duplicate idempotency_key", async () => {
    const returning = vi.fn(() => Promise.resolve([]));
    const onConflictDoNothing = vi.fn(() => ({ returning }));
    const values = vi.fn(() => ({ onConflictDoNothing }));
    const db = { insert: vi.fn(() => ({ values })) } as unknown as AuditDb;

    const row = await writeUpload(db, {
      patientId: PATIENT_ID,
      idempotencyKey: IDEMPOTENCY_KEY,
      storagePath: STORAGE_PATH,
      mimeType: "application/pdf",
      sizeBytes: 1024,
      originalFilename: "exam.pdf",
      source: "onboarding_import",
    });

    expect(row).toBeNull();
  });

  it("propagates DB errors (e.g., RLS 42501) so the outer transaction rolls back", async () => {
    const rlsError = Object.assign(
      new Error("new row violates row-level security policy"),
      { code: "42501" },
    );
    const returning = vi.fn(() => Promise.reject(rlsError));
    const onConflictDoNothing = vi.fn(() => ({ returning }));
    const values = vi.fn(() => ({ onConflictDoNothing }));
    const db = { insert: vi.fn(() => ({ values })) } as unknown as AuditDb;

    await expect(
      writeUpload(db, {
        patientId: PATIENT_ID,
        idempotencyKey: IDEMPOTENCY_KEY,
        storagePath: STORAGE_PATH,
        mimeType: "application/pdf",
        sizeBytes: 1024,
        originalFilename: "exam.pdf",
        source: "onboarding_import",
      }),
    ).rejects.toMatchObject({ code: "42501" });
  });
});

describe("enqueueExtractDocument", () => {
  it("issues a single INSERT INTO pgboss.job with a JobPayload-wrapped ExtractDocumentPayload", async () => {
    const execute = vi.fn(() => Promise.resolve(undefined));
    const db = { execute } as unknown as AuditDb;

    await enqueueExtractDocument(db, {
      patientId: PATIENT_ID,
      payload: {
        uploadId: "upload-1",
        storagePath: STORAGE_PATH,
        idempotencyKey: IDEMPOTENCY_KEY,
        mimeType: "application/pdf",
      },
    });

    expect(execute).toHaveBeenCalledTimes(1);
  });
});
