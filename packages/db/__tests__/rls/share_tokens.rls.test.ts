/**
 * Story 5.1 T2.5 — RLS for `share_tokens`.
 * 6-identity matrix:
 *   correctPatient / wrongPatient / serviceRole
 *   doctorWithActiveToken / doctorWithExpiredToken / doctorWithRevokedToken
 *
 * Requires: `supabase start` + applied
 * `custom_rls_pending_invites.sql` + `custom_rls_share_tokens.sql`.
 */
import { afterEach, describe, expect, it } from "vitest";

import { asIdentity } from "./helpers";
import { cleanupSeededUsers, seedUser, serviceClient } from "./setup";

const seededInviteIds: string[] = [];
const seededTokenIds: string[] = [];
const seededUserIds: string[] = [];

async function seedToken(args: {
  patientId: string;
  expiresAt?: Date;
  revokedAt?: Date | null;
}): Promise<string> {
  await seedUser(args.patientId);
  seededUserIds.push(args.patientId);
  const inviteId = crypto.randomUUID();
  const tokenId = crypto.randomUUID();
  const { error: e1 } = await serviceClient.from("pending_invites").insert({
    id: inviteId,
    patient_id: args.patientId,
    display_name: "Dra. T",
    identifier_hash: "t".repeat(64),
  });
  if (e1) throw new Error(`invite seed failed: ${e1.message}`);
  seededInviteIds.push(inviteId);
  const { error: e2 } = await serviceClient.from("share_tokens").insert({
    id: tokenId,
    token_hash: `hash-${tokenId}`,
    token_hmac: `hmac-${tokenId}`,
    patient_id: args.patientId,
    invite_id: inviteId,
    expires_at: (
      args.expiresAt ?? new Date(Date.now() + 7 * 86_400_000)
    ).toISOString(),
    revoked_at: args.revokedAt ? args.revokedAt.toISOString() : null,
    duration: "7d",
  });
  if (e2) throw new Error(`share_tokens seed failed: ${e2.message}`);
  seededTokenIds.push(tokenId);
  return tokenId;
}

afterEach(async () => {
  if (seededTokenIds.length > 0) {
    await serviceClient.from("share_tokens").delete().in("id", seededTokenIds);
    seededTokenIds.length = 0;
  }
  if (seededInviteIds.length > 0) {
    await serviceClient
      .from("pending_invites")
      .delete()
      .in("id", seededInviteIds);
    seededInviteIds.length = 0;
  }
  if (seededUserIds.length > 0) {
    await cleanupSeededUsers(seededUserIds);
    seededUserIds.length = 0;
  }
});

describe("share_tokens RLS", () => {
  it("correctPatient sees own share_tokens", async () => {
    const patientId = crypto.randomUUID();
    const id = await seedToken({ patientId });
    const run = asIdentity("correctPatient", { patientId });
    const rows = await run(
      (tx) => tx<{ id: string }[]>`
      SELECT id FROM share_tokens WHERE patient_id = ${patientId}::uuid
    `,
    );
    expect(rows.map((r) => r.id)).toContain(id);
  });

  it("wrongPatient sees zero share_tokens for another patient", async () => {
    const patientId = crypto.randomUUID();
    const otherPatientId = crypto.randomUUID();
    await seedToken({ patientId });
    const run = asIdentity("wrongPatient", { patientId, otherPatientId });
    const rows = await run(
      (tx) => tx<{ id: string }[]>`
      SELECT id FROM share_tokens WHERE patient_id = ${patientId}::uuid
    `,
    );
    expect(rows).toHaveLength(0);
  });

  it("doctorWithActiveToken sees the single bound token", async () => {
    const patientId = crypto.randomUUID();
    const id = await seedToken({ patientId });
    const run = asIdentity("doctorWithActiveToken", {
      patientId,
      shareTokenId: id,
    });
    const rows = await run(
      (tx) => tx<{ id: string }[]>`
      SELECT id FROM share_tokens WHERE id = ${id}::uuid
    `,
    );
    expect(rows).toHaveLength(1);
  });

  it("doctorWithExpiredToken sees zero rows", async () => {
    const patientId = crypto.randomUUID();
    const id = await seedToken({
      patientId,
      expiresAt: new Date(Date.now() - 86_400_000),
    });
    const run = asIdentity("doctorWithExpiredToken", {
      patientId,
      shareTokenId: id,
    });
    const rows = await run(
      (tx) => tx<{ id: string }[]>`
      SELECT id FROM share_tokens WHERE id = ${id}::uuid
    `,
    );
    expect(rows).toHaveLength(0);
  });

  it("doctorWithRevokedToken sees zero rows", async () => {
    const patientId = crypto.randomUUID();
    const id = await seedToken({ patientId, revokedAt: new Date() });
    const run = asIdentity("doctorWithRevokedToken", {
      patientId,
      shareTokenId: id,
    });
    const rows = await run(
      (tx) => tx<{ id: string }[]>`
      SELECT id FROM share_tokens WHERE id = ${id}::uuid
    `,
    );
    expect(rows).toHaveLength(0);
  });

  // Story 5.2 — `expires_at IS NULL` ("Sem prazo") rows MUST be
  // visible under the updated `(IS NULL OR > now())` predicate.
  it("doctorWithNoExpiryToken sees the bound token when expires_at IS NULL", async () => {
    const patientId = crypto.randomUUID();
    await seedUser(patientId);
    seededUserIds.push(patientId);
    const inviteId = crypto.randomUUID();
    const tokenId = crypto.randomUUID();
    await serviceClient.from("pending_invites").insert({
      id: inviteId,
      patient_id: patientId,
      display_name: "Dra. N",
      identifier_hash: "n".repeat(64),
    });
    seededInviteIds.push(inviteId);
    await serviceClient.from("share_tokens").insert({
      id: tokenId,
      token_hash: `hash-${tokenId}`,
      token_hmac: `hmac-${tokenId}`,
      patient_id: patientId,
      invite_id: inviteId,
      expires_at: null,
      revoked_at: null,
      duration: "no_expiry",
    });
    seededTokenIds.push(tokenId);
    const run = asIdentity("doctorWithNoExpiryToken", {
      patientId,
      shareTokenId: tokenId,
    });
    const rows = await run(
      (tx) => tx<{ id: string }[]>`
      SELECT id FROM share_tokens WHERE id = ${tokenId}::uuid
    `,
    );
    expect(rows).toHaveLength(1);
  });

  // Patch #13 — 6th identity. serviceRole MUST see all share tokens.
  it("serviceRole bypasses RLS and sees every share_tokens row", async () => {
    const patientId = crypto.randomUUID();
    const otherPatientId = crypto.randomUUID();
    const idA = await seedToken({ patientId });
    const idB = await seedToken({ patientId: otherPatientId });
    const { data, error } = await serviceClient
      .from("share_tokens")
      .select("id")
      .in("id", [idA, idB]);
    expect(error).toBeNull();
    const ids = ((data ?? []) as { id: string }[]).map((r) => r.id).sort();
    expect(ids).toEqual([idA, idB].sort());
  });
});
