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

// SET LOCAL is transaction-scoped — must wrap the entire resolver in a transaction
// so the RLS context variable persists for all queries the resolver executes.
export const protectedProcedure = t.procedure
  .use(timingMiddleware)
  .use(async ({ ctx, next }) => {
    if (!ctx.session?.user) {
      throw new TRPCError({ code: "UNAUTHORIZED" });
    }
    const session = ctx.session;
    return ctx.db.transaction(async (tx) => {
      await tx.execute(
        sql`SET LOCAL app.current_patient_id = ${session.user.id}`,
      );
      await tx.execute(sql`SET LOCAL app.current_user_role = ${"patient"}`);
      if (process.env.NODE_ENV === "development") {
        console.log(
          `[RLS] SET LOCAL app.current_patient_id = ${session.user.id}`,
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
      await tx.execute(
        sql`SET LOCAL app.current_share_token_id = ${shareTokenId}`,
      );
      await tx.execute(sql`SET LOCAL app.current_user_role = ${"doctor"}`);
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
