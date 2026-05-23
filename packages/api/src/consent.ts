import type { ConsentDataType } from "@healthtracker/validators";
import { and, eq, isNull, sql } from "@healthtracker/db";
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

export interface ConsentRevocationInput {
  patientId: string;
  consentType: ConsentDataType;
}

/**
 * Story 1.4 — sanctioned write path for revoking the patient's currently
 * active grant of `consentType`. Issues a narrow UPDATE that sets
 * `revoked_at = NOW()` on the row where `revoked_at IS NULL`; the
 * `custom_rls_consent_grants_zz_revoke.sql` policy enforces that only the
 * row's owner can update, and the accompanying trigger enforces that no
 * column other than `revoked_at` may be touched.
 *
 * Returns the revoked row's `{ id, version }` when an active grant
 * existed, or `null` when nothing was active (idempotent path for the
 * caller — re-tapping "Retirar" is not an error).
 */
export async function writeConsentRevocation(
  database: AuditDb,
  entry: ConsentRevocationInput,
): Promise<{ id: string; version: string } | null> {
  const [row] = await database
    .update(ConsentGrants)
    .set({ revokedAt: sql`NOW()` })
    .where(
      and(
        eq(ConsentGrants.patientId, entry.patientId),
        eq(ConsentGrants.consentType, entry.consentType),
        isNull(ConsentGrants.revokedAt),
      ),
    )
    .returning({ id: ConsentGrants.id, version: ConsentGrants.version });
  return row ?? null;
}
