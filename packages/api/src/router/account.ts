import type { TRPCRouterRecord } from "@trpc/server";

import { Users } from "@healthtracker/db/schema";

import { writeAuditLog } from "../audit";
import { protectedProcedure } from "../trpc";

export const accountRouter = {
  /**
   * Creates the patient's application-domain `users` row after Supabase Auth
   * sign-up. The client performs `supabase.auth.signUp()` first; this runs in
   * the resulting authenticated session, so `ctx.session.user.id` is the new
   * `auth.uid()` and the RLS `SET LOCAL app.current_patient_id` is in place.
   *
   * Idempotent: a repeated call (e.g. after a client retry) inserts nothing
   * and writes no audit event.
   */
  initializeProfile: protectedProcedure.mutation(async ({ ctx }) => {
    const userId = ctx.session.user.id;

    const inserted = await ctx.db
      .insert(Users)
      .values({ id: userId })
      .onConflictDoNothing()
      .returning({ id: Users.id });

    const created = inserted.length > 0;

    if (created) {
      await writeAuditLog(ctx.db, {
        actorId: userId,
        actorType: "patient",
        event: "patient.created",
        resourceId: userId,
        resourceType: "user",
        metadata: { actor: "self" },
      });
    }

    return { userId, created };
  }),
} satisfies TRPCRouterRecord;
