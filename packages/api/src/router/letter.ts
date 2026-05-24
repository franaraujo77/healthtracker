import type { TRPCRouterRecord } from "@trpc/server";
import { z } from "zod/v4";

import { getLetterStatusForPatient } from "../letters";
import { premiumProcedure } from "../middleware/entitlements";

/**
 * Story 4.1 — Letter router. Generation is event-driven (triggered
 * from the upload-confirm transaction via `enqueueLetterGeneration`),
 * NOT patient-initiated, so there is no `generate` mutation. The
 * router exposes only `getStatus` so the LetterReader can confirm
 * the persisted body once the SSE stream completes (and as the
 * primary read path for Story 4.2's re-read flow).
 *
 * The SSE endpoint (`GET /api/stream/letter/:letterId` in
 * `services/llm`) writes the `letter.read` audit row; doing it here
 * would double-count the event.
 */
export const letterRouter = {
  getStatus: premiumProcedure
    .input(z.object({ letterId: z.uuid() }))
    .query(async ({ ctx, input }) => {
      const result = await getLetterStatusForPatient(ctx.db, {
        patientId: ctx.session.user.id,
        letterId: input.letterId,
      });
      // 404 surface — we deliberately do NOT distinguish "wrong
      // patient" from "missing letter" (no enumeration oracle).
      return result;
    }),
} satisfies TRPCRouterRecord;
