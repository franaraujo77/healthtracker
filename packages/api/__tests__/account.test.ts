import { TRPCError } from "@trpc/server";
import { describe, expect, it, vi } from "vitest";

import { AuditLog, Users } from "@healthtracker/db/schema";

import { appRouter } from "../src/root";

type Caller = ReturnType<typeof appRouter.createCaller>;
type CallerCtx = Parameters<typeof appRouter.createCaller>[0];

const USER_ID = "11111111-1111-1111-1111-111111111111";

/**
 * Builds a caller whose `db` is a mock transaction. `profileAlreadyExists`
 * controls whether the `users` insert reports a new row (returning `[{id}]`)
 * or a conflict (returning `[]`).
 */
function makeCaller(opts: { profileAlreadyExists: boolean }) {
  const usersChain = {
    values: vi.fn(() => usersChain),
    onConflictDoNothing: vi.fn(() => usersChain),
    returning: vi.fn(() =>
      Promise.resolve(opts.profileAlreadyExists ? [] : [{ id: USER_ID }]),
    ),
  };
  const auditValues = vi.fn(() => Promise.resolve(undefined));
  const insert = vi.fn((table: unknown) =>
    table === Users ? usersChain : { values: auditValues },
  );
  const tx = { execute: vi.fn(() => Promise.resolve(undefined)), insert };
  const db = { transaction: (cb: (tx: unknown) => unknown) => cb(tx) };

  const ctx = {
    session: { user: { id: USER_ID } },
    db,
    headers: new Headers(),
    shareTokenId: undefined,
  } as unknown as CallerCtx;

  return { caller: appRouter.createCaller(ctx), tx, insert, auditValues };
}

describe("account.initializeProfile", () => {
  it("creates the users row and writes a patient.created audit event", async () => {
    const { caller, insert, auditValues } = makeCaller({
      profileAlreadyExists: false,
    });

    const result = await caller.account.initializeProfile();

    expect(result).toEqual({ userId: USER_ID, created: true });
    expect(insert).toHaveBeenCalledWith(Users);
    expect(insert).toHaveBeenCalledWith(AuditLog);
    expect(auditValues).toHaveBeenCalledWith({
      actorId: USER_ID,
      actorType: "patient",
      event: "patient.created",
      resourceId: USER_ID,
      resourceType: "user",
      metadata: { actor: "self" },
    });
  });

  it("is idempotent: writes no audit event when the row already exists", async () => {
    const { caller, insert, auditValues } = makeCaller({
      profileAlreadyExists: true,
    });

    const result = await caller.account.initializeProfile();

    expect(result).toEqual({ userId: USER_ID, created: false });
    expect(insert).toHaveBeenCalledWith(Users);
    expect(insert).not.toHaveBeenCalledWith(AuditLog);
    expect(auditValues).not.toHaveBeenCalled();
  });

  it("rejects with UNAUTHORIZED when there is no session", async () => {
    const ctx = {
      session: null,
      db: { transaction: vi.fn() },
      headers: new Headers(),
      shareTokenId: undefined,
    } as unknown as CallerCtx;
    const caller: Caller = appRouter.createCaller(ctx);

    await expect(caller.account.initializeProfile()).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
    await expect(caller.account.initializeProfile()).rejects.toBeInstanceOf(
      TRPCError,
    );
  });
});
