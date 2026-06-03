import type { TRPCRouterRecord } from "@trpc/server";

import { sql } from "@healthtracker/db";
import {
  confirmReviewFieldAsOperatorInputSchema,
  getOperatorQueueItemInputSchema,
  rejectReviewFieldAsOperatorInputSchema,
} from "@healthtracker/validators";

import {
  confirmReviewFieldAsOperator,
  rejectReviewFieldAsOperator,
} from "../operator-resolve";
import {
  getOperatorQueueItem,
  listOperatorReviewQueue,
} from "../operator-review";
import { operatorProcedure } from "../trpc";

/**
 * Story 8.1 / 8.2 — operator review-queue router (the operator surface).
 *
 * All procedures are `operatorProcedure`: the session + allowlist gate
 * and the `app.current_user_role = 'operator'` GUC binding live in the
 * middleware (`packages/api/src/trpc.ts`). RLS restricts READS to
 * anonymised `loinc_unresolved` rows; the operator has zero policy on
 * `users`/`uploads`, so the queue is anonymised at the RLS layer
 * (NFR-S7 / AR5).
 *
 * **Story 8.2 WRITES escalate.** Confirm/reject must INSERT observations,
 * UPDATE uploads, and count BOTH review reasons — none of which the
 * operator RLS principal can do. So each mutation escalates to
 * `SET LOCAL ROLE postgres` inside `operatorProcedure`'s transaction,
 * paired with `SET LOCAL ROLE NONE` in a `finally` (the
 * `activateProfessionalAccount` precedent; CLAUDE.md "privilege
 * escalation must reset in same tx scope"). The `OPERATOR_USER_IDS`
 * allowlist gate is the trust boundary — NO operator write RLS policy
 * is added to any table.
 */
export const operatorRouter = {
  listReviewQueue: operatorProcedure.query(async ({ ctx }) => {
    return listOperatorReviewQueue(ctx.db);
  }),

  getQueueItem: operatorProcedure
    .input(getOperatorQueueItemInputSchema)
    .query(async ({ ctx, input }) => {
      return getOperatorQueueItem(ctx.db, input.uploadId);
    }),

  confirmField: operatorProcedure
    .input(confirmReviewFieldAsOperatorInputSchema)
    .mutation(async ({ ctx, input }) => {
      // ctx.db is already the operatorProcedure transaction handle.
      await ctx.db.execute(sql`SET LOCAL ROLE postgres`);
      try {
        return await confirmReviewFieldAsOperator(
          ctx.db,
          ctx.session.user.id,
          input,
        );
      } finally {
        await ctx.db.execute(sql`SET LOCAL ROLE NONE`);
      }
    }),

  rejectField: operatorProcedure
    .input(rejectReviewFieldAsOperatorInputSchema)
    .mutation(async ({ ctx, input }) => {
      await ctx.db.execute(sql`SET LOCAL ROLE postgres`);
      try {
        return await rejectReviewFieldAsOperator(
          ctx.db,
          ctx.session.user.id,
          input,
        );
      } finally {
        await ctx.db.execute(sql`SET LOCAL ROLE NONE`);
      }
    }),
} satisfies TRPCRouterRecord;
