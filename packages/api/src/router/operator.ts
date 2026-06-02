import type { TRPCRouterRecord } from "@trpc/server";

import { getOperatorQueueItemInputSchema } from "@healthtracker/validators";

import {
  getOperatorQueueItem,
  listOperatorReviewQueue,
} from "../operator-review";
import { operatorProcedure } from "../trpc";

/**
 * Story 8.1 — operator review-queue router (the first operator surface).
 *
 * Both procedures are `operatorProcedure`: the session + allowlist gate
 * and the `app.current_user_role = 'operator'` GUC binding live in the
 * middleware (`packages/api/src/trpc.ts`), not duplicated here. RLS
 * restricts reads to anonymised `loinc_unresolved` rows; the operator
 * has zero policy on `users`/`uploads`, so the queue is anonymised at
 * the RLS layer (NFR-S7 / AR5).
 *
 * **Read-only.** Both are `.query()` — no audit, no mutation (FR38).
 * Confirm/reject + audit (FR39–FR41) land in Story 8.2.
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
} satisfies TRPCRouterRecord;
