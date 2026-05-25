import type { TRPCRouterRecord } from "@trpc/server";
import { z } from "zod/v4";

import { getLetterForDraw, getLetterStatusForPatient } from "../letters";
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

  /**
   * Story 4.2 — map a `(collectedAt, labName)` draw to its Letter, if
   * any. Drives the Histórico draw-detail "Ler carta" surface. Returns
   * `null` for draws with no associated Letter (most pre-Epic-4 draws,
   * all free-tier draws). The `labName === ""` empty-string sentinel
   * matches Story 3.1's `historicoDrawDetailRoute` URL packing — null
   * lab names are encoded as the empty string.
   *
   * NO `letter.read` audit is written here — that audit fires from the
   * SSE endpoint on actual LetterReader open (Story 4.1 docblock,
   * preserved to avoid double-counting).
   */
  getForDraw: premiumProcedure
    .input(
      z.object({
        collectedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        labName: z.string(),
      }),
    )
    .query(async ({ ctx, input }) => {
      return getLetterForDraw(ctx.db, {
        patientId: ctx.session.user.id,
        collectedAt: input.collectedAt,
        labName: input.labName,
      });
    }),
} satisfies TRPCRouterRecord;
