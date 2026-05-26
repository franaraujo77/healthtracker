/**
 * Story 5.1 T2.6 — RLS for `share_token_biomarkers`.
 *
 * The central LGPD guarantee of Epic 5 (NFR-S3): a doctor connection
 * MUST see only `visible = true` rows, even though the underlying
 * row exists with `visible = false`.
 */
import { afterEach, describe, expect, it } from "vitest";

import { asIdentity } from "./helpers";
import { serviceClient } from "./setup";

const seededTokenIds: string[] = [];
const seededInviteIds: string[] = [];

async function seedTokenWithBiomarkers(args: {
  patientId: string;
  biomarkers: { category: string; visible: boolean }[];
  expiresAt?: Date;
  revokedAt?: Date | null;
  identifierHash?: string;
}): Promise<string> {
  const inviteId = crypto.randomUUID();
  const tokenId = crypto.randomUUID();
  await serviceClient.from("pending_invites").insert({
    id: inviteId,
    patient_id: args.patientId,
    display_name: "Dra. STB",
    identifier_hash: args.identifierHash ?? "s".repeat(64),
  });
  seededInviteIds.push(inviteId);
  await serviceClient.from("share_tokens").insert({
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
  seededTokenIds.push(tokenId);
  await serviceClient.from("share_token_biomarkers").insert(
    args.biomarkers.map((b) => ({
      share_token_id: tokenId,
      biomarker_category: b.category,
      visible: b.visible,
    })),
  );
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

describe("share_token_biomarkers RLS — LGPD per-biomarker scope (NFR-S3)", () => {
  it("doctorWithActiveToken sees ONLY visible=true rows (central LGPD guarantee)", async () => {
    const patientId = crypto.randomUUID();
    const tokenId = await seedTokenWithBiomarkers({
      patientId,
      biomarkers: [
        { category: "ferritin", visible: false },
        { category: "hemoglobin", visible: true },
      ],
    });
    const run = asIdentity("doctorWithActiveToken", {
      patientId,
      shareTokenId: tokenId,
    });
    const rows = await run(
      (tx) => tx<{ biomarker_category: string }[]>`
      SELECT biomarker_category FROM share_token_biomarkers
      WHERE share_token_id = ${tokenId}::uuid
    `,
    );
    expect(rows.map((r) => r.biomarker_category)).toEqual(["hemoglobin"]);
  });

  it("correctPatient sees ALL rows for own share token (both visible+hidden)", async () => {
    const patientId = crypto.randomUUID();
    const tokenId = await seedTokenWithBiomarkers({
      patientId,
      biomarkers: [
        { category: "ferritin", visible: false },
        { category: "hemoglobin", visible: true },
      ],
    });
    const run = asIdentity("correctPatient", { patientId });
    const rows = await run(
      (tx) => tx<{ biomarker_category: string }[]>`
      SELECT biomarker_category FROM share_token_biomarkers
      WHERE share_token_id = ${tokenId}::uuid
    `,
    );
    expect(rows.map((r) => r.biomarker_category).sort()).toEqual([
      "ferritin",
      "hemoglobin",
    ]);
  });

  it("wrongPatient sees zero share_token_biomarkers rows", async () => {
    const patientId = crypto.randomUUID();
    const otherPatientId = crypto.randomUUID();
    const tokenId = await seedTokenWithBiomarkers({
      patientId,
      biomarkers: [{ category: "ferritin", visible: true }],
    });
    const run = asIdentity("wrongPatient", { patientId, otherPatientId });
    const rows = await run(
      (tx) => tx<{ biomarker_category: string }[]>`
      SELECT biomarker_category FROM share_token_biomarkers
      WHERE share_token_id = ${tokenId}::uuid
    `,
    );
    expect(rows).toHaveLength(0);
  });

  // Patch #13 — fill the 6-identity matrix.
  it("doctorWithExpiredToken sees zero biomarker rows", async () => {
    const patientId = crypto.randomUUID();
    const tokenId = await seedTokenWithBiomarkers({
      patientId,
      biomarkers: [{ category: "ferritin", visible: true }],
      expiresAt: new Date(Date.now() - 86_400_000),
    });
    const run = asIdentity("doctorWithExpiredToken", {
      patientId,
      shareTokenId: tokenId,
    });
    const rows = await run(
      (tx) => tx<{ biomarker_category: string }[]>`
      SELECT biomarker_category FROM share_token_biomarkers
      WHERE share_token_id = ${tokenId}::uuid
    `,
    );
    expect(rows).toHaveLength(0);
  });

  it("doctorWithRevokedToken sees zero biomarker rows", async () => {
    const patientId = crypto.randomUUID();
    const tokenId = await seedTokenWithBiomarkers({
      patientId,
      biomarkers: [{ category: "ferritin", visible: true }],
      revokedAt: new Date(),
    });
    const run = asIdentity("doctorWithRevokedToken", {
      patientId,
      shareTokenId: tokenId,
    });
    const rows = await run(
      (tx) => tx<{ biomarker_category: string }[]>`
      SELECT biomarker_category FROM share_token_biomarkers
      WHERE share_token_id = ${tokenId}::uuid
    `,
    );
    expect(rows).toHaveLength(0);
  });

  it("cross-token doctor (GUC bound to share-A, queries share-B) sees zero rows", async () => {
    const patientId = crypto.randomUUID();
    const tokenA = await seedTokenWithBiomarkers({
      patientId,
      biomarkers: [{ category: "ferritin", visible: true }],
      identifierHash: "a".repeat(64),
    });
    const tokenB = await seedTokenWithBiomarkers({
      patientId,
      biomarkers: [{ category: "hemoglobin", visible: true }],
      identifierHash: "b".repeat(64),
    });
    // Doctor's GUC binds to tokenA — they MUST NOT see tokenB rows.
    const run = asIdentity("doctorWithActiveToken", {
      patientId,
      shareTokenId: tokenA,
    });
    const rows = await run(
      (tx) => tx<{ biomarker_category: string }[]>`
      SELECT biomarker_category FROM share_token_biomarkers
      WHERE share_token_id = ${tokenB}::uuid
    `,
    );
    expect(rows).toHaveLength(0);
  });

  it("serviceRole bypasses RLS and sees both visible and hidden biomarker rows", async () => {
    const patientId = crypto.randomUUID();
    const tokenId = await seedTokenWithBiomarkers({
      patientId,
      biomarkers: [
        { category: "ferritin", visible: false },
        { category: "hemoglobin", visible: true },
      ],
    });
    const { data, error } = await serviceClient
      .from("share_token_biomarkers")
      .select("biomarker_category, visible")
      .eq("share_token_id", tokenId);
    expect(error).toBeNull();
    const categories = (
      (data ?? []) as { biomarker_category: string; visible: boolean }[]
    )
      .map((r) => r.biomarker_category)
      .sort();
    expect(categories).toEqual(["ferritin", "hemoglobin"]);
  });
});
