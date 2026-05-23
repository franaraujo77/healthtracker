import type { TRPCRouterRecord } from "@trpc/server";
import { z } from "zod/v4";

import { NotificationPreferencesSchema } from "@healthtracker/validators";

import {
  getNotificationPreferences,
  revokePushTokenByDevice,
  writeNotificationPreferences,
  writePushToken,
} from "../notifications";
import { protectedProcedure } from "../trpc";

// R2-P174 — tighten the format check. The original `startsWith`/
// `endsWith` accepted `ExponentPushToken[]`, padded variants, and
// arbitrarily long strings. Expo's tokens are URL-safe base64-ish
// payloads of 18-40 chars between the brackets.
const ExpoPushTokenSchema = z
  .string()
  .max(64)
  .regex(
    /^ExponentPushToken\[[A-Za-z0-9_-]{18,40}\]$/,
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

  /**
   * Story 2.8 — read the patient's notification preferences. Returns
   * synthetic all-true defaults when no row exists.
   */
  getPreferences: protectedProcedure.query(async ({ ctx }) => {
    const patientId = ctx.session.user.id;
    return getNotificationPreferences(ctx.db, patientId);
  }),

  /**
   * Story 2.8 — UPSERT the patient's notification preferences.
   * Returns the post-write row so the client can sync optimistic
   * state with the server's view (defense against a stale toggle
   * being re-sent during a debounce window).
   */
  updatePreferences: protectedProcedure
    .input(NotificationPreferencesSchema)
    .mutation(async ({ ctx, input }) => {
      const patientId = ctx.session.user.id;
      return writeNotificationPreferences(ctx.db, patientId, input);
    }),
} satisfies TRPCRouterRecord;
