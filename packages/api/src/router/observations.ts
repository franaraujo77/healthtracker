import type { TRPCRouterRecord } from "@trpc/server";

import { BiaSubmissionSchema } from "@healthtracker/validators";

import { writeBiaObservations } from "../observations";
import { getPersonalBaselineForPatient } from "../observations-baseline";
import { getRecordForPatient } from "../observations-record";
import { protectedProcedure } from "../trpc";

export const observationsRouter = {
  /**
   * Story 3.1 — read the patient's complete longitudinal biomarker
   * record. Returns draws grouped by `(collectedAt, labName)` in
   * reverse-chronological order. RLS is the security boundary; the
   * helper appends one `observation.read` audit inside the
   * `protectedProcedure` transaction (AC4). No input — `patientId`
   * is derived from `ctx.session.user.id` (the only safe source).
   */
  getRecord: protectedProcedure.query(async ({ ctx }) => {
    return getRecordForPatient(ctx.db, ctx.session.user.id);
  }),

  /**
   * Story 3.3 — read the patient's personal baseline (per-biomarker
   * mean / stddev / latest / z-score) across their full
   * observation history. Single SQL aggregate; soft-delete-filtered;
   * appends one `observation.baseline.read` audit row in the same
   * `protectedProcedure` transaction (AC6). No input — `patientId`
   * is derived from `ctx.session.user.id` (only safe source).
   */
  getPersonalBaseline: protectedProcedure.query(async ({ ctx }) => {
    return getPersonalBaselineForPatient(ctx.db, ctx.session.user.id);
  }),

  /**
   * Story 2.7 — manual BIA submission. Returns one of:
   *   - `{ status: 'created', observationIds: [3 ids], overwroteObservationIds?: [...] }`
   *   - `{ status: 'duplicate', existingObservationIds: [...] }` (the
   *     client renders a confirmation modal and re-submits with
   *     `overwrite: true`).
   *
   * The entire fan-out (optional soft-delete + 3 inserts + 1 audit)
   * runs inside the `protectedProcedure` transaction.
   */
  submitBia: protectedProcedure
    .input(BiaSubmissionSchema)
    .mutation(async ({ ctx, input }) => {
      const patientId = ctx.session.user.id;
      return writeBiaObservations(ctx.db, { patientId, input });
    }),
} satisfies TRPCRouterRecord;
