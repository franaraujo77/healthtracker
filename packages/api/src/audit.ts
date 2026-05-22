import type { db } from "@healthtracker/db/client";
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
  actorType: "patient" | "doctor" | "system";
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
