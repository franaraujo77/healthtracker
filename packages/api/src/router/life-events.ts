import type { TRPCRouterRecord } from "@trpc/server";

import {
  createLifeEventInputSchema,
  listLifeEventsInWindowInputSchema,
} from "@healthtracker/validators";

import { createLifeEvent, listLifeEventsInWindow } from "../life-events";
import { protectedProcedure } from "../trpc";

/**
 * Story 7.1 — life-event router (patient-only surface).
 *
 * Both procedures are `protectedProcedure` — the session gate is in
 * middleware (`packages/api/src/trpc.ts`), not duplicated here. The
 * RLS `app.current_patient_id` GUC binds `patient_id` to
 * `ctx.session.user.id` so writes/reads scope to the auth user. No
 * doctor-side surface ships in 7.1 (doctor-zero-rows invariant per
 * `custom_rls_life_events.sql`).
 *
 * **Audit kind:** `createLifeEvent` writes `life_event.created` with
 * `{eventDate, category}` metadata only — never `description` (PII).
 * The kind is intentionally NOT added to `ACCESS_LOG_EVENT_KINDS`;
 * life-event creation is not a doctor-access-relevant action.
 */
export const lifeEventsRouter = {
  createLifeEvent: protectedProcedure
    .input(createLifeEventInputSchema)
    .mutation(async ({ ctx, input }) => {
      return createLifeEvent(ctx.db, ctx.session.user.id, input);
    }),

  listInWindow: protectedProcedure
    .input(listLifeEventsInWindowInputSchema)
    .query(async ({ ctx, input }) => {
      return listLifeEventsInWindow(ctx.db, ctx.session.user.id, input);
    }),
} satisfies TRPCRouterRecord;
