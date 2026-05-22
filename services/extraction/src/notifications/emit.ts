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
  // Audit emission first — append-only contract (Story 1.1 F10
  // service-role bypass; worker writes via service-role).
  await tx`
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
  `;

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
