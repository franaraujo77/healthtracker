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

// Doctor procedure: authenticated via x-share-token header (no Supabase session).
// Sets app.current_share_token_id instead of app.current_patient_id.
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
          session: ctx.session,
          db: tx,
          headers: ctx.headers,
          shareTokenId,
        },
      });
    });
  });
