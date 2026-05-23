import type { NotificationPreferencesInput } from "@healthtracker/validators";
import { eq, sql } from "@healthtracker/db";
import { NotificationPreferences, PushTokens } from "@healthtracker/db/schema";

import type { AuditDb } from "./audit";

/**
 * Story 2.5 — push-notification dispatch enqueue + push-token write
 * paths. The audit-event sites (`uploads-review.ts` for `complete`,
 * `services/extraction/src/consumers/document.ts` for
 * `pending_review`, the worker dead-letter handler for `failed`) all
 * call `enqueueNotificationSend` in the same transaction as their
 * `writeAuditLog`. The consumer in `services/extraction/` reads the
 * job, looks up active push tokens for the patient, and POSTs to the
 * Expo Push API.
 */

export type NotificationKind = "complete" | "pending_review" | "failed";

const NOTIFICATION_SEND_RETRY_LIMIT = 5;
const NOTIFICATION_SEND_RETRY_DELAY = 30;
const NOTIFICATION_SEND_RETRY_BACKOFF = true;

export interface NotificationSendPayload {
  uploadId: string;
  patientId: string;
  kind: NotificationKind;
}

/**
 * Enqueue a `notification.send` pg-boss job. Mirrors
 * `enqueueExtractDocument` (Story 1.5 / 2.3 R2-P48 pattern). The
 * `singleton_key` on `(upload_id, kind)` prevents two `complete`
 * notifications for the same upload (e.g., on idempotent retry of
 * the patient-confirm path).
 *
 * Caller is expected to be inside a transaction so the enqueue is
 * atomic with the matching `writeAuditLog`.
 */
export async function enqueueNotificationSend(
  database: AuditDb,
  args: NotificationSendPayload,
): Promise<void> {
  const wrapped = {
    jobId: crypto.randomUUID(),
    patientId: args.patientId,
    correlationId: args.uploadId,
    payload: { uploadId: args.uploadId, kind: args.kind } satisfies {
      uploadId: string;
      kind: NotificationKind;
    },
    createdAt: new Date().toISOString(),
  };
  const singletonKey = `${args.uploadId}.${args.kind}`;
  await database.execute(sql`
    INSERT INTO pgboss.job
      (name, data, retry_limit, retry_delay, retry_backoff, singleton_key)
    VALUES (
      'notification.send',
      ${JSON.stringify(wrapped)}::jsonb,
      ${NOTIFICATION_SEND_RETRY_LIMIT},
      ${NOTIFICATION_SEND_RETRY_DELAY},
      ${NOTIFICATION_SEND_RETRY_BACKOFF},
      ${singletonKey}
    )
    ON CONFLICT DO NOTHING
  `);
}

export interface PushTokenInsert {
  patientId: string;
  deviceId: string;
  expoToken: string;
  platform: "ios" | "android";
  appVersion?: string;
}

/**
 * Sanctioned write path for `push_tokens`. Idempotent on
 * `(patient_id, device_id)`: re-registering updates `expo_token`,
 * `last_seen_at`, and clears `revoked_at`. Returns the row id.
 */
export async function writePushToken(
  database: AuditDb,
  entry: PushTokenInsert,
): Promise<{ id: string }> {
  const [row] = await database
    .insert(PushTokens)
    .values({
      patientId: entry.patientId,
      deviceId: entry.deviceId,
      expoToken: entry.expoToken,
      platform: entry.platform,
      appVersion: entry.appVersion ?? null,
      lastSeenAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [PushTokens.patientId, PushTokens.deviceId],
      set: {
        expoToken: entry.expoToken,
        platform: entry.platform,
        appVersion: entry.appVersion ?? null,
        lastSeenAt: new Date(),
        revokedAt: null,
      },
    })
    .returning({ id: PushTokens.id });
  if (!row) {
    throw new Error("writePushToken: insert returned no row");
  }
  return row;
}

/**
 * Sanctioned soft-delete for `push_tokens`. Idempotent — returns
 * silently when no matching row exists.
 */
export async function revokePushTokenByDevice(
  database: AuditDb,
  patientId: string,
  deviceId: string,
): Promise<void> {
  await database.execute(sql`
    UPDATE push_tokens
    SET revoked_at = now()
    WHERE patient_id = ${patientId}::uuid
      AND device_id = ${deviceId}::uuid
      AND revoked_at IS NULL
  `);
}

/**
 * Story 2.8 — synthetic default preferences for first-time patients
 * with no row in `notification_preferences`. Mirrors the column
 * defaults (all `true`); having the default in code AND the schema is
 * defense-in-depth — the worker's `getNotificationPreferences` path
 * never has to know about the schema column defaults.
 */
export const DEFAULT_NOTIFICATION_PREFERENCES: NotificationPreferencesInput = {
  resultsReady: true,
  lettersReady: true,
  recordAccess: true,
  reviewRequired: true,
};

/**
 * Story 2.8 — read the patient's notification preferences. Returns
 * synthetic all-true defaults when no row exists (first-time patient).
 */
export async function getNotificationPreferences(
  database: AuditDb,
  patientId: string,
): Promise<NotificationPreferencesInput> {
  const [row] = await database
    .select({
      resultsReady: NotificationPreferences.resultsReady,
      lettersReady: NotificationPreferences.lettersReady,
      recordAccess: NotificationPreferences.recordAccess,
      reviewRequired: NotificationPreferences.reviewRequired,
    })
    .from(NotificationPreferences)
    .where(eq(NotificationPreferences.patientId, patientId))
    .limit(1);
  return row ?? DEFAULT_NOTIFICATION_PREFERENCES;
}

/**
 * Story 2.8 — sanctioned write path for `notification_preferences`.
 * UPSERTs on the `patient_id` primary key so the first toggle
 * doesn't need a separate INSERT path. Returns the post-write row.
 */
export async function writeNotificationPreferences(
  database: AuditDb,
  patientId: string,
  prefs: NotificationPreferencesInput,
): Promise<NotificationPreferencesInput> {
  const [row] = await database
    .insert(NotificationPreferences)
    .values({
      patientId,
      resultsReady: prefs.resultsReady,
      lettersReady: prefs.lettersReady,
      recordAccess: prefs.recordAccess,
      reviewRequired: prefs.reviewRequired,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: NotificationPreferences.patientId,
      set: {
        resultsReady: prefs.resultsReady,
        lettersReady: prefs.lettersReady,
        recordAccess: prefs.recordAccess,
        reviewRequired: prefs.reviewRequired,
        updatedAt: new Date(),
      },
    })
    .returning({
      resultsReady: NotificationPreferences.resultsReady,
      lettersReady: NotificationPreferences.lettersReady,
      recordAccess: NotificationPreferences.recordAccess,
      reviewRequired: NotificationPreferences.reviewRequired,
    });
  if (!row) {
    throw new Error("writeNotificationPreferences: insert returned no row");
  }
  return row;
}
