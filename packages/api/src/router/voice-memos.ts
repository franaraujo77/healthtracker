import type { TRPCRouterRecord } from "@trpc/server";

import { attachVoiceMemoInputSchema } from "@healthtracker/validators";

import { protectedProcedure } from "../trpc";
import { attachVoiceMemoToUpload } from "../voice-memos";

/**
 * Story 7.4 — voice memo router (patient-only surface).
 *
 * `protectedProcedure` gates on the Supabase session; the RLS GUC
 * `app.current_patient_id` binds `patient_id` to `ctx.session.user.id`.
 * No doctor-side surface; denial-by-RLS-absence per
 * `custom_rls_voice_memos.sql`.
 *
 * **Audit kind:** `voice_memo.recorded` deliberately NOT in
 * `ACCESS_LOG_EVENT_KINDS` (AC6) — same Epic 7 personal-context
 * pattern as life events / emotional check-ins.
 */
export const voiceMemosRouter = {
  attachToUpload: protectedProcedure
    .input(attachVoiceMemoInputSchema)
    .mutation(async ({ ctx, input }) => {
      return attachVoiceMemoToUpload(ctx.db, ctx.session.user.id, input);
    }),
} satisfies TRPCRouterRecord;
