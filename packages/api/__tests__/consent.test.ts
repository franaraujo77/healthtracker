import { TRPCError } from "@trpc/server";
import { describe, expect, it, vi } from "vitest";

import { AuditLog, ConsentGrants } from "@healthtracker/db/schema";

import type { AuditDb } from "../src/audit";
import { writeConsentGrant, writeConsentRevocation } from "../src/consent";
import { consentRequiredProcedure } from "../src/middleware/consent";
import { appRouter } from "../src/root";
import { createTRPCRouter } from "../src/trpc";

type CallerCtx = Parameters<typeof appRouter.createCaller>[0];

const PATIENT_ID = "22222222-2222-2222-2222-222222222222";
const VERSION = "2026-05-19";

interface MockOpts {
  /** Rows returned by the insert's `.returning()`. Empty = conflict path. */
  insertGrantReturning?: { id: string }[];
  /** Existing-grant rows returned by the post-conflict SELECT or by `list`. */
  selectRows?: {
    id: string;
    consentType?: string;
    version?: string;
    grantedAt?: Date;
  }[];
  /**
   * Rows returned by the revoke UPDATE's `.returning()`. Empty = no
   * active grant (idempotent revoke path).
   */
  revokeReturning?: { id: string; version: string }[];
}

/**
 * Builds a tRPC caller whose `ctx.db` mocks just enough Drizzle chain to
 * exercise the consent router's new insert-with-onConflict + fallback
 * lookup path. The same `select` chain handles `.limit(1)` (existence
 * lookup) and `.orderBy(...)` (list query); tests configure return values
 * via `MockOpts`.
 */
function makeCaller(opts: MockOpts = {}) {
  const insertGrantReturning = opts.insertGrantReturning ?? [
    { id: "grant-new" },
  ];
  const selectRows = opts.selectRows ?? [];
  const revokeReturning = opts.revokeReturning ?? [];

  const selectChain = {
    from: vi.fn(() => selectChain),
    where: vi.fn(() => selectChain),
    limit: vi.fn(() => Promise.resolve(selectRows)),
    orderBy: vi.fn(() => Promise.resolve(selectRows)),
  };

  const consentChain = {
    values: vi.fn(() => consentChain),
    onConflictDoNothing: vi.fn(() => consentChain),
    returning: vi.fn(() => Promise.resolve(insertGrantReturning)),
  };
  const auditValues = vi.fn(() => Promise.resolve(undefined));

  const insert = vi.fn((table: unknown) =>
    table === ConsentGrants ? consentChain : { values: auditValues },
  );

  // The `update` chain mirrors the Drizzle UPDATE shape:
  //   db.update(ConsentGrants).set(...).where(...).returning(...)
  const updateChain = {
    set: vi.fn(() => updateChain),
    where: vi.fn(() => updateChain),
    returning: vi.fn(() => Promise.resolve(revokeReturning)),
  };
  const update = vi.fn(() => updateChain);

  const tx = {
    execute: vi.fn(() => Promise.resolve(undefined)),
    select: vi.fn(() => selectChain),
    insert,
    update,
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
    consentChain,
    auditValues,
    update,
    updateChain,
  };
}

describe("consent.grant", () => {
  it("inserts a row and emits a consent.granted audit event when none exists", async () => {
    const { caller, insert, consentChain, auditValues } = makeCaller({
      insertGrantReturning: [{ id: "grant-1" }],
    });

    const result = await caller.consent.grant({
      consentType: "blood_test_results",
      version: VERSION,
    });

    expect(result).toEqual({ grantId: "grant-1", created: true });
    expect(insert).toHaveBeenCalledWith(ConsentGrants);
    expect(consentChain.values).toHaveBeenCalledWith({
      patientId: PATIENT_ID,
      consentType: "blood_test_results",
      version: VERSION,
      metadata: {},
    });
    expect(consentChain.onConflictDoNothing).toHaveBeenCalled();
    expect(insert).toHaveBeenCalledWith(AuditLog);
    expect(auditValues).toHaveBeenCalledWith({
      actorId: PATIENT_ID,
      actorType: "patient",
      event: "consent.granted",
      resourceId: "grant-1",
      resourceType: "consent_grant",
      metadata: {
        consentType: "blood_test_results",
        version: VERSION,
        actor: "self",
      },
    });
  });

  it("is idempotent: ON CONFLICT returns empty, fallback select returns the existing grant, no audit written", async () => {
    const { caller, insert, auditValues } = makeCaller({
      insertGrantReturning: [],
      selectRows: [{ id: "grant-existing" }],
    });

    const result = await caller.consent.grant({
      consentType: "blood_test_results",
      version: VERSION,
    });

    expect(result).toEqual({ grantId: "grant-existing", created: false });
    expect(insert).not.toHaveBeenCalledWith(AuditLog);
    expect(auditValues).not.toHaveBeenCalled();
  });

  it("throws INTERNAL_SERVER_ERROR when ON CONFLICT matched but the row vanished before the fallback SELECT", async () => {
    const { caller } = makeCaller({
      insertGrantReturning: [],
      selectRows: [],
    });

    await expect(
      caller.consent.grant({
        consentType: "blood_test_results",
        version: VERSION,
      }),
    ).rejects.toMatchObject({
      code: "INTERNAL_SERVER_ERROR",
      message: "CONSENT_GRANT_CONFLICT_RESOLUTION_FAILED",
    });
  });
});

describe("consent.decline", () => {
  it("writes a consent.declined audit event and does not insert a grant", async () => {
    const { caller, insert, consentChain, auditValues } = makeCaller();

    const result = await caller.consent.decline({
      consentType: "ai_narrative",
      version: VERSION,
    });

    expect(result).toEqual({ acknowledged: true });
    expect(insert).toHaveBeenCalledWith(AuditLog);
    expect(insert).not.toHaveBeenCalledWith(ConsentGrants);
    expect(consentChain.values).not.toHaveBeenCalled();
    expect(auditValues).toHaveBeenCalledWith({
      actorId: PATIENT_ID,
      actorType: "patient",
      event: "consent.declined",
      resourceId: PATIENT_ID,
      resourceType: "consent_grant",
      metadata: {
        consentType: "ai_narrative",
        version: VERSION,
        actor: "self",
      },
    });
  });
});

describe("consent.list", () => {
  it("returns one row per consent_type, keeping the most recent grant", async () => {
    const newer = new Date("2026-05-19T12:00:00Z");
    const older = new Date("2026-05-18T12:00:00Z");
    const { caller } = makeCaller({
      // Pre-sorted desc by grantedAt as the resolver expects.
      selectRows: [
        {
          id: "g-blood-new",
          consentType: "blood_test_results",
          version: VERSION,
          grantedAt: newer,
        },
        {
          id: "g-blood-old",
          consentType: "blood_test_results",
          version: "2026-05-01",
          grantedAt: older,
        },
        {
          id: "g-bia",
          consentType: "bioimpedance",
          version: VERSION,
          grantedAt: newer,
        },
      ],
    });

    const rows = await caller.consent.list();

    expect(rows.map((r) => r.id)).toEqual(["g-blood-new", "g-bia"]);
  });

  it("emits exactly one consent.read audit event when surface is 'settings'", async () => {
    const { caller, insert, auditValues } = makeCaller({
      selectRows: [
        {
          id: "g-bia",
          consentType: "bioimpedance",
          version: VERSION,
          grantedAt: new Date("2026-05-19T12:00:00Z"),
        },
      ],
    });

    await caller.consent.list({ surface: "settings" });

    expect(insert).toHaveBeenCalledWith(AuditLog);
    expect(auditValues).toHaveBeenCalledTimes(1);
    expect(auditValues).toHaveBeenCalledWith({
      actorId: PATIENT_ID,
      actorType: "patient",
      event: "consent.read",
      resourceId: PATIENT_ID,
      resourceType: "consent_grant",
      metadata: { surface: "settings", actor: "self" },
    });
  });

  it("emits no audit event under the default surface (preserves callback consumers)", async () => {
    const { caller, insert, auditValues } = makeCaller({
      selectRows: [
        {
          id: "g-bia",
          consentType: "bioimpedance",
          version: VERSION,
          grantedAt: new Date("2026-05-19T12:00:00Z"),
        },
      ],
    });

    await caller.consent.list();

    expect(insert).not.toHaveBeenCalledWith(AuditLog);
    expect(auditValues).not.toHaveBeenCalled();
  });
});

describe("consent.revoke", () => {
  it("UPDATEs revoked_at on the active row and emits a consent.revoked audit", async () => {
    const { caller, update, updateChain, insert, auditValues } = makeCaller({
      revokeReturning: [{ id: "grant-1", version: VERSION }],
    });

    const result = await caller.consent.revoke({
      consentType: "blood_test_results",
    });

    expect(result).toEqual({
      revoked: true,
      grantId: "grant-1",
      version: VERSION,
    });
    expect(update).toHaveBeenCalledWith(ConsentGrants);
    expect(updateChain.set).toHaveBeenCalled();
    expect(insert).toHaveBeenCalledWith(AuditLog);
    expect(auditValues).toHaveBeenCalledWith({
      actorId: PATIENT_ID,
      actorType: "patient",
      event: "consent.revoked",
      resourceId: "grant-1",
      resourceType: "consent_grant",
      metadata: {
        consentType: "blood_test_results",
        version: VERSION,
        actor: "self",
      },
    });
  });

  it("is idempotent: returns { revoked: false } and emits no audit when no active grant exists", async () => {
    const { caller, update, insert, auditValues } = makeCaller({
      revokeReturning: [],
    });

    const result = await caller.consent.revoke({
      consentType: "bioimpedance",
    });

    expect(result).toEqual({ revoked: false });
    expect(update).toHaveBeenCalledWith(ConsentGrants);
    expect(insert).not.toHaveBeenCalledWith(AuditLog);
    expect(auditValues).not.toHaveBeenCalled();
  });

  it("propagates audit-write failures so the outer protectedProcedure transaction rolls back the UPDATE (round-2 P36)", async () => {
    // The audit insert rejects; the resolver must reject. tRPC wraps
    // the underlying error in a TRPCError whose `cause` is the original
    // — verify both layers. The surrounding `ctx.db.transaction(...)`
    // wrap (set up by protectedProcedure in `packages/api/src/trpc.ts`)
    // is what makes the rejection roll back the prior UPDATE on
    // `consent_grants`; the client retry then sees the still-active
    // grant and re-revokes — no audit gap, no silent state.
    const auditError: Error & { code: string } = Object.assign(
      new Error("audit insert failed"),
      { code: "23514" },
    );
    const { caller } = makeCallerWithAuditReject(auditError);

    await expect(
      caller.consent.revoke({ consentType: "blood_test_results" }),
    ).rejects.toMatchObject({
      cause: { code: "23514", message: "audit insert failed" },
    });
  });
});

/**
 * Builds a caller where the audit insert's `.values(...)` rejects so we
 * can exercise the "audit-throws-rolls-back-update" atomicity guarantee.
 * Separate from `makeCaller` because the rejection shape is otherwise
 * intrusive to thread through `MockOpts`.
 */
function makeCallerWithAuditReject(error: Error) {
  const consentChain = {
    values: vi.fn(() => consentChain),
    onConflictDoNothing: vi.fn(() => consentChain),
    returning: vi.fn(() => Promise.resolve([{ id: "grant-1" }])),
  };
  const auditValues = vi.fn(() => Promise.reject(error));

  const insert = vi.fn((table: unknown) =>
    table === ConsentGrants ? consentChain : { values: auditValues },
  );

  const updateChain = {
    set: vi.fn(() => updateChain),
    where: vi.fn(() => updateChain),
    returning: vi.fn(() =>
      Promise.resolve([{ id: "grant-1", version: VERSION }]),
    ),
  };
  const update = vi.fn(() => updateChain);

  const tx = {
    execute: vi.fn(() => Promise.resolve(undefined)),
    select: vi.fn(() => ({
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn(() => Promise.resolve([])),
      orderBy: vi.fn(() => Promise.resolve([])),
    })),
    insert,
    update,
  };
  const db = { transaction: (cb: (tx: unknown) => unknown) => cb(tx) };

  const ctx = {
    session: { user: { id: PATIENT_ID } },
    db,
    headers: new Headers(),
    shareTokenId: undefined,
  } as unknown as CallerCtx;

  return { caller: appRouter.createCaller(ctx) };
}

describe("writeConsentGrant", () => {
  it("inserts the entry and returns the new row id", async () => {
    const returning = vi.fn(() => Promise.resolve([{ id: "grant-x" }]));
    const values = vi.fn(() => ({ returning }));
    const db = { insert: vi.fn(() => ({ values })) } as unknown as AuditDb;

    const row = await writeConsentGrant(db, {
      patientId: PATIENT_ID,
      consentType: "bioimpedance",
      version: VERSION,
    });

    expect(row).toEqual({ id: "grant-x" });
    expect(values).toHaveBeenCalledWith({
      patientId: PATIENT_ID,
      consentType: "bioimpedance",
      version: VERSION,
      metadata: {},
    });
  });

  it("propagates DB errors so the surrounding transaction can roll back", async () => {
    const rlsError = Object.assign(
      new Error("new row violates row-level security policy"),
      { code: "42501" },
    );
    const returning = vi.fn(() => Promise.reject(rlsError));
    const values = vi.fn(() => ({ returning }));
    const db = { insert: vi.fn(() => ({ values })) } as unknown as AuditDb;

    await expect(
      writeConsentGrant(db, {
        patientId: PATIENT_ID,
        consentType: "blood_test_results",
        version: VERSION,
      }),
    ).rejects.toMatchObject({ code: "42501" });
  });
});

describe("writeConsentRevocation", () => {
  it("returns the revoked row id and version when an active grant exists", async () => {
    const returning = vi.fn(() =>
      Promise.resolve([{ id: "grant-x", version: VERSION }]),
    );
    const where = vi.fn(() => ({ returning }));
    const set = vi.fn(() => ({ where }));
    const db = { update: vi.fn(() => ({ set })) } as unknown as AuditDb;

    const row = await writeConsentRevocation(db, {
      patientId: PATIENT_ID,
      consentType: "bioimpedance",
    });

    expect(row).toEqual({ id: "grant-x", version: VERSION });
    expect(set).toHaveBeenCalled();
  });

  it("returns null when no active grant matches (idempotent caller path)", async () => {
    const returning = vi.fn(() => Promise.resolve([]));
    const where = vi.fn(() => ({ returning }));
    const set = vi.fn(() => ({ where }));
    const db = { update: vi.fn(() => ({ set })) } as unknown as AuditDb;

    const row = await writeConsentRevocation(db, {
      patientId: PATIENT_ID,
      consentType: "ai_narrative",
    });

    expect(row).toBeNull();
  });

  it("propagates DB errors so the surrounding transaction can roll back", async () => {
    const rlsError = Object.assign(
      new Error("new row violates row-level security policy"),
      { code: "42501" },
    );
    const returning = vi.fn(() => Promise.reject(rlsError));
    const where = vi.fn(() => ({ returning }));
    const set = vi.fn(() => ({ where }));
    const db = { update: vi.fn(() => ({ set })) } as unknown as AuditDb;

    await expect(
      writeConsentRevocation(db, {
        patientId: PATIENT_ID,
        consentType: "blood_test_results",
      }),
    ).rejects.toMatchObject({ code: "42501" });
  });
});

describe("consentRequiredProcedure", () => {
  function makeGuardedCaller(opts: { hasGrant: boolean }) {
    const selectChain = {
      from: vi.fn(() => selectChain),
      where: vi.fn(() => selectChain),
      limit: vi.fn(() => Promise.resolve(opts.hasGrant ? [{ id: "g1" }] : [])),
      orderBy: vi.fn(() => Promise.resolve([])),
    };
    const tx = {
      execute: vi.fn(() => Promise.resolve(undefined)),
      select: vi.fn(() => selectChain),
      insert: vi.fn(),
    };
    const db = { transaction: (cb: (tx: unknown) => unknown) => cb(tx) };

    const guardedRouter = createTRPCRouter({
      probe: consentRequiredProcedure("blood_test_results").query(
        () => ({ ok: true }) as const,
      ),
    });

    const ctx = {
      session: { user: { id: PATIENT_ID } },
      db,
      headers: new Headers(),
      shareTokenId: undefined,
    } as unknown as Parameters<typeof guardedRouter.createCaller>[0];

    return guardedRouter.createCaller(ctx);
  }

  it("proceeds when an active grant exists", async () => {
    const caller = makeGuardedCaller({ hasGrant: true });
    await expect(caller.probe()).resolves.toEqual({ ok: true });
  });

  it("throws FORBIDDEN / CONSENT_REQUIRED when no grant exists", async () => {
    const caller = makeGuardedCaller({ hasGrant: false });
    await expect(caller.probe()).rejects.toMatchObject({
      code: "FORBIDDEN",
      message: "CONSENT_REQUIRED",
    });
    await expect(caller.probe()).rejects.toBeInstanceOf(TRPCError);
  });
});
