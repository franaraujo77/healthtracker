import { TRPCError } from "@trpc/server";

import type { ConsentDataType } from "@healthtracker/validators";
import { and, eq, isNull } from "@healthtracker/db";
import { ConsentGrants } from "@healthtracker/db/schema";

import { protectedProcedure } from "../trpc";

/**
 * Factory that returns a procedure base which throws `FORBIDDEN /
 * CONSENT_REQUIRED` unless the authenticated patient has an active
 * (non-revoked) grant for the given consent type. Layered on top of
 * `protectedProcedure`, so the RLS transaction context is already in
 * place when the lookup runs (the SELECT is scoped to the current
 * patient by the `consent_grants_select_own` policy too).
 *
 * Story 1.2 only defines the primitive; no router consumes it yet.
 * Epic 2 uploads, Epic 4 Letter, and Epic 5 sharing are the planned
 * consumers.
 */
export function consentRequiredProcedure(consentType: ConsentDataType) {
  return protectedProcedure.use(async ({ ctx, next }) => {
    const existing = await ctx.db
      .select({ id: ConsentGrants.id })
      .from(ConsentGrants)
      .where(
        and(
          eq(ConsentGrants.patientId, ctx.session.user.id),
          eq(ConsentGrants.consentType, consentType),
          isNull(ConsentGrants.revokedAt),
        ),
      )
      .limit(1);
    if (existing.length === 0) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "CONSENT_REQUIRED",
      });
    }
    return next();
  });
}
