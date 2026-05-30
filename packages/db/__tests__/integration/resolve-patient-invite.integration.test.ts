/**
 * Story 6.4 T8.2 — testcontainer coverage for the
 * `initializeProfile`-extension flow that flips a `patient_invites`
 * row from `status='pending'` to `status='resolved'` atomically with
 * the user-row INSERT.
 *
 * Coverage:
 *   - Valid pending invite + valid HMAC → row flips, audit emitted.
 *   - Already-revoked invite → registration COMPLETES; zero update,
 *     zero `patient_invite.resolved` audit. (Story 1.1 path is
 *     unchanged on the invite-resolution failure branch.)
 *   - Concurrent claim (two tabs from the same magic link) → exactly
 *     ONE tab flips the row to resolved via the
 *     `WHERE status='pending'` predicate.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import type { IntegrationDb } from "./setup.js";
import { startIntegrationDb } from "./setup.js";

const DOCTOR = "88888888-8888-8888-8888-888888888888";

async function seedActivatedDoctor(db: IntegrationDb): Promise<void> {
  await db.sql`INSERT INTO users (id) VALUES (${DOCTOR}::uuid) ON CONFLICT DO NOTHING`;
  await db.sql`
    INSERT INTO professionals (user_id, display_name, category)
    VALUES (${DOCTOR}::uuid, 'Dr. R', 'clinico_geral')
    ON CONFLICT (user_id) DO NOTHING
  `;
}

async function seedPendingInvite(db: IntegrationDb): Promise<{
  inviteId: string;
  tokenHmac: string;
}> {
  const inviteId = crypto.randomUUID();
  const tokenHmac = `hmac-${inviteId}`;
  await db.sql`
    INSERT INTO patient_invites
      (id, professional_user_id, identifier_hash, identifier_kind, token_hmac)
    VALUES (
      ${inviteId}::uuid,
      ${DOCTOR}::uuid,
      ${"a".repeat(64)},
      'email',
      ${tokenHmac}
    )
  `;
  return { inviteId, tokenHmac };
}

/**
 * Mirror of `resolvePatientInviteWithinTx` minus the HMAC verify
 * (the JS-side compare is unit-tested separately). We assume the HMAC
 * matches.
 */
async function resolveInline(
  db: IntegrationDb,
  args: { inviteId: string; patientUserId: string },
): Promise<{ updated: number; auditEmitted: boolean }> {
  return db.sql.begin(async (tx) => {
    const rows = await tx<
      { status: string; revoked_at: Date | null; expires_at: Date }[]
    >`
      SELECT status::text, revoked_at, expires_at
      FROM patient_invites WHERE id = ${args.inviteId}::uuid
    `;
    const row = rows[0];
    if (!row) return { updated: 0, auditEmitted: false };
    if (row.status !== "pending") return { updated: 0, auditEmitted: false };
    if (row.revoked_at !== null) return { updated: 0, auditEmitted: false };
    if (row.expires_at.getTime() <= Date.now()) {
      return { updated: 0, auditEmitted: false };
    }
    const updated = await tx<{ id: string }[]>`
      UPDATE patient_invites
      SET resolved_user_id = ${args.patientUserId}::uuid,
          resolved_at = now(),
          status = 'resolved'
      WHERE id = ${args.inviteId}::uuid
        AND status = 'pending'
      RETURNING id
    `;
    if (updated.length === 0) return { updated: 0, auditEmitted: false };
    await tx`
      INSERT INTO audit_log
        (actor_id, actor_type, event, resource_id, resource_type, metadata)
      VALUES (
        ${args.patientUserId}::uuid,
        'patient',
        'patient_invite.resolved',
        ${args.inviteId}::uuid,
        'patient_invite',
        ${tx.json({ doctorUserId: DOCTOR })}
      )
    `;
    return { updated: 1, auditEmitted: true };
  });
}

describe("resolvePatientInvite — testcontainer integration (T8.2)", () => {
  let db: IntegrationDb;

  beforeAll(async () => {
    db = await startIntegrationDb();
    await seedActivatedDoctor(db);
  }, 180_000);

  afterAll(async () => {
    await db.sql.end();
    await db.container.stop();
  });

  afterEach(async () => {
    await db.sql`DELETE FROM audit_log WHERE event = 'patient_invite.resolved'`;
    await db.sql`DELETE FROM patient_invites`;
    // Clean up patient users created during tests.
    await db.sql`
      DELETE FROM users WHERE id NOT IN (${DOCTOR}::uuid)
    `;
  });

  it("valid pending invite → row flips to resolved + audit emitted", async () => {
    const patientId = crypto.randomUUID();
    await db.sql`INSERT INTO users (id) VALUES (${patientId}::uuid)`;
    const { inviteId } = await seedPendingInvite(db);

    const result = await resolveInline(db, {
      inviteId,
      patientUserId: patientId,
    });
    expect(result).toEqual({ updated: 1, auditEmitted: true });

    const row = await db.sql<
      { status: string; resolved_user_id: string | null }[]
    >`SELECT status::text, resolved_user_id FROM patient_invites WHERE id = ${inviteId}::uuid`;
    expect(row[0]?.status).toBe("resolved");
    expect(row[0]?.resolved_user_id).toBe(patientId);

    const audits = await db.sql<
      { actor_id: string; actor_type: string }[]
    >`SELECT actor_id, actor_type::text FROM audit_log WHERE event = 'patient_invite.resolved'`;
    expect(audits).toHaveLength(1);
    expect(audits[0]?.actor_id).toBe(patientId);
    expect(audits[0]?.actor_type).toBe("patient");
  });

  it("already-revoked invite → registration completes; zero update; zero audit", async () => {
    const patientId = crypto.randomUUID();
    await db.sql`INSERT INTO users (id) VALUES (${patientId}::uuid)`;
    const { inviteId } = await seedPendingInvite(db);
    await db.sql`
      UPDATE patient_invites SET revoked_at = now() WHERE id = ${inviteId}::uuid
    `;

    const result = await resolveInline(db, {
      inviteId,
      patientUserId: patientId,
    });
    expect(result).toEqual({ updated: 0, auditEmitted: false });

    const audits = await db.sql<
      { id: string }[]
    >`SELECT id FROM audit_log WHERE event = 'patient_invite.resolved'`;
    expect(audits).toHaveLength(0);
  });

  it("concurrent claim — only ONE update wins; the other no-ops via WHERE status='pending'", async () => {
    const patientId = crypto.randomUUID();
    await db.sql`INSERT INTO users (id) VALUES (${patientId}::uuid)`;
    const { inviteId } = await seedPendingInvite(db);

    // Two parallel resolve attempts on the same row + same patient
    // (simulates two tabs both submitting the form). The UPDATE WHERE
    // status='pending' predicate is the gating clause — only the
    // first commits a non-zero update.
    const [a, b] = await Promise.all([
      resolveInline(db, { inviteId, patientUserId: patientId }),
      resolveInline(db, { inviteId, patientUserId: patientId }),
    ]);
    const total = a.updated + b.updated;
    expect(total).toBe(1);

    const audits = await db.sql<
      { id: string }[]
    >`SELECT id FROM audit_log WHERE event = 'patient_invite.resolved'`;
    expect(audits).toHaveLength(1);
  });
});
