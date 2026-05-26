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
}): Promise<string> {
  const inviteId = crypto.randomUUID();
  const tokenId = crypto.randomUUID();
  await serviceClient.from("pending_invites").insert({
    id: inviteId,
    patient_id: args.patientId,
    display_name: "Dra. STB",
    identifier_hash: "s".repeat(64),
  });
  seededInviteIds.push(inviteId);
  await serviceClient.from("share_tokens").insert({
    id: tokenId,
    token_hash: `hash-${tokenId}`,
    token_hmac: `hmac-${tokenId}`,
    patient_id: args.patientId,
    invite_id: inviteId,
    expires_at: new Date(Date.now() + 7 * 86_400_000).toISOString(),
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
});
