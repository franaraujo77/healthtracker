import type postgres from "postgres";

/**
 * Story 2.5 — worker-side audit + pg-boss-enqueue for notification
 * events. Mirrors the SQL shape of
 * `packages/api/src/notifications.ts:enqueueNotificationSend` and
 * `packages/api/src/audit.ts:writeAuditLog`.
 *
 * The worker uses the `postgres` driver (not Drizzle) so it can't
 * import those helpers directly (Story 2.3 R1-P94 deviation). The
 * SQL bodies are kept in sync by convention; a snapshot-sync test
 * is deferred (F134 family).
 *
 * Pass a `tx` (postgres.TransactionSql) when emitting inside an
 * outer transaction; the consumer's `sql.begin(...)` wraps the
 * dispatcher + audit emissions so all the writes are atomic.
 */

export type NotificationKind = "complete" | "pending_review" | "failed";

const NOTIFICATION_SEND_RETRY_LIMIT = 5;
const NOTIFICATION_SEND_RETRY_DELAY = 30;
const NOTIFICATION_SEND_RETRY_BACKOFF = true;

const NOTIFICATION_EVENT: Record<NotificationKind, string> = {
  complete: "notification.upload_complete",
  pending_review: "notification.upload_pending_review",
  failed: "notification.upload_failed",
};

export async function emitNotificationEvent(
  tx: postgres.Sql | postgres.TransactionSql,
  args: {
    uploadId: string;
    patientId: string;
    kind: NotificationKind;
    metadata?: Record<string, unknown>;
  },
): Promise<void> {
  const event = NOTIFICATION_EVENT[args.kind];
  // R2-P172 — `ON CONFLICT DO NOTHING` against the partial unique
  // index `audit_log_notification_event_unique` closes the TOCTOU
  // race where two concurrent writers (e.g. the consumer's dead-
  // letter path AND the dead-letter callback's `markUploadFailed`)
  // both insert for the same (upload, event). The unique index
  // matches only the three notification events, so non-notification
  // audit rows still INSERT freely.
  const inserted = await tx<{ id: string }[]>`
    INSERT INTO audit_log
      (actor_id, actor_type, event, resource_id, resource_type, metadata)
    VALUES (
      ${args.patientId}::uuid,
      'system',
      ${event},
      ${args.uploadId}::uuid,
      'upload',
      ${JSON.stringify({ triggeredBy: "worker", kind: args.kind, ...(args.metadata ?? {}) })}::jsonb
    )
    ON CONFLICT ON CONSTRAINT audit_log_notification_event_unique
    DO NOTHING
    RETURNING id
  `;
  if (inserted.length === 0) {
    // Another writer beat us — the audit row exists. Skip the
    // pg-boss enqueue too; the original writer queued it.
    console.warn(
      `[notifications/emit] uploadId=${args.uploadId} kind=${args.kind}: audit row already exists — skipping enqueue`,
    );
    return;
  }

  // Enqueue the `notification.send` pg-boss job. Singleton-keyed on
  // (upload_id, kind) so an idempotent worker retry doesn't fire
  // two pushes for the same event.
  const wrapped = {
    jobId: crypto.randomUUID(),
    patientId: args.patientId,
    correlationId: args.uploadId,
    payload: { uploadId: args.uploadId, kind: args.kind },
    createdAt: new Date().toISOString(),
  };
  const singletonKey = `${args.uploadId}.${args.kind}`;
  await tx`
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
  `;
}
