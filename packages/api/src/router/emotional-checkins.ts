import type { TRPCRouterRecord } from "@trpc/server";

import { recordEmotionalCheckInInputSchema } from "@healthtracker/validators";

import { recordPreResultsEmotionalCheckIn } from "../emotional-checkins";
import { protectedProcedure } from "../trpc";

/**
 * Story 7.2 — emotional check-in router (patient-only surface).
 *
 * `protectedProcedure` gates on the Supabase session; the RLS GUC
 * `app.current_patient_id` binds `patient_id` to `ctx.session.user.id`.
 * No doctor-side surface ships (doctor-zero-rows invariant per
 * `custom_rls_emotional_checkins.sql`).
 *
 * **Audit kind:** `emotional_checkin.recorded` is written with
 * `{uploadId, type, state}` metadata; deliberately NOT in
 * `ACCESS_LOG_EVENT_KINDS` (AC7).
 *
 * Story 7.3 will add a `recordPostResults` mutation against the same
 * router under a parallel `type='post'` schema.
 */
export const emotionalCheckInsRouter = {
  recordPreResults: protectedProcedure
    .input(recordEmotionalCheckInInputSchema)
    .mutation(async ({ ctx, input }) => {
      return recordPreResultsEmotionalCheckIn(
        ctx.db,
        ctx.session.user.id,
        input,
      );
    }),
} satisfies TRPCRouterRecord;
