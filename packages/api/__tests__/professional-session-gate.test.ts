/**
 * Story 6.5 R1-followup MEDIUM-1 — `professionalSessionProcedure`
 * gate unit test.
 *
 * Mirrors the shape of `sharing/doctor-procedure-session-gate.test.ts`.
 * Asserts that:
 *   - session null → UNAUTHORIZED ("DOCTOR_SESSION_REQUIRED")
 *   - session set, no `professionals` row → PRECONDITION_FAILED
 *     ("DOCTOR_NOT_ACTIVATED") [inlined activation gate, R1-followup]
 *   - session set + activated row → passes through
 *
 * We avoid real DB roundtrips by overriding `ctx.db.transaction` with
 * a fake that exposes a configurable `execute` returning either an
 * empty result (not activated) or a one-row result (activated). The
 * test stops at the resolver boundary; nothing depends on real RLS.
 */
// Build a minimal caller via a router so the middleware actually runs.
import { initTRPC, TRPCError } from "@trpc/server";
import { describe, expect, it } from "vitest";

import { createTRPCContext, professionalSessionProcedure } from "../src/trpc";

interface FakeTx {
  execute: (sql: unknown) => Promise<unknown>;
}

function buildCtx(opts: {
  session: { user: { id: string } } | null;
  activated: boolean;
}) {
  const headers = new Headers();
  const base = createTRPCContext({
    headers,
    session: opts.session as unknown as Parameters<
      typeof createTRPCContext
    >[0]["session"],
  });
  // Sequence of execute() calls the middleware makes:
  //   1. set_config('app.current_doctor_user_id', ...) → ignored result
  //   2. set_config('app.current_user_role', 'doctor') → ignored result
  //   3. SELECT user_id FROM professionals WHERE ... LIMIT 1
  //      → activated ? [{ user_id }] : []
  // We track invocation count to deliver the right shape for call #3.
  let calls = 0;
  const tx: FakeTx = {
    // eslint-disable-next-line @typescript-eslint/require-await -- async to match drizzle execute() signature
    execute: async () => {
      calls += 1;
      if (calls < 3) return [];
      return opts.activated ? [{ user_id: opts.session?.user.id ?? "u" }] : [];
    },
  };
  return {
    ...base,
    db: {
      transaction: async <T>(handler: (tx: FakeTx) => Promise<T>) =>
        handler(tx),
    },
  } as unknown as ReturnType<typeof createTRPCContext>;
}

const router = initTRPC
  .context<ReturnType<typeof createTRPCContext>>()
  .create()
  .router({
    ping: professionalSessionProcedure.query(() => ({ ok: true as const })),
  });

describe("professionalSessionProcedure — R1-followup MEDIUM-1", () => {
  it("throws UNAUTHORIZED when session is null", async () => {
    const ctx = buildCtx({ session: null, activated: false });
    const caller = router.createCaller(ctx);
    await expect(caller.ping()).rejects.toThrow(/DOCTOR_SESSION_REQUIRED/);
  });

  it("throws PRECONDITION_FAILED when session is set but no professionals row", async () => {
    const ctx = buildCtx({
      session: { user: { id: "00000000-0000-0000-0000-000000000001" } },
      activated: false,
    });
    const caller = router.createCaller(ctx);
    await expect(caller.ping()).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
    });
    await expect(caller.ping()).rejects.toThrow(/DOCTOR_NOT_ACTIVATED/);
  });

  it("passes through when session is set AND professionals row exists", async () => {
    const ctx = buildCtx({
      session: { user: { id: "00000000-0000-0000-0000-000000000002" } },
      activated: true,
    });
    const caller = router.createCaller(ctx);
    await expect(caller.ping()).resolves.toEqual({ ok: true });
  });

  // Sanity: TRPCError shape stays stable for downstream `instanceof` use.
  it("not-activated error is a real TRPCError instance", async () => {
    const ctx = buildCtx({
      session: { user: { id: "00000000-0000-0000-0000-000000000003" } },
      activated: false,
    });
    const caller = router.createCaller(ctx);
    try {
      await caller.ping();
      throw new Error("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(TRPCError);
    }
  });
});
