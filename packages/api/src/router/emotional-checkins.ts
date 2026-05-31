import type { TRPCRouterRecord } from "@trpc/server";

import {
  recordEmotionalCheckInInputSchema,
  recordPostEmotionalCheckInInputSchema,
} from "@healthtracker/validators";

import {
  listEmotionalCheckInPairs,
  recordPostResultsEmotionalCheckIn,
  recordPreResultsEmotionalCheckIn,
} from "../emotional-checkins";
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

  /**
   * Story 7.3 — post-results check-in. Gated server-side on a
   * pre-existing `type='pre'` row for the same `(uploadId, patientId)`
   * (AC5 defense-in-depth — UI gate is necessary but not sufficient).
   */
  recordPostResults: protectedProcedure
    .input(recordPostEmotionalCheckInInputSchema)
    .mutation(async ({ ctx, input }) => {
      return recordPostResultsEmotionalCheckIn(
        ctx.db,
        ctx.session.user.id,
        input,
      );
    }),

  /**
   * Story 7.3 — personal-history pair listing. Returns one row per
   * upload that has BOTH pre AND post check-in rows for the calling
   * patient. The Acessos tab is the doctor-access surface; this is
   * the patient-private longitudinal signal (AC3).
   */
  listPairs: protectedProcedure.query(async ({ ctx }) => {
    return listEmotionalCheckInPairs(ctx.db, ctx.session.user.id);
  }),
} satisfies TRPCRouterRecord;
