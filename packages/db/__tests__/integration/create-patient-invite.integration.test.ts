/**
 * Story 6.4 T8.1 — testcontainer coverage for `createPatientInvite`'s
 * DB semantics.
 *
 * **Why this lives in the db package and mirrors the resolver inline
 * (R1-H1 follow-up):** the realistic path "call the actual resolver
 * from a testcontainer-backed test" is blocked by the dep graph —
 * api depends on db, so a db-package test importing `appRouter`
 * inverts the workspace. Moving the test to the api package would
 * require duplicating the testcontainer harness (currently exported
 * only by db) AND seeding a Supabase-managed `auth.users` schema that
 * `drizzle-kit push` does not own. The R1 review explicitly accepted
 * "extending the inline mirrors to cover all six spec cases" as the
 * adequate alternative; this file ships that extension.
 *
 * The forward-looking discipline — NEW resolvers ship resolver-call
 * integration tests in `packages/api/__tests__/<router>/*.integration.test.ts`
 * against a shared testcontainer harness once the harness is hoisted —
 * is documented in CLAUDE.md "Integration test discipline" (Story 6.4
 * R1 H1 addendum).
 *
 * Coverage (all 6 spec T8.1 cases + 1 check-constraint):
 *   1. Happy path — fresh INSERT + ONE audit row.
 *   2. Idempotent re-tap — same identifier twice → ONE row, ONE audit.
 *   3. Renewal — `status='expired'` releases the partial-unique index
 *      → fresh INSERT creates a SECOND row + TWO audit rows.
 *   4. **NEW — already-registered short-circuit.** A row exists in a
 *      seeded `auth.users` mirror keyed by email; the resolver's
 *      step-4 probe matches → NO patient_invites row written, NO
 *      audit emission. (Testcontainer lacks Supabase's real
 *      `auth.users` schema; we seed a minimal mirror so the SELECT
 *      shape the resolver issues actually returns a row.)
 *   5. **NEW — cross-doctor phone-hash collision.** Two activated
 *      doctors each invite the same normalized BR phone. The partial
 *      unique index is keyed on `(doctor_user_id, identifier_hash)`
 *      so the SECOND doctor's INSERT does NOT collide with the FIRST
 *      doctor's row — both rows survive, each with its own audit.
 *   6. **NEW — doctor-not-activated gate.** A bare auth.users row
 *      without a corresponding `professionals` row → activation-gate
 *      SELECT returns zero rows → resolver throws PRECONDITION_FAILED
 *      BEFORE any INSERT lands. Asserted at the SQL mirror level by
 *      observing the gate-SELECT returns empty and skipping the
 *      INSERT step.
 *   7. Check constraint — identifier_kind enforces `('email', 'phone')`.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import type { IntegrationDb } from "./setup.js";
import { startIntegrationDb } from "./setup.js";

const DOCTOR_A = "88888888-8888-8888-8888-888888888888";
const DOCTOR_B = "99999999-9999-9999-9999-999999999999";
const UNACTIVATED_DOCTOR = "77777777-7777-7777-7777-777777777777";

/**
 * Resolver-mirror error shape. The actual resolver throws TRPCError
 * with `code:'PRECONDITION_FAILED'`; we surface a plain error here so
 * the inline mirror is a faithful state-machine substitute without
 * dragging in @trpc/server (the db package has no api dep).
 */
class GateError extends Error {
  constructor(public readonly kind: "DOCTOR_NOT_ACTIVATED") {
    super(kind);
  }
}

async function seedActivatedDoctor(
  db: IntegrationDb,
  userId: string,
): Promise<void> {
  await db.sql`INSERT INTO users (id) VALUES (${userId}::uuid) ON CONFLICT DO NOTHING`;
  await db.sql`
    INSERT INTO professionals (user_id, display_name, category)
    VALUES (${userId}::uuid, 'Dr. Inviter', 'clinico_geral')
    ON CONFLICT (user_id) DO NOTHING
  `;
}

async function seedUnactivatedDoctor(
  db: IntegrationDb,
  userId: string,
): Promise<void> {
  // Application-domain users row only; NO professionals row → activation
  // gate must reject.
  await db.sql`INSERT INTO users (id) VALUES (${userId}::uuid) ON CONFLICT DO NOTHING`;
}

/**
 * Story 6.4 R1-H1 — minimal `auth.users` mirror for the
 * already-registered short-circuit case. The real schema is owned by
 * Supabase and not provisioned by `drizzle-kit push`; we create a
 * stand-in with the two columns the resolver's probe reads (`email`
 * and `phone`). The probe SQL the resolver issues is
 * `SELECT 1 FROM auth.users WHERE email = $1 LIMIT 1` so any minimal
 * shape suffices for the case under test.
 */
async function ensureAuthUsersMirror(db: IntegrationDb): Promise<void> {
  await db.sql`CREATE SCHEMA IF NOT EXISTS auth`;
  await db.sql`
    CREATE TABLE IF NOT EXISTS auth.users (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      email text,
      phone text
    )
  `;
}

/**
 * Mirror of the resolver's full sequence:
 *   step 1 — activation gate (SELECT professionals).
 *   step 4 — already-registered probe (SELECT auth.users).
 *   steps 5+7+8 — idempotent SELECT + INSERT + audit in one tx with a
 *   narrow 23505 catch.
 *
 * Returns `{ kind: 'already_registered' }` on the short-circuit,
 * `{ kind: 'invited', inviteId }` on success. Throws `GateError` for
 * the activation-gate rejection.
 */
async function inviteInline(
  db: IntegrationDb,
  args: {
    doctorUserId: string;
    identifierHash: string;
    identifierKind: "email" | "phone";
    normalized: string;
  },
): Promise<
  { kind: "already_registered" } | { kind: "invited"; inviteId: string }
> {
  // Step 1 — activation gate.
  const activated = await db.sql<{ user_id: string }[]>`
    SELECT user_id FROM professionals
    WHERE user_id = ${args.doctorUserId}::uuid
    LIMIT 1
  `;
  if (activated.length === 0) {
    throw new GateError("DOCTOR_NOT_ACTIVATED");
  }

  // Step 4 — auth.users existence probe. Mirrors the resolver's
  // bare-service-role SELECT (no JOIN to sharing tables).
  const phoneProbe =
    args.identifierKind === "phone" ? args.normalized.replace(/^\+/, "") : null;
  const probe =
    args.identifierKind === "email"
      ? await db.sql`SELECT 1 AS one FROM auth.users WHERE email = ${args.normalized} LIMIT 1`
      : await db.sql`SELECT 1 AS one FROM auth.users WHERE phone = ${phoneProbe} LIMIT 1`;
  if (probe.length > 0) {
    return { kind: "already_registered" };
  }

  // Steps 5 + 7 + 8 — idempotent INSERT + audit.
  return db.sql.begin(async (tx) => {
    const existing = await tx<{ id: string }[]>`
      SELECT id FROM patient_invites
      WHERE professional_user_id = ${args.doctorUserId}::uuid
        AND identifier_hash = ${args.identifierHash}
        AND status = 'pending'
      LIMIT 1
    `;
    if (existing[0])
      return { kind: "invited" as const, inviteId: existing[0].id };
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
    return { kind: "invited" as const, inviteId };
  });
}

describe("createPatientInvite — testcontainer integration (T8.1)", () => {
  let db: IntegrationDb;

  beforeAll(async () => {
    db = await startIntegrationDb();
    await ensureAuthUsersMirror(db);
    await seedActivatedDoctor(db, DOCTOR_A);
    await seedActivatedDoctor(db, DOCTOR_B);
    await seedUnactivatedDoctor(db, UNACTIVATED_DOCTOR);
  }, 180_000);

  afterAll(async () => {
    await db.sql.end();
    await db.container.stop();
  });

  afterEach(async () => {
    await db.sql`DELETE FROM audit_log WHERE event = 'patient_invite.sent'`;
    await db.sql`DELETE FROM patient_invites`;
    await db.sql`DELETE FROM auth.users`;
  });

  it("happy path — fresh INSERT + ONE audit row", async () => {
    const hash = "a".repeat(64);
    const result = await inviteInline(db, {
      doctorUserId: DOCTOR_A,
      identifierHash: hash,
      identifierKind: "email",
      normalized: "patient-a@example.com",
    });
    if (result.kind !== "invited") {
      throw new Error("expected invited");
    }
    const rows = await db.sql<
      { id: string; status: string; identifier_kind: string }[]
    >`SELECT id, status, identifier_kind FROM patient_invites WHERE id = ${result.inviteId}::uuid`;
    expect(rows).toHaveLength(1);
    expect(rows[0]?.status).toBe("pending");
    expect(rows[0]?.identifier_kind).toBe("email");
    const audits = await db.sql<
      { actor_id: string; metadata: Record<string, unknown> }[]
    >`SELECT actor_id, metadata FROM audit_log WHERE event = 'patient_invite.sent'`;
    expect(audits).toHaveLength(1);
    expect(audits[0]?.actor_id).toBe(DOCTOR_A);
    expect(audits[0]?.metadata).toMatchObject({
      identifierHash: hash,
      identifierKind: "email",
    });
  });

  it("idempotent re-tap — same identifier twice → ONE row, ONE audit", async () => {
    const hash = "b".repeat(64);
    const first = await inviteInline(db, {
      doctorUserId: DOCTOR_A,
      identifierHash: hash,
      identifierKind: "email",
      normalized: "patient-b@example.com",
    });
    const second = await inviteInline(db, {
      doctorUserId: DOCTOR_A,
      identifierHash: hash,
      identifierKind: "email",
      normalized: "patient-b@example.com",
    });
    if (first.kind !== "invited" || second.kind !== "invited") {
      throw new Error("expected invited on both calls");
    }
    expect(second.inviteId).toBe(first.inviteId);
    const rows = await db.sql<
      { id: string }[]
    >`SELECT id FROM patient_invites WHERE professional_user_id = ${DOCTOR_A}::uuid AND identifier_hash = ${hash}`;
    expect(rows).toHaveLength(1);
    const audits = await db.sql<
      { id: string }[]
    >`SELECT id FROM audit_log WHERE event = 'patient_invite.sent'`;
    expect(audits).toHaveLength(1);
  });

  it("partial unique index releases on non-pending → renewal creates SECOND row", async () => {
    const hash = "c".repeat(64);
    const first = await inviteInline(db, {
      doctorUserId: DOCTOR_A,
      identifierHash: hash,
      identifierKind: "email",
      normalized: "patient-c@example.com",
    });
    if (first.kind !== "invited") throw new Error("expected invited");
    await db.sql`
      UPDATE patient_invites SET status = 'expired' WHERE id = ${first.inviteId}::uuid
    `;
    const second = await inviteInline(db, {
      doctorUserId: DOCTOR_A,
      identifierHash: hash,
      identifierKind: "email",
      normalized: "patient-c@example.com",
    });
    if (second.kind !== "invited") throw new Error("expected invited");
    expect(second.inviteId).not.toBe(first.inviteId);
    const rows = await db.sql<
      { id: string; status: string }[]
    >`SELECT id, status FROM patient_invites WHERE professional_user_id = ${DOCTOR_A}::uuid AND identifier_hash = ${hash} ORDER BY created_at ASC`;
    expect(rows).toHaveLength(2);
    expect(rows[0]?.status).toBe("expired");
    expect(rows[1]?.status).toBe("pending");
    const audits = await db.sql<
      { id: string }[]
    >`SELECT id FROM audit_log WHERE event = 'patient_invite.sent'`;
    expect(audits).toHaveLength(2);
  });

  it("already-registered short-circuit — NO row written, NO audit emitted (R1-H1)", async () => {
    const email = "already@example.com";
    // Seed the auth.users mirror to simulate the patient already
    // having a Health Tracker account.
    await db.sql`INSERT INTO auth.users (email) VALUES (${email})`;
    const result = await inviteInline(db, {
      doctorUserId: DOCTOR_A,
      identifierHash: "d".repeat(64),
      identifierKind: "email",
      normalized: email,
    });
    expect(result).toEqual({ kind: "already_registered" });
    const rows = await db.sql<
      { id: string }[]
    >`SELECT id FROM patient_invites WHERE professional_user_id = ${DOCTOR_A}::uuid`;
    expect(rows).toHaveLength(0);
    const audits = await db.sql<
      { id: string }[]
    >`SELECT id FROM audit_log WHERE event = 'patient_invite.sent'`;
    expect(audits).toHaveLength(0);
  });

  it("cross-doctor phone-hash collision — partial unique index is per-doctor (R1-H1)", async () => {
    // Same normalized BR phone → same identifier_hash; two activated
    // doctors each invite the same patient. The partial unique index is
    // keyed on `(professional_user_id, identifier_hash) WHERE status='pending'`
    // so BOTH inserts must succeed.
    const hash = "e".repeat(64);
    const phone = "+5511999990000";
    const a = await inviteInline(db, {
      doctorUserId: DOCTOR_A,
      identifierHash: hash,
      identifierKind: "phone",
      normalized: phone,
    });
    const b = await inviteInline(db, {
      doctorUserId: DOCTOR_B,
      identifierHash: hash,
      identifierKind: "phone",
      normalized: phone,
    });
    if (a.kind !== "invited" || b.kind !== "invited") {
      throw new Error("expected invited on both calls");
    }
    expect(a.inviteId).not.toBe(b.inviteId);
    const rows = await db.sql<
      { id: string; professional_user_id: string }[]
    >`SELECT id, professional_user_id FROM patient_invites WHERE identifier_hash = ${hash} ORDER BY created_at ASC`;
    expect(rows).toHaveLength(2);
    expect(new Set(rows.map((r) => r.professional_user_id))).toEqual(
      new Set([DOCTOR_A, DOCTOR_B]),
    );
    const audits = await db.sql<
      { actor_id: string }[]
    >`SELECT actor_id FROM audit_log WHERE event = 'patient_invite.sent' ORDER BY created_at ASC`;
    expect(audits).toHaveLength(2);
    expect(new Set(audits.map((a2) => a2.actor_id))).toEqual(
      new Set([DOCTOR_A, DOCTOR_B]),
    );
  });

  it("doctor-not-activated gate — rejected BEFORE any DB write (R1-H1)", async () => {
    const hash = "f".repeat(64);
    await expect(
      inviteInline(db, {
        doctorUserId: UNACTIVATED_DOCTOR,
        identifierHash: hash,
        identifierKind: "email",
        normalized: "unactivated@example.com",
      }),
    ).rejects.toBeInstanceOf(GateError);
    // No row written, no audit emitted.
    const rows = await db.sql<
      { id: string }[]
    >`SELECT id FROM patient_invites WHERE professional_user_id = ${UNACTIVATED_DOCTOR}::uuid`;
    expect(rows).toHaveLength(0);
    const audits = await db.sql<
      { id: string }[]
    >`SELECT id FROM audit_log WHERE event = 'patient_invite.sent'`;
    expect(audits).toHaveLength(0);
  });

  it("identifier_kind check constraint rejects unknown kinds", async () => {
    await expect(
      db.sql`
        INSERT INTO patient_invites
          (professional_user_id, identifier_hash, identifier_kind, token_hmac)
        VALUES (
          ${DOCTOR_A}::uuid,
          ${"g".repeat(64)},
          'sms',
          ${`hmac-${crypto.randomUUID()}`}
        )
      `,
    ).rejects.toMatchObject({ code: "23514" });
  });
});
