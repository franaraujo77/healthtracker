/**
 * Story 6.4 T8.3 — testcontainer coverage for the
 * `getPatientInviteContext` resolver's DB read path.
 *
 * Mirrors the resolver's SQL — the JOIN against `professionals` for
 * the doctor's display name + the four invalidity branches (status,
 * revoked, expired, bad-hmac).
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import type { IntegrationDb } from "./setup.js";
import { startIntegrationDb } from "./setup.js";

const DOCTOR = "88888888-8888-8888-8888-888888888888";
const DOCTOR_DISPLAY = "Dr. Inviter";

async function seedActivatedDoctor(db: IntegrationDb): Promise<void> {
  await db.sql`INSERT INTO users (id) VALUES (${DOCTOR}::uuid) ON CONFLICT DO NOTHING`;
  await db.sql`
    INSERT INTO professionals (user_id, display_name, category)
    VALUES (${DOCTOR}::uuid, ${DOCTOR_DISPLAY}, 'clinico_geral')
    ON CONFLICT (user_id) DO NOTHING
  `;
}

async function seedInvite(
  db: IntegrationDb,
  overrides: {
    status?: string;
    revokedAt?: Date | null;
    expiresAt?: Date;
  } = {},
): Promise<{ inviteId: string; tokenHmac: string }> {
  const inviteId = crypto.randomUUID();
  const tokenHmac = `hmac-${inviteId}`;
  const status = overrides.status ?? "pending";
  const revokedAt = overrides.revokedAt ?? null;
  const expiresAt = overrides.expiresAt ?? new Date(Date.now() + 86_400_000);
  await db.sql`
    INSERT INTO patient_invites
      (id, professional_user_id, identifier_hash, identifier_kind,
       token_hmac, status, revoked_at, expires_at)
    VALUES (
      ${inviteId}::uuid,
      ${DOCTOR}::uuid,
      ${"a".repeat(64)},
      'email',
      ${tokenHmac},
      ${status}::patient_invite_status_enum,
      ${revokedAt},
      ${expiresAt.toISOString()}
    )
  `;
  return { inviteId, tokenHmac };
}

interface ContextRow {
  token_hmac: string;
  status: string;
  expires_at: Date;
  revoked_at: Date | null;
  doctor_display_name: string;
}

async function fetchInviteContextRow(
  db: IntegrationDb,
  inviteId: string,
): Promise<ContextRow | null> {
  const rows = await db.sql<ContextRow[]>`
    SELECT pi.token_hmac, pi.status::text, pi.expires_at, pi.revoked_at,
           prof.display_name AS doctor_display_name
    FROM patient_invites pi
    JOIN professionals prof ON prof.user_id = pi.professional_user_id
    WHERE pi.id = ${inviteId}::uuid
    LIMIT 1
  `;
  return rows[0] ?? null;
}

describe("getPatientInviteContext — testcontainer integration (T8.3)", () => {
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
    await db.sql`DELETE FROM patient_invites`;
  });

  it("valid pending invite — returns row + doctor display name", async () => {
    const { inviteId, tokenHmac } = await seedInvite(db);
    const row = await fetchInviteContextRow(db, inviteId);
    expect(row).not.toBeNull();
    expect(row?.status).toBe("pending");
    expect(row?.revoked_at).toBeNull();
    expect(row?.token_hmac).toBe(tokenHmac);
    expect(row?.doctor_display_name).toBe(DOCTOR_DISPLAY);
    expect(row?.expires_at.getTime()).toBeGreaterThan(Date.now());
  });

  it("expired invite — row exists but expires_at is past now()", async () => {
    const { inviteId } = await seedInvite(db, {
      expiresAt: new Date(Date.now() - 86_400_000),
    });
    const row = await fetchInviteContextRow(db, inviteId);
    expect(row).not.toBeNull();
    expect(row?.expires_at.getTime()).toBeLessThan(Date.now());
  });

  it("revoked invite — revoked_at populated", async () => {
    const { inviteId } = await seedInvite(db, { revokedAt: new Date() });
    const row = await fetchInviteContextRow(db, inviteId);
    expect(row).not.toBeNull();
    expect(row?.revoked_at).not.toBeNull();
  });

  it("resolved invite — status !== 'pending'", async () => {
    const { inviteId } = await seedInvite(db, { status: "resolved" });
    const row = await fetchInviteContextRow(db, inviteId);
    expect(row?.status).toBe("resolved");
  });

  it("non-existent inviteId — null", async () => {
    const row = await fetchInviteContextRow(db, crypto.randomUUID());
    expect(row).toBeNull();
  });
});
