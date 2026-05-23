import type { TRPCRouterRecord } from "@trpc/server";

import { BiaSubmissionSchema } from "@healthtracker/validators";

import { writeBiaObservations } from "../observations";
import { protectedProcedure } from "../trpc";

export const observationsRouter = {
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
