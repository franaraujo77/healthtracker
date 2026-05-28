/**
 * Story 5.2 T2.6 — RLS coverage for `conversation_starter_cache`.
 *
 * The Story 6.2 doctor surface MUST only see `status = 'ready'` rows
 * for the bound share token, and only when the parent token is non-
 * revoked + (NULL or future) `expires_at`. The patient principal sees
 * own rows always (any status). serviceRole bypasses RLS.
 */
import { afterEach, describe, expect, it } from "vitest";

import { asIdentity } from "./helpers";
import { cleanupSeededUsers, seedUser, serviceClient } from "./setup";

const seededTokenIds: string[] = [];
const seededInviteIds: string[] = [];
const seededCacheIds: string[] = [];
const seededUserIds: string[] = [];

async function seedTokenWithCache(args: {
  patientId: string;
  status: "queued" | "ready" | "failed";
  expiresAt?: Date | null;
  revokedAt?: Date | null;
}): Promise<{ tokenId: string; cacheId: string }> {
  await seedUser(args.patientId);
  seededUserIds.push(args.patientId);
  const inviteId = crypto.randomUUID();
  const tokenId = crypto.randomUUID();
  const cacheId = crypto.randomUUID();
  await serviceClient.from("pending_invites").insert({
    id: inviteId,
    patient_id: args.patientId,
    display_name: "Dra. CS",
    identifier_hash: "c".repeat(64),
  });
  seededInviteIds.push(inviteId);
  await serviceClient.from("share_tokens").insert({
    id: tokenId,
    token_hash: `hash-${tokenId}`,
    token_hmac: `hmac-${tokenId}`,
    patient_id: args.patientId,
    invite_id: inviteId,
    expires_at:
      args.expiresAt === null
        ? null
        : (
            args.expiresAt ?? new Date(Date.now() + 7 * 86_400_000)
          ).toISOString(),
    revoked_at: args.revokedAt ? args.revokedAt.toISOString() : null,
  });
  seededTokenIds.push(tokenId);
  await serviceClient.from("conversation_starter_cache").insert({
    id: cacheId,
    share_token_id: tokenId,
    patient_id: args.patientId,
    status: args.status,
    payload:
      args.status === "ready"
        ? { prompts: [{ text: "p" }], biomarkerCards: [] }
        : null,
  });
  seededCacheIds.push(cacheId);
  return { tokenId, cacheId };
}

afterEach(async () => {
  if (seededCacheIds.length > 0) {
    await serviceClient
      .from("conversation_starter_cache")
      .delete()
      .in("id", seededCacheIds);
    seededCacheIds.length = 0;
  }
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

describe("conversation_starter_cache RLS", () => {
  it("correctPatient sees own cache row regardless of status", async () => {
    const patientId = crypto.randomUUID();
    const { cacheId } = await seedTokenWithCache({
      patientId,
      status: "queued",
    });
    const run = asIdentity("correctPatient", { patientId });
    const rows = await run(
      (tx) => tx<{ id: string }[]>`
      SELECT id FROM conversation_starter_cache WHERE id = ${cacheId}::uuid
    `,
    );
    expect(rows).toHaveLength(1);
  });

  it("wrongPatient sees zero cache rows for another patient", async () => {
    const patientId = crypto.randomUUID();
    const otherPatientId = crypto.randomUUID();
    const { cacheId } = await seedTokenWithCache({
      patientId,
      status: "ready",
    });
    const run = asIdentity("wrongPatient", { patientId, otherPatientId });
    const rows = await run(
      (tx) => tx<{ id: string }[]>`
      SELECT id FROM conversation_starter_cache WHERE id = ${cacheId}::uuid
    `,
    );
    expect(rows).toHaveLength(0);
  });

  it("doctorWithActiveToken + status=ready sees the cache row", async () => {
    const patientId = crypto.randomUUID();
    const { tokenId, cacheId } = await seedTokenWithCache({
      patientId,
      status: "ready",
    });
    const run = asIdentity("doctorWithActiveToken", {
      patientId,
      shareTokenId: tokenId,
    });
    const rows = await run(
      (tx) => tx<{ id: string }[]>`
      SELECT id FROM conversation_starter_cache WHERE id = ${cacheId}::uuid
    `,
    );
    expect(rows).toHaveLength(1);
  });

  it("doctorWithActiveToken + status=queued sees ZERO rows (gate works)", async () => {
    const patientId = crypto.randomUUID();
    const { tokenId, cacheId } = await seedTokenWithCache({
      patientId,
      status: "queued",
    });
    const run = asIdentity("doctorWithActiveToken", {
      patientId,
      shareTokenId: tokenId,
    });
    const rows = await run(
      (tx) => tx<{ id: string }[]>`
      SELECT id FROM conversation_starter_cache WHERE id = ${cacheId}::uuid
    `,
    );
    expect(rows).toHaveLength(0);
  });

  it("doctorWithRevokedToken sees zero rows even when status=ready", async () => {
    const patientId = crypto.randomUUID();
    const { tokenId, cacheId } = await seedTokenWithCache({
      patientId,
      status: "ready",
      revokedAt: new Date(),
    });
    const run = asIdentity("doctorWithRevokedToken", {
      patientId,
      shareTokenId: tokenId,
    });
    const rows = await run(
      (tx) => tx<{ id: string }[]>`
      SELECT id FROM conversation_starter_cache WHERE id = ${cacheId}::uuid
    `,
    );
    expect(rows).toHaveLength(0);
  });

  it("doctorWithExpiredToken sees zero rows even when status=ready", async () => {
    const patientId = crypto.randomUUID();
    const { tokenId, cacheId } = await seedTokenWithCache({
      patientId,
      status: "ready",
      expiresAt: new Date(Date.now() - 86_400_000),
    });
    const run = asIdentity("doctorWithExpiredToken", {
      patientId,
      shareTokenId: tokenId,
    });
    const rows = await run(
      (tx) => tx<{ id: string }[]>`
      SELECT id FROM conversation_starter_cache WHERE id = ${cacheId}::uuid
    `,
    );
    expect(rows).toHaveLength(0);
  });

  it("doctorWithNoExpiryToken + status=ready sees the row (NULL expires_at branch)", async () => {
    const patientId = crypto.randomUUID();
    const { tokenId, cacheId } = await seedTokenWithCache({
      patientId,
      status: "ready",
      expiresAt: null,
    });
    const run = asIdentity("doctorWithNoExpiryToken", {
      patientId,
      shareTokenId: tokenId,
    });
    const rows = await run(
      (tx) => tx<{ id: string }[]>`
      SELECT id FROM conversation_starter_cache WHERE id = ${cacheId}::uuid
    `,
    );
    expect(rows).toHaveLength(1);
  });

  it("serviceRole bypasses RLS and sees every cache row", async () => {
    const patientId = crypto.randomUUID();
    const { cacheId } = await seedTokenWithCache({
      patientId,
      status: "queued",
    });
    const { data, error } = await serviceClient
      .from("conversation_starter_cache")
      .select("id")
      .eq("id", cacheId);
    expect(error).toBeNull();
    expect((data ?? []).length).toBe(1);
  });
});
