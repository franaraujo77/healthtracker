import type { db } from "@healthtracker/db/client";
import { sql } from "@healthtracker/db";
import { AuditLog } from "@healthtracker/db/schema";

/**
 * Drizzle database client, or a transaction handle issued inside one.
 * `protectedProcedure` forwards a transaction as `ctx.db`, so audit writes
 * land in the same transaction as the change they record.
 */
type Database = typeof db;
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
export type AuditDb = Database | Transaction;

export interface AuditLogEntry {
  /** The `auth.uid()` of whoever performed the action. */
  actorId: string;
  // Story 8.2 — `"operator"` added for the operator confirm/reject audit
  // (`extraction_field.operator_*`). `audit_log.actor_type` is free text,
  // so no DB enum change. These events are NOT in ACCESS_LOG_EVENT_KINDS.
  actorType: "patient" | "doctor" | "system" | "operator";
  /** Event name in `noun.verb` past-tense form, e.g. `patient.created`. */
  event: string;
  resourceId: string;
  resourceType: string;
  metadata?: Record<string, unknown>;
}

/**
 * The single sanctioned path for writing to `audit_log` (AR10). Never insert
 * into `audit_log` directly — the table is append-only (NFR-S4) and inline
 * inserts bypass this contract.
 */
export async function writeAuditLog(
  database: AuditDb,
  entry: AuditLogEntry,
): Promise<void> {
  await database.insert(AuditLog).values({
    actorId: entry.actorId,
    actorType: entry.actorType,
    event: entry.event,
    resourceId: entry.resourceId,
    resourceType: entry.resourceType,
    metadata: entry.metadata ?? {},
  });
}

/**
 * Code-review F2 (Story 4.1) — sanctioned idempotent variant. Used by
 * call sites whose write races against another writer on the partial
 * unique index `audit_log(resource_id, event) WHERE event IN (...)`. A
 * second 23505 inside an outer Drizzle transaction poisons the tx;
 * `onConflictDoNothing` sidesteps the entire 23505 path by emitting
 * `ON CONFLICT (resource_id, event) WHERE ... DO NOTHING` and tells the
 * caller via the boolean return whether the row was actually written.
 *
 * Pass the SAME `where` predicate that the partial unique index uses,
 * so Postgres can disambiguate which index ON CONFLICT targets. The
 * canonical predicate today (Story 4.4 migration `0004_*.sql`) is
 * `event IN ('notification.upload_complete',
 *   'notification.upload_pending_review', 'notification.upload_failed',
 *   'letter.queued')` — exposed as the `EVENT_DEDUP_VALUES` constant
 * so call sites don't duplicate the literal.
 */
export const EVENT_DEDUP_VALUES = [
  "notification.upload_complete",
  "notification.upload_pending_review",
  "notification.upload_failed",
  "letter.queued",
] as const;

export async function writeAuditLogIfNew(
  database: AuditDb,
  entry: AuditLogEntry,
): Promise<{ written: boolean }> {
  const rows = await database
    .insert(AuditLog)
    .values({
      actorId: entry.actorId,
      actorType: entry.actorType,
      event: entry.event,
      resourceId: entry.resourceId,
      resourceType: entry.resourceType,
      metadata: entry.metadata ?? {},
    })
    .onConflictDoNothing({
      target: [AuditLog.resourceId, AuditLog.event],
      where: sql`${AuditLog.event} IN ('notification.upload_complete', 'notification.upload_pending_review', 'notification.upload_failed', 'letter.queued')`,
    })
    .returning({ id: AuditLog.id });
  return { written: rows.length > 0 };
}
