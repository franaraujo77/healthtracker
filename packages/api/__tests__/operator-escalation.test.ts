import { describe, expect, it } from "vitest";

import { appRouter } from "../src/root";
import { createTRPCContext } from "../src/trpc";

/**
 * Story 8.2 AC5 — the load-bearing security test: the operator
 * confirm/reject resolver MUST de-escalate (`SET LOCAL ROLE NONE`) even
 * when the inner work throws. A dropped `finally` would leave RLS
 * bypassed for any later statement in the request.
 *
 * We run the REAL router + REAL resolver with a fake tx whose `select`
 * returns no row (so the helper throws NOT_FOUND mid-flight) and whose
 * `execute` records the SQL text. We then assert the order:
 * `SET LOCAL ROLE postgres` … (throw) … `SET LOCAL ROLE NONE`.
 */

const OPERATOR_ID = "44444444-4444-4444-4444-444444444444";
const REVIEW_ID = "55555555-5555-4555-8555-555555555555";

function sqlText(arg: unknown): string {
  const chunks =
    (arg as { queryChunks?: { value?: unknown[] }[] }).queryChunks ?? [];
  return chunks
    .map((c) => (Array.isArray(c.value) ? c.value.join("") : ""))
    .join("")
    .trim();
}

function buildCtx(executed: string[]) {
  const base = createTRPCContext({
    headers: new Headers(),
    session: { user: { id: OPERATOR_ID } } as unknown as Parameters<
      typeof createTRPCContext
    >[0]["session"],
  });
  const tx = {
    execute: (arg: unknown) => {
      executed.push(sqlText(arg));
      return Promise.resolve([]);
    },
    // The helper's first DB touch — return no row → NOT_FOUND throw.
    select: () => {
      const builder: Record<string, unknown> = {};
      builder.from = () => builder;
      builder.where = () => builder;
      builder.limit = () => Promise.resolve([]);
      return builder;
    },
  };
  return {
    ...base,
    db: {
      transaction: async <T>(handler: (tx: unknown) => Promise<T>) =>
        handler(tx),
    },
  } as unknown as ReturnType<typeof createTRPCContext>;
}

describe("operator confirm/reject — privilege-escalation reset (AC5)", () => {
  it("de-escalates (SET LOCAL ROLE NONE) in finally even when the work throws", async () => {
    process.env.OPERATOR_USER_IDS = OPERATOR_ID;
    const executed: string[] = [];
    const caller = appRouter.createCaller(buildCtx(executed));

    await expect(
      caller.operator.confirmField({ reviewQueueId: REVIEW_ID }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    const postgresIdx = executed.findIndex((s) =>
      /SET LOCAL ROLE postgres/i.test(s),
    );
    const noneIdx = executed.findIndex((s) => /SET LOCAL ROLE NONE/i.test(s));
    expect(postgresIdx).toBeGreaterThanOrEqual(0);
    expect(noneIdx).toBeGreaterThan(postgresIdx); // reset ran AFTER the throw
  });

  it("rejects a non-operator session with FORBIDDEN before any escalation", async () => {
    process.env.OPERATOR_USER_IDS = "11111111-1111-4111-8111-111111111111";
    const executed: string[] = [];
    const caller = appRouter.createCaller(buildCtx(executed));
    await expect(
      caller.operator.confirmField({ reviewQueueId: REVIEW_ID }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(executed.some((s) => /SET LOCAL ROLE/i.test(s))).toBe(false);
  });
});
