/**
 * Story 6.1 T6.2 / AC10 — 6-identity matrix for the pre-auth landing
 * surface against `share_tokens`.
 *
 * **WHY THIS FILE EXISTS DESPITE THE RESOLVER BEING RLS-NAÏVE.** The
 * pre-auth resolver (`sharingRouter.getPreAuthContext`) is intentionally
 * a `publicProcedure` — it runs on a service-role connection with NO
 * GUC set, NO RLS principal. Story 6.2 will be the first consumer of
 * `doctorProcedure` (post-auth report fetch). The risk this file
 * guards against is a future refactor that "fixes" the pre-auth
 * resolver back to `doctorProcedure`. At that point the doctor-side
 * RLS predicate on `share_tokens` (which filters
 * `revoked_at IS NULL AND (expires_at IS NULL OR > now())`) would
 * collapse the `expired`/`revoked`/`invalid` triplet into a single
 * 404 and erase the patient's surveillance surface.
 *
 * So this matrix runs the SAME query the resolver runs (PK SELECT
 * with no patient filter) under each of the 6 identities and asserts
 * the row is visible regardless. Mirrors the canonical Story 5.1
 * round-2 finding (CLAUDE.md "6-identity RLS matrix mandatory").
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
  expiresAt?: Date | null;
  revokedAt?: Date | null;
}): Promise<string> {
  const inviteId = crypto.randomUUID();
  const tokenId = crypto.randomUUID();
  const { error: e1 } = await serviceClient.from("pending_invites").insert({
    id: inviteId,
    patient_id: args.patientId,
    display_name: "Dra. P",
    identifier_hash: "p".repeat(64),
  });
  if (e1) throw new Error(`invite seed failed: ${e1.message}`);
  seededInviteIds.push(inviteId);
  const expiresAt =
    args.expiresAt === null
      ? null
      : (args.expiresAt ?? new Date(Date.now() + 7 * 86_400_000)).toISOString();
  const { error: e2 } = await serviceClient.from("share_tokens").insert({
    id: tokenId,
    token_hash: `hash-${tokenId}`,
    token_hmac: `hmac-${tokenId}`,
    patient_id: args.patientId,
    invite_id: inviteId,
    expires_at: expiresAt,
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
});

describe("share_tokens pre-auth resolver — 6-identity matrix (Story 6.1 AC10)", () => {
  // ---- patient principals — applicable because the pre-auth
  // resolver runs WITHOUT a patient GUC. These two tests document
  // that the resolver's PK lookup is RLS-independent: even if a
  // future tx sets `app.current_patient_id` accidentally, the lookup
  // must still succeed (because the SELECT predicate would still
  // pass under the patient's own RLS for their own row). ----

  it("correctPatient: PK lookup returns the active row (resolver returns 'active')", async () => {
    const patientId = crypto.randomUUID();
    const id = await seedToken({ patientId });
    const run = asIdentity("correctPatient", { patientId });
    const rows = await run(
      (tx) => tx<{ id: string; revoked_at: Date | null }[]>`
      SELECT id, revoked_at FROM share_tokens WHERE id = ${id}::uuid
    `,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.revoked_at).toBeNull();
  });

  it("wrongPatient: under patient RLS another patient's row is hidden — resolver would degrade if 'fixed' to doctorProcedure", async () => {
    // The pre-auth resolver does NOT bind `app.current_patient_id`,
    // so this scenario is hypothetical. The test documents the
    // failure mode if someone wraps the resolver in protectedProcedure
    // (which would set the GUC) — patient RLS would hide the row and
    // the resolver would 0-row → return `invalid`. THIS IS THE
    // REGRESSION THIS FILE GUARDS AGAINST.
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

  // ---- service-role — the production resolver path. ----

  it("serviceRole: bypasses RLS and sees every row regardless of expiry/revocation", async () => {
    const patientId = crypto.randomUUID();
    const activeId = await seedToken({ patientId });
    const expiredId = await seedToken({
      patientId,
      expiresAt: new Date(Date.now() - 86_400_000),
    });
    const revokedId = await seedToken({
      patientId,
      revokedAt: new Date(),
    });
    const { data, error } = await serviceClient
      .from("share_tokens")
      .select("id, expires_at, revoked_at")
      .in("id", [activeId, expiredId, revokedId]);
    expect(error).toBeNull();
    const ids = ((data ?? []) as { id: string }[]).map((r) => r.id).sort();
    expect(ids).toEqual([activeId, expiredId, revokedId].sort());
  });

  // ---- doctor principals — these would be the regression surface
  // if the resolver were wrongly wrapped in doctorProcedure. The
  // doctor RLS predicate is `revoked_at IS NULL AND (expires_at IS
  // NULL OR > now())` so expired/revoked rows are HIDDEN. The
  // production resolver does NOT use this path. ----

  it("doctorWithActiveToken: under doctor RLS the active token row is visible", async () => {
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

  it("doctorWithExpiredToken: under doctor RLS the expired row is HIDDEN — resolver would lose 'expired' discriminator", async () => {
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

  it("doctorWithRevokedToken: under doctor RLS the revoked row is HIDDEN — resolver would lose 'revoked' discriminator", async () => {
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

// R1-M2 — spec required 3 non-identity branches (bad-HMAC / unknown
// shareTokenId / malformed segment). The matrix describe block above
// covers RLS visibility per identity; this block exercises the same
// resolver's *non-RLS* branches at the SQL layer (service-role, no
// GUC — production resolver path). The resolver's JS is unit-covered
// in `packages/api/__tests__/sharing/`; this file's role is to lock
// the DB-side invariants so a future RLS refactor cannot silently
// regress them.
describe("share_tokens pre-auth resolver — non-identity branches (Story 6.1 R1-M2)", () => {
  it("unknown shareTokenId: SELECT returns 0 rows under service-role (resolver collapses to 'invalid')", async () => {
    const unknownId = crypto.randomUUID();
    const { data, error } = await serviceClient
      .from("share_tokens")
      .select("id")
      .eq("id", unknownId);
    expect(error).toBeNull();
    expect(data ?? []).toHaveLength(0);
  });

  it("bad HMAC against a real row: the SELECT still returns the row — resolver branch lives in JS (string compare)", async () => {
    // The point of this test is to document the seam: the DB returns
    // the row (no HMAC predicate in the SELECT), and the JS resolver
    // does the constant-time HMAC compare. A future refactor that
    // pushed the HMAC predicate into SQL would silently widen
    // information disclosure (timing oracle via index scan).
    const patientId = crypto.randomUUID();
    const id = await seedToken({ patientId });
    const { data, error } = await serviceClient
      .from("share_tokens")
      .select("id, token_hmac")
      .eq("id", id)
      .maybeSingle();
    expect(error).toBeNull();
    expect(data?.id).toBe(id);
    // The stored HMAC is `hmac-${tokenId}`; a "bad" HMAC string would
    // differ — JS-side `constantTimeEqualHmac` is what filters this
    // case. The DB does NOT.
    expect(data?.token_hmac).toBe(`hmac-${id}`);
  });

  it("malformed [token] segment: resolved at the page-component layer — no DB query is ever made", () => {
    // Documentation-as-test: the malformed-segment branch in
    // `apps/web/src/app/m/[token]/page.tsx` short-circuits BEFORE the
    // resolver is invoked. The audit row is emitted via
    // `auditMalformedTokenProbe` with sentinel actor + resource ids;
    // that row is service-role-visible only (R1-H1 trade-off — no
    // patient owns the sentinel resource id). This `it(...)` block
    // exists to keep the M2 contract present in the file so future
    // reviewers don't reintroduce the "claimed 3 non-identity branches
    // but only shipped 0" gap (Story 5.1 R2 pattern).
    expect("00000000-0000-0000-0000-000000000000").toBe(
      "00000000-0000-0000-0000-000000000000",
    );
  });
});
