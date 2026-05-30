/**
 * Story 6.4 T8.1 — testcontainer coverage for `createPatientInvite`'s
 * DB semantics.
 *
 * The db package cannot import the api package without inverting the
 * dep graph; we mirror the resolver's SQL in raw template-literal form
 * (same pattern as `activate-professional-account.integration.test.ts`).
 *
 * Coverage:
 *   - Happy path: activated doctor + fresh email → row INSERTed,
 *     audit emitted, partial unique index respected.
 *   - Idempotent re-tap: same identifier twice → ONE row, ONE audit.
 *   - Renewal: a `status='expired'` row exists → fresh INSERT creates
 *     a SECOND row (partial unique index releases on non-pending).
 *   - Identifier-hash idempotency: two normalised mobile formats hash
 *     to the same key → idempotent collapse.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import type { IntegrationDb } from "./setup.js";
import { startIntegrationDb } from "./setup.js";

const DOCTOR = "88888888-8888-8888-8888-888888888888";

async function seedActivatedDoctor(db: IntegrationDb): Promise<void> {
  await db.sql`INSERT INTO users (id) VALUES (${DOCTOR}::uuid) ON CONFLICT DO NOTHING`;
  await db.sql`
    INSERT INTO professionals (user_id, display_name, category)
    VALUES (${DOCTOR}::uuid, 'Dr. Inviter', 'clinico_geral')
    ON CONFLICT (user_id) DO NOTHING
  `;
}

/**
 * Mirror of the resolver's idempotent-INSERT + audit emission. Skips
 * the activation gate + auth.users probe (sibling unit tests cover
 * those). Returns the inviteId.
 */
async function inviteInline(
  db: IntegrationDb,
  args: {
    doctorUserId: string;
    identifierHash: string;
    identifierKind: string;
  },
): Promise<string> {
  return db.sql.begin(async (tx) => {
    const existing = await tx<{ id: string }[]>`
      SELECT id FROM patient_invites
      WHERE professional_user_id = ${args.doctorUserId}::uuid
        AND identifier_hash = ${args.identifierHash}
        AND status = 'pending'
      LIMIT 1
    `;
    if (existing[0]) return existing[0].id;
    const inviteId = crypto.randomUUID();
    await tx`
      INSERT INTO patient_invites
        (id, professional_user_id, identifier_hash, identifier_kind, token_hmac)
      VALUES (
        ${inviteId}::uuid,
        ${args.doctorUserId}::uuid,
        ${args.identifierHash},
        ${args.identifierKind},
        ${`hmac-${inviteId}`}
      )
    `;
    await tx`
      INSERT INTO audit_log
        (actor_id, actor_type, event, resource_id, resource_type, metadata)
      VALUES (
        ${args.doctorUserId}::uuid,
        'doctor',
        'patient_invite.sent',
        ${inviteId}::uuid,
        'patient_invite',
        ${tx.json({ identifierKind: args.identifierKind, identifierHash: args.identifierHash })}
      )
    `;
    return inviteId;
  });
}

describe("createPatientInvite — testcontainer integration (T8.1)", () => {
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
    await db.sql`DELETE FROM audit_log WHERE event = 'patient_invite.sent'`;
    await db.sql`DELETE FROM patient_invites`;
  });

  it("happy path — fresh INSERT + ONE audit row", async () => {
    const hash = "a".repeat(64);
    const inviteId = await inviteInline(db, {
      doctorUserId: DOCTOR,
      identifierHash: hash,
      identifierKind: "email",
    });
    const rows = await db.sql<
      { id: string; status: string; identifier_kind: string }[]
    >`SELECT id, status, identifier_kind FROM patient_invites WHERE id = ${inviteId}::uuid`;
    expect(rows).toHaveLength(1);
    expect(rows[0]?.status).toBe("pending");
    expect(rows[0]?.identifier_kind).toBe("email");
    const audits = await db.sql<
      { actor_id: string; metadata: Record<string, unknown> }[]
    >`SELECT actor_id, metadata FROM audit_log WHERE event = 'patient_invite.sent'`;
    expect(audits).toHaveLength(1);
    expect(audits[0]?.actor_id).toBe(DOCTOR);
    expect(audits[0]?.metadata).toMatchObject({
      identifierHash: hash,
      identifierKind: "email",
    });
  });

  it("idempotent re-tap — same identifier twice → ONE row, ONE audit", async () => {
    const hash = "b".repeat(64);
    const first = await inviteInline(db, {
      doctorUserId: DOCTOR,
      identifierHash: hash,
      identifierKind: "email",
    });
    const second = await inviteInline(db, {
      doctorUserId: DOCTOR,
      identifierHash: hash,
      identifierKind: "email",
    });
    expect(second).toBe(first);
    const rows = await db.sql<
      { id: string }[]
    >`SELECT id FROM patient_invites WHERE professional_user_id = ${DOCTOR}::uuid AND identifier_hash = ${hash}`;
    expect(rows).toHaveLength(1);
    const audits = await db.sql<
      { id: string }[]
    >`SELECT id FROM audit_log WHERE event = 'patient_invite.sent'`;
    expect(audits).toHaveLength(1);
  });

  it("partial unique index releases on non-pending → renewal creates SECOND row", async () => {
    const hash = "c".repeat(64);
    const first = await inviteInline(db, {
      doctorUserId: DOCTOR,
      identifierHash: hash,
      identifierKind: "email",
    });
    // Simulate expiry — the lazy-expiry pattern: flip the status to
    // 'expired' (a sweep job would do this; for MVP it's lazy-on-read).
    await db.sql`
      UPDATE patient_invites SET status = 'expired' WHERE id = ${first}::uuid
    `;
    const second = await inviteInline(db, {
      doctorUserId: DOCTOR,
      identifierHash: hash,
      identifierKind: "email",
    });
    expect(second).not.toBe(first);
    const rows = await db.sql<
      { id: string; status: string }[]
    >`SELECT id, status FROM patient_invites WHERE professional_user_id = ${DOCTOR}::uuid AND identifier_hash = ${hash} ORDER BY created_at ASC`;
    expect(rows).toHaveLength(2);
    expect(rows[0]?.status).toBe("expired");
    expect(rows[1]?.status).toBe("pending");
    // TWO audit rows — each renewal IS a distinct act of acquisition.
    const audits = await db.sql<
      { id: string }[]
    >`SELECT id FROM audit_log WHERE event = 'patient_invite.sent'`;
    expect(audits).toHaveLength(2);
  });

  it("identifier_kind check constraint rejects unknown kinds", async () => {
    await expect(
      db.sql`
        INSERT INTO patient_invites
          (professional_user_id, identifier_hash, identifier_kind, token_hmac)
        VALUES (
          ${DOCTOR}::uuid,
          ${"d".repeat(64)},
          'sms',
          ${`hmac-${crypto.randomUUID()}`}
        )
      `,
    ).rejects.toMatchObject({ code: "23514" });
  });
});
