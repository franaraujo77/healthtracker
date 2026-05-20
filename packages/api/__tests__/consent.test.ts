import { TRPCError } from "@trpc/server";
import { describe, expect, it, vi } from "vitest";

import { AuditLog, ConsentGrants } from "@healthtracker/db/schema";

import type { AuditDb } from "../src/audit";
import { writeConsentGrant } from "../src/consent";
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

  const tx = {
    execute: vi.fn(() => Promise.resolve(undefined)),
    select: vi.fn(() => selectChain),
    insert,
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
});

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
