import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import { z, ZodError } from "zod/v4";

import type { Session } from "@healthtracker/auth";
import { sql } from "@healthtracker/db";
import { db } from "@healthtracker/db/client";

/**
 * @see https://trpc.io/docs/server/context
 */
export const createTRPCContext = (opts: {
  headers: Headers;
  session?: Session | null;
}) => {
  return {
    session: opts.session ?? null,
    db,
    headers: opts.headers,
    shareTokenId: undefined as string | undefined,
  };
};

const t = initTRPC.context<typeof createTRPCContext>().create({
  transformer: superjson,
  errorFormatter: ({ shape, error }) => ({
    ...shape,
    data: {
      ...shape.data,
      zodError:
        error.cause instanceof ZodError
          ? z.flattenError(error.cause as ZodError<Record<string, unknown>>)
          : null,
    },
  }),
});

export const createTRPCRouter = t.router;

const timingMiddleware = t.middleware(async ({ next, path }) => {
  const start = Date.now();

  if (t._config.isDev) {
    const waitMs = Math.floor(Math.random() * 400) + 100;
    await new Promise((resolve) => setTimeout(resolve, waitMs));
  }

  const result = await next();

  const end = Date.now();
  console.log(`[TRPC] ${path} took ${end - start}ms to execute`);

  return result;
});

export const publicProcedure = t.procedure.use(timingMiddleware);

// RLS context is transaction-scoped — wrap the entire resolver in a
// transaction so the GUC persists for all queries the resolver executes.
//
// **Why `set_config(...)` and not `SET LOCAL = ${value}`**
//
// Drizzle's `sql\`\`` template tag parameterizes scalar interpolations
// into `$N` bind parameters (`drizzle-orm/sql/sql.js`, escapeParam path).
// PostgreSQL **rejects parameter placeholders in `SET` commands** — the
// value must be a literal — so `sql\`SET LOCAL app.x = ${val}\`` issues
// `SET LOCAL app.x = $1` which Postgres errors with
// `syntax error at or near "$1"`.
//
// `set_config(name text, value text, is_local boolean) returns text` is
// the function form, accepts parameters, and `is_local = true` makes it
// equivalent to `SET LOCAL`. This was caught at Epic 1 PR open against
// real Supabase in CI; the mocked-execute unit tests never exercised
// the SQL surface. Same pattern applies to the RLS test helper at
// `packages/db/__tests__/rls/helpers.ts`.
export const protectedProcedure = t.procedure
  .use(timingMiddleware)
  .use(async ({ ctx, next }) => {
    if (!ctx.session?.user) {
      throw new TRPCError({ code: "UNAUTHORIZED" });
    }
    const session = ctx.session;
    return ctx.db.transaction(async (tx) => {
      await tx.execute(
        sql`SELECT set_config('app.current_patient_id', ${session.user.id}, true)`,
      );
      await tx.execute(
        sql`SELECT set_config('app.current_user_role', ${"patient"}, true)`,
      );
      if (process.env.NODE_ENV === "development") {
        console.log(
          `[RLS] set_config('app.current_patient_id', '${session.user.id}', true)`,
        );
      }
      return next({
        ctx: {
          session: { ...session, user: session.user },
          db: tx,
        },
      });
    });
  });

// Doctor procedure: authenticated via x-share-token header AND a
// verified Supabase auth session (Story 6.2 AC4 / T4).
//
// **Defense in depth, two gates:**
//   1. `x-share-token` header — binds the RLS principal via
//      `set_config('app.current_share_token_id', …)`.
//   2. `ctx.session.user` — proves the request rides on a verified
//      Supabase auth.users row (the doctor verified their magic-link).
//
// Without the session gate a malicious browser extension could mint
// an `x-share-token` header on an UNAUTHENTICATED tab and read the
// Conversation Starter payload — the GUC alone would still pass the
// doctor-side RLS predicate. The session gate ensures every consumer
// of `doctorProcedure` carries a doctor-attributable `auth.uid()` for
// the `share_token.read` audit row's `actorId` (NOT the shareTokenId
// sentinel that Story 6.1's pre-auth path used).
//
// Story 5.1 deliberately landed without the session gate (the only
// consumer was a future story); Story 6.2 is the first production
// consumer (`sharingRouter.getConversationStarter`) and adds it.
//
// Reviewers: confirm the resolver ALSO does a
// `constantTimeEqualHmac` re-check against the persisted
// `share_tokens.token_hmac` — the GUC proves "client claims X", the
// HMAC compare proves "client holds the URL the patient signed for X".
export const doctorProcedure = t.procedure
  .use(timingMiddleware)
  .use(async ({ ctx, next }) => {
    const shareTokenId = ctx.headers.get("x-share-token");
    if (!shareTokenId) {
      throw new TRPCError({
        code: "UNAUTHORIZED",
        message: "SHARE_TOKEN_REQUIRED",
      });
    }
    // Story 6.2 T4.1 — session gate. Without this, a missing or
    // forged session pairs with a fabricated `x-share-token` header
    // to read the doctor surface anonymously.
    if (!ctx.session?.user) {
      throw new TRPCError({
        code: "UNAUTHORIZED",
        message: "DOCTOR_SESSION_REQUIRED",
      });
    }
    const session = ctx.session;
    return ctx.db.transaction(async (tx) => {
      // See protectedProcedure above for why `set_config` is used here
      // instead of `SET LOCAL = ${value}`.
      await tx.execute(
        sql`SELECT set_config('app.current_share_token_id', ${shareTokenId}, true)`,
      );
      await tx.execute(
        sql`SELECT set_config('app.current_user_role', ${"doctor"}, true)`,
      );
      return next({
        ctx: {
          session: { ...session, user: session.user },
          db: tx,
          headers: ctx.headers,
          shareTokenId,
        },
      });
    });
  });
