import { TRPCError } from "@trpc/server";

import { protectedProcedure } from "../trpc";

/**
 * Story 4.1 — Premium-tier procedure (architecture.md §9 lines
 * 812–827). Throws `PRECONDITION_FAILED / PREMIUM_REQUIRED` unless
 * the authenticated user's `app_metadata.subscriptionTier` is
 * `"premium"`.
 *
 * The free vs. premium boundary for The Letter is listed as P1
 * unresolved in the architecture doc — until a billing flow ships,
 * the Supabase JWT does not populate `subscriptionTier`. Default
 * **deny** is the safe choice: free-tier users see an upgrade CTA,
 * and dev / QA can flip `app_metadata.subscriptionTier = "premium"`
 * via the Supabase admin API to exercise the path end-to-end.
 *
 * Mirrors `consentRequiredProcedure` shape — layered over
 * `protectedProcedure`, so RLS context is already in place.
 */
export const premiumProcedure = protectedProcedure.use(({ ctx, next }) => {
  if (!isPremium(ctx.session.user)) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "PREMIUM_REQUIRED",
    });
  }
  return next();
});

/**
 * Centralised premium check — reused by `enqueueLetterGeneration`
 * (which needs a boolean, not a throw) and `premiumProcedure`. A
 * user is premium when their Supabase `app_metadata.subscriptionTier`
 * is exactly the string `"premium"`. Anything else (including
 * missing metadata) is free.
 */
export function isPremium(user: unknown): boolean {
  if (typeof user !== "object" || user === null) return false;
  const appMetadata = (user as { app_metadata?: unknown }).app_metadata;
  if (typeof appMetadata !== "object" || appMetadata === null) return false;
  const tier = (appMetadata as { subscriptionTier?: unknown }).subscriptionTier;
  return tier === "premium";
}
