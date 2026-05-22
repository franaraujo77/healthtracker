import type { TRPCRouterRecord } from "@trpc/server";
import { z } from "zod/v4";

import { revokePushTokenByDevice, writePushToken } from "../notifications";
import { protectedProcedure } from "../trpc";

const ExpoPushTokenSchema = z
  .string()
  .min(1)
  .refine(
    (s) => s.startsWith("ExponentPushToken[") && s.endsWith("]"),
    "EXPO_TOKEN_FORMAT_INVALID",
  );

const RegisterPushTokenInputSchema = z.object({
  deviceId: z.string().uuid(),
  expoToken: ExpoPushTokenSchema,
  platform: z.enum(["ios", "android"]),
  appVersion: z.string().max(40).optional(),
});

const RevokePushTokenInputSchema = z.object({
  deviceId: z.string().uuid(),
});

export const notificationsRouter = {
  /**
   * Story 2.5 — idempotently register the calling patient's push
   * token for the given device. The `(patient_id, device_id)` UNIQUE
   * index means re-calls update the token + clear `revoked_at`.
   */
  registerPushToken: protectedProcedure
    .input(RegisterPushTokenInputSchema)
    .mutation(async ({ ctx, input }) => {
      const patientId = ctx.session.user.id;
      const row = await writePushToken(ctx.db, {
        patientId,
        deviceId: input.deviceId,
        expoToken: input.expoToken,
        platform: input.platform,
        appVersion: input.appVersion,
      });
      return { id: row.id, ok: true as const };
    }),

  /**
   * Story 2.5 — soft-delete a push token. Idempotent: returns `ok`
   * even if no matching row exists.
   */
  revokePushToken: protectedProcedure
    .input(RevokePushTokenInputSchema)
    .mutation(async ({ ctx, input }) => {
      const patientId = ctx.session.user.id;
      await revokePushTokenByDevice(ctx.db, patientId, input.deviceId);
      return { ok: true as const };
    }),
} satisfies TRPCRouterRecord;
