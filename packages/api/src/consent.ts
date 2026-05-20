import type { ConsentDataType } from "@healthtracker/validators";
import { isNull } from "@healthtracker/db";
import { ConsentGrants } from "@healthtracker/db/schema";

import type { AuditDb } from "./audit";

export interface ConsentGrantInsert {
  patientId: string;
  consentType: ConsentDataType;
  version: string;
  metadata?: Record<string, unknown>;
}

/**
 * Sanctioned write path for `consent_grants` — unconditional insert.
 * Throws if the insert returns no row (e.g., the partial unique index
 * fired against a duplicate active grant — callers that expect this race
 * must use `writeConsentGrantIfAbsent` instead).
 *
 * The table is append-only at the DB layer (no UPDATE/DELETE policies),
 * so a revocation must be a fresh INSERT with `revokedAt` populated
 * (Story 1.4 adds that path).
 */
export async function writeConsentGrant(
  database: AuditDb,
  entry: ConsentGrantInsert,
): Promise<{ id: string }> {
  const [row] = await database
    .insert(ConsentGrants)
    .values({
      patientId: entry.patientId,
      consentType: entry.consentType,
      version: entry.version,
      metadata: entry.metadata ?? {},
    })
    .returning({ id: ConsentGrants.id });
  if (!row) {
    throw new Error("writeConsentGrant: insert returned no row");
  }
  return row;
}

/**
 * Idempotent counterpart used by `consent.grant`. Inserts the row with
 * `ON CONFLICT DO NOTHING` against the `consent_grants_active_unique`
 * partial unique index; returns `null` when the active row already
 * existed (the caller looks it up). Race-safe under concurrent
 * "Concordo" taps.
 */
export async function writeConsentGrantIfAbsent(
  database: AuditDb,
  entry: ConsentGrantInsert,
): Promise<{ id: string } | null> {
  const [row] = await database
    .insert(ConsentGrants)
    .values({
      patientId: entry.patientId,
      consentType: entry.consentType,
      version: entry.version,
      metadata: entry.metadata ?? {},
    })
    .onConflictDoNothing({
      target: [
        ConsentGrants.patientId,
        ConsentGrants.consentType,
        ConsentGrants.version,
      ],
      where: isNull(ConsentGrants.revokedAt),
    })
    .returning({ id: ConsentGrants.id });
  return row ?? null;
}
