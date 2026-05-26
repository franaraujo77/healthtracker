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
import { serviceClient } from "./setup";

const seededInviteIds: string[] = [];
const seededTokenIds: string[] = [];

async function seedToken(args: {
  patientId: string;
  expiresAt?: Date;
  revokedAt?: Date | null;
}): Promise<string> {
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
});
