import { pgTable } from "drizzle-orm/pg-core";

/**
 * `audit_log` — append-only record of actions taken on patient data (AR10).
 *
 * Rows are written exclusively through `writeAuditLog()` in
 * `@healthtracker/api`. The table has no UPDATE or DELETE RLS policy, so it is
 * append-only at the database layer (NFR-S4).
 */
export const AuditLog = pgTable("audit_log", (t) => ({
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
}));
