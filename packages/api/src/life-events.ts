import type {
  CreateLifeEventInput,
  LifeEventView,
  ListLifeEventsInWindowInput,
  ListLifeEventsInWindowOutput,
} from "@healthtracker/validators";
import { and, asc, between, eq } from "@healthtracker/db";
import { LifeEvents } from "@healthtracker/db/schema";

import type { AuditDb } from "./audit";
import { writeAuditLog } from "./audit";

/**
 * Story 7.1 — write + read helpers for `life_events`.
 *
 * Every public function takes the `protectedProcedure` transaction
 * handle (`ctx.db`) and writes audit rows inline so the row and the
 * audit land atomically. RLS (`custom_rls_life_events.sql`) is the
 * security boundary; the app-layer `eq(patientId, …)` is
 * defense-in-depth (AR5).
 *
 * **PII discipline.** The `life_event.created` audit row carries
 * `{eventDate, category}` ONLY — never `description` (free-text,
 * possibly sensitive). The `audit_log` is append-only (NFR-S4) so a
 * leaked description there cannot be redacted.
 */

export async function createLifeEvent(
  database: AuditDb,
  patientId: string,
  input: CreateLifeEventInput,
): Promise<LifeEventView> {
  // INSERT ... RETURNING * — the trimmed description has already
  // passed Zod's 1..140 refine; the SQL CHECK constraint is
  // defense-in-depth.
  const rows = await database
    .insert(LifeEvents)
    .values({
      patientId,
      eventDate: input.eventDate,
      description: input.description,
      category: input.category ?? null,
      // privacyFlag defaults to 'patient_only' at the schema layer.
    })
    .returning({
      id: LifeEvents.id,
      eventDate: LifeEvents.eventDate,
      description: LifeEvents.description,
      category: LifeEvents.category,
      privacyFlag: LifeEvents.privacyFlag,
    });

  const row = rows[0];
  if (!row) {
    throw new Error("life_events insert returned no row");
  }

  // AC4 — single audit row inside the protectedProcedure transaction.
  // metadata carries `{eventDate, category}` only; description is PII
  // and intentionally never written to audit_log.
  await writeAuditLog(database, {
    actorId: patientId,
    actorType: "patient",
    event: "life_event.created",
    resourceId: row.id,
    resourceType: "life_event",
    metadata: { eventDate: row.eventDate, category: row.category },
  });

  return {
    id: row.id,
    eventDate: row.eventDate,
    description: row.description,
    category: row.category,
    privacyFlag: row.privacyFlag,
  };
}

/**
 * AC3 — read life events whose `event_date` lies within the visible
 * Fingerprint window. The chart caller derives the window from its
 * observation history; this helper does NOT audit-log (chart reads
 * are high-frequency and the marker render itself isn't a
 * privacy-relevant access surface — life events are already
 * patient-only).
 */
export async function listLifeEventsInWindow(
  database: AuditDb,
  patientId: string,
  input: ListLifeEventsInWindowInput,
): Promise<ListLifeEventsInWindowOutput> {
  const rows = await database
    .select({
      id: LifeEvents.id,
      eventDate: LifeEvents.eventDate,
      description: LifeEvents.description,
      category: LifeEvents.category,
      privacyFlag: LifeEvents.privacyFlag,
    })
    .from(LifeEvents)
    .where(
      and(
        eq(LifeEvents.patientId, patientId),
        between(LifeEvents.eventDate, input.fromDate, input.toDate),
      ),
    )
    .orderBy(asc(LifeEvents.eventDate));

  return { events: rows };
}
