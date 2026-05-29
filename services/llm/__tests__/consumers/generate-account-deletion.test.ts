/**
 * Story 5.6 T7.5 — `generate-account-deletion` consumer unit tests.
 *
 * Stubs the `postgres` template-tag client + Supabase Storage + Auth
 * admin surface. Exercises:
 *   - happy path: status='processing' → pseudonymize audit_log →
 *     Storage cleanup → DELETE FROM users → auth.admin.deleteUser →
 *     status='complete' + audit.deletion_completed
 *   - Storage list/remove error: continues to cascade (best-effort)
 *   - auth admin 404: treated as success
 *   - auth admin 500 on final attempt: status='failed' + audit + rethrow
 *   - idempotent retry: status='complete'/'failed' short-circuits
 *   - final-attempt programmer error (TypeError): status='failed' +
 *     audit + rethrow
 */
import { describe, expect, it, vi } from "vitest";

import { processOne } from "../../src/consumers/generate-account-deletion";

interface SqlCall {
  type: "query" | "begin";
  strings?: readonly string[];
  values?: unknown[];
  txCalls?: SqlCall[];
}

const PATIENT_ID = "00000000-0000-0000-0000-000000000001";
const REQUEST_ID = "00000000-0000-0000-0000-000000000abc";
const SALT = "test-salt";

function makeFakeSql(opts: {
  selectRequestRow: () => Promise<unknown[]>;
  selectPseudonym?: () => Promise<unknown[]>;
  capture: SqlCall[];
}) {
  let selectIdx = 0;
  const selects = [opts.selectRequestRow];

  const tag = (strings: TemplateStringsArray, ...values: unknown[]) => {
    const joined = strings.join(" ").trim().toUpperCase();
    opts.capture.push({ type: "query", strings: [...strings], values });
    if (joined.startsWith("SELECT")) {
      const fn = selects[selectIdx];
      selectIdx += 1;
      return (fn ?? (async () => []))();
    }
    return Promise.resolve([]);
  };

  (
    tag as unknown as { begin: (fn: (tx: unknown) => unknown) => unknown }
  ).begin = async (fn: (tx: unknown) => unknown) => {
    const txCalls: SqlCall[] = [];
    opts.capture.push({ type: "begin", txCalls });
    const txTag = (strings: TemplateStringsArray, ...values: unknown[]) => {
      txCalls.push({ type: "query", strings: [...strings], values });
      return Promise.resolve([]);
    };
    return await fn(txTag);
  };

  return tag as unknown as Parameters<typeof processOne>[0]["sql"];
}

function makeFakeSupabase(
  opts: {
    authError?: { status?: number; message: string } | null;
    storageListError?: { message: string } | null;
  } = {},
) {
  const removed: string[][] = [];
  return {
    storage: {
      from: (_bucket: string) => ({
        list: async () => ({
          data: opts.storageListError ? null : [],
          error: opts.storageListError ?? null,
        }),
        remove: async (paths: string[]) => {
          removed.push(paths);
          return { error: null };
        },
      }),
    },
    auth: {
      admin: {
        deleteUser: async (_id: string) => ({
          data: null,
          error: opts.authError ?? null,
        }),
      },
    },
    _removed: removed,
  } as unknown as Parameters<typeof processOne>[0]["supabase"];
}

describe("processOne (account.delete) — happy path", () => {
  it("processing → pseudonymize → cleanup → cascade → auth admin → complete + audit", async () => {
    const capture: SqlCall[] = [];
    const sql = makeFakeSql({
      capture,
      selectRequestRow: async () => [
        {
          id: REQUEST_ID,
          patient_id: PATIENT_ID,
          status: "queued",
        },
      ],
    });
    const supabase = makeFakeSupabase();

    await processOne({ sql, supabase, salt: SALT }, REQUEST_ID, PATIENT_ID, 0);

    // status='processing' UPDATE
    const procUpd = capture.find(
      (c) =>
        c.type === "query" &&
        /SET status = 'processing'/.test(c.strings?.join(" ") ?? ""),
    );
    expect(procUpd).toBeDefined();

    // Pseudonymize tx has 3 UPDATEs on audit_log.
    const pseudoTx = capture.find(
      (c) =>
        c.type === "begin" &&
        (c.txCalls ?? []).some((t) =>
          /UPDATE audit_log/.test(t.strings?.join(" ") ?? ""),
        ),
    );
    expect(pseudoTx).toBeDefined();
    expect(pseudoTx?.txCalls?.length).toBe(3);

    // DELETE FROM users
    const cascadeDel = capture.find(
      (c) =>
        c.type === "query" &&
        /DELETE FROM users/.test(c.strings?.join(" ") ?? ""),
    );
    expect(cascadeDel).toBeDefined();

    // Completion tx: status='complete' + audit insert
    const completeTx = capture
      .filter((c) => c.type === "begin")
      .find((c) =>
        (c.txCalls ?? []).some((t) =>
          /SET status = 'complete'/.test(t.strings?.join(" ") ?? ""),
        ),
      );
    expect(completeTx).toBeDefined();
    const txText =
      completeTx?.txCalls?.map((c) => c.strings?.join("")).join("|") ?? "";
    expect(txText).toContain("account.deletion_completed");
  });
});

describe("processOne (account.delete) — failure + retry semantics", () => {
  it("Storage list error: continues to cascade (best-effort)", async () => {
    const capture: SqlCall[] = [];
    const sql = makeFakeSql({
      capture,
      selectRequestRow: async () => [
        { id: REQUEST_ID, patient_id: PATIENT_ID, status: "queued" },
      ],
    });
    const supabase = makeFakeSupabase({
      storageListError: { message: "bucket not found" },
    });
    const warnSpy = vi
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);

    await processOne({ sql, supabase, salt: SALT }, REQUEST_ID, PATIENT_ID, 0);

    const cascadeDel = capture.find(
      (c) =>
        c.type === "query" &&
        /DELETE FROM users/.test(c.strings?.join(" ") ?? ""),
    );
    expect(cascadeDel).toBeDefined();
    warnSpy.mockRestore();
  });

  it("auth admin 404 is treated as success (idempotent retry)", async () => {
    const capture: SqlCall[] = [];
    const sql = makeFakeSql({
      capture,
      selectRequestRow: async () => [
        { id: REQUEST_ID, patient_id: PATIENT_ID, status: "queued" },
      ],
    });
    const supabase = makeFakeSupabase({
      authError: { status: 404, message: "User not found" },
    });
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);

    await processOne({ sql, supabase, salt: SALT }, REQUEST_ID, PATIENT_ID, 0);

    // Still flips to complete.
    const completeTx = capture
      .filter((c) => c.type === "begin")
      .find((c) =>
        (c.txCalls ?? []).some((t) =>
          /SET status = 'complete'/.test(t.strings?.join(" ") ?? ""),
        ),
      );
    expect(completeTx).toBeDefined();
    logSpy.mockRestore();
  });

  it("auth admin 500 on final attempt: status='failed' + audit + rethrow", async () => {
    const capture: SqlCall[] = [];
    const sql = makeFakeSql({
      capture,
      selectRequestRow: async () => [
        { id: REQUEST_ID, patient_id: PATIENT_ID, status: "queued" },
      ],
    });
    const supabase = makeFakeSupabase({
      authError: { status: 500, message: "Internal Server Error" },
    });
    const errSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);

    await expect(
      processOne({ sql, supabase, salt: SALT }, REQUEST_ID, PATIENT_ID, 2),
    ).rejects.toThrow(/supabase\.auth\.admin/);

    // R1 fix — final-attempt failed-audit is now pre-emitted BEFORE the
    // auth call (not in a tx) so a partial auth-side failure is traced.
    // The status='failed' UPDATE is also a bare query in catch. Verify
    // both landed somewhere in the capture.
    const allText = capture
      .flatMap((c) =>
        c.type === "begin"
          ? (c.txCalls ?? []).map((t) => t.strings?.join("") ?? "")
          : [c.strings?.join("") ?? ""],
      )
      .join("|");
    expect(allText).toContain("SET status = 'failed'");
    expect(allText).toContain("account.deletion_failed");
    errSpy.mockRestore();
  });

  it("idempotent retry: status='complete' short-circuits", async () => {
    const capture: SqlCall[] = [];
    const sql = makeFakeSql({
      capture,
      selectRequestRow: async () => [
        { id: REQUEST_ID, patient_id: PATIENT_ID, status: "complete" },
      ],
    });
    const supabase = makeFakeSupabase();
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);

    await processOne({ sql, supabase, salt: SALT }, REQUEST_ID, PATIENT_ID, 0);

    // No UPDATE / DELETE after the initial SELECT.
    const writes = capture.filter(
      (c) =>
        c.type === "query" &&
        /^\s*(UPDATE|DELETE)/i.test(c.strings?.join(" ") ?? ""),
    );
    expect(writes).toHaveLength(0);
    logSpy.mockRestore();
  });

  it("final-attempt programmer error (TypeError): persists 'failed' + audit + rethrow", async () => {
    const capture: SqlCall[] = [];
    const sql = makeFakeSql({
      capture,
      selectRequestRow: async () => [
        { id: REQUEST_ID, patient_id: PATIENT_ID, status: "queued" },
      ],
    });
    // Supabase that throws a TypeError on auth admin call.
    const supabase = {
      storage: {
        from: () => ({
          list: async () => ({ data: [], error: null }),
          remove: async () => ({ error: null }),
        }),
      },
      auth: {
        admin: {
          deleteUser: async () => {
            throw new TypeError("Cannot read properties of undefined");
          },
        },
      },
    } as unknown as Parameters<typeof processOne>[0]["supabase"];
    const errSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);

    await expect(
      processOne({ sql, supabase, salt: SALT }, REQUEST_ID, PATIENT_ID, 2),
    ).rejects.toBeInstanceOf(TypeError);

    // R1 fix — status='failed' UPDATE is now a bare query (not in a tx).
    const allText = capture
      .flatMap((c) =>
        c.type === "begin"
          ? (c.txCalls ?? []).map((t) => t.strings?.join("") ?? "")
          : [c.strings?.join("") ?? ""],
      )
      .join("|");
    expect(allText).toContain("SET status = 'failed'");
    errSpy.mockRestore();
  });
});

describe("pseudonymizePatientId — round-trip with SQL helper", () => {
  it("produces 'pseudonymized-' + 64 hex chars deterministically", async () => {
    const mod = await import("../../src/account-deletion");
    const out = mod.pseudonymizePatientId(PATIENT_ID, SALT);
    expect(out).toMatch(/^pseudonymized-[0-9a-f]{64}$/);
    // Same input → same output.
    expect(mod.pseudonymizePatientId(PATIENT_ID, SALT)).toBe(out);
    // Different salt → different output.
    expect(mod.pseudonymizePatientId(PATIENT_ID, "other-salt")).not.toBe(out);
  });
});
