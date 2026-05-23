import { sql } from "drizzle-orm";
import { index, pgTable, uniqueIndex } from "drizzle-orm/pg-core";

/**
 * `audit_log` — append-only record of actions taken on patient data (AR10).
 *
 * Rows are written exclusively through `writeAuditLog()` in
 * `@healthtracker/api`. The table has no UPDATE or DELETE RLS policy, so it is
 * append-only at the database layer (NFR-S4).
 *
 * R2-P172 — partial unique index on `(resource_id, event)` for the
 * three notification-fanout events. Closes a TOCTOU race where two
 * concurrent transactions (e.g. consumer dead-letter + dead-letter
 * callback) both observed "no row exists" then both INSERT, leading
 * to two push notifications for the same upload/kind. Index is
 * partial so non-notification audit rows (the common case) keep
 * append-only semantics with no de-dup overhead.
 */
export const AuditLog = pgTable(
  "audit_log",
  (t) => ({
    id: t.uuid().notNull().primaryKey().defaultRandom(),
    actorId: t.uuid().notNull(),
    actorType: t.text().notNull(),
    event: t.text().notNull(),
    resourceId: t.uuid().notNull(),
    resourceType: t.text().notNull(),
    metadata: t.jsonb().$type<Record<string, unknown>>().notNull().default({}),
    createdAt: t
      .timestamp({ mode: "date", withTimezone: true })
      .defaultNow()
      .notNull(),
  }),
  (table) => [
    uniqueIndex("audit_log_notification_event_unique")
      .on(table.resourceId, table.event)
      .where(
        sql`${table.event} IN ('notification.upload_complete', 'notification.upload_pending_review', 'notification.upload_failed')`,
      ),
    // Epic 2 retro action item — anticipatory index for Story 5.3's
    // doctor-access-log SELECT ("show me every actor that touched my
    // record, newest first"). The composite supports both the
    // patient-scoped query (`actor_id = $patient` ORDER BY created_at
    // desc) and the per-event-class filter Story 5.3 will need.
    index("audit_log_actor_event_created_idx").on(
      table.actorId,
      table.event,
      sql`${table.createdAt} desc`,
    ),
  ],
);
