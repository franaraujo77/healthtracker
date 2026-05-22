import { pgTable, uniqueIndex } from "drizzle-orm/pg-core";

/**
 * Story 2.5 — `push_tokens` table.
 *
 * One row per (patient, device). A patient can have multiple devices
 * (iOS + Android tablet etc); a device can change tokens (re-install,
 * app update) — re-registering UPDATEs `expo_token` + `last_seen_at`
 * + clears `revoked_at`, keyed by `(patient_id, device_id)`.
 *
 * RLS: see `custom_rls_push_tokens.sql`. Patient SELECT/INSERT/UPDATE
 * own; worker reads via service-role.
 *
 * Soft-delete via `revoked_at` — never DELETE rows. Preserves audit
 * trail and prevents reinsertion races on sign-out.
 */
export const PushTokens = pgTable(
  "push_tokens",
  (t) => ({
    id: t.uuid().notNull().primaryKey().defaultRandom(),
    patientId: t.uuid().notNull(),
    /** Client-generated stable UUID per install (kept in expo-secure-store). */
    deviceId: t.uuid().notNull(),
    /** The `ExponentPushToken[...]` string from Expo. */
    expoToken: t.text().notNull(),
    /** `'ios'` or `'android'`. Stored as text — no pgEnum so the
     * platform list can evolve without a migration. */
    platform: t.text().notNull(),
    appVersion: t.text(),
    createdAt: t
      .timestamp({ mode: "date", withTimezone: true })
      .defaultNow()
      .notNull(),
    lastSeenAt: t
      .timestamp({ mode: "date", withTimezone: true })
      .defaultNow()
      .notNull(),
    /** Soft-delete; the worker filters `WHERE revoked_at IS NULL`. */
    revokedAt: t.timestamp({ mode: "date", withTimezone: true }),
  }),
  (table) => [
    uniqueIndex("push_tokens_patient_device_unique").on(
      table.patientId,
      table.deviceId,
    ),
  ],
);
