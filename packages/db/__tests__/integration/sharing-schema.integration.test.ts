/**
 * Story 5.1 T1.5 — testcontainer integration coverage for the new
 * sharing schema:
 *   - tables come up via `drizzle-kit push --force`,
 *   - `pending_invites_patient_identifier_uq` rejects duplicates,
 *   - `share_token_biomarkers` composite PK rejects duplicates,
 *   - `ON DELETE CASCADE` from `share_tokens` removes
 *     `share_token_biomarkers` rows.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { IntegrationDb } from "./setup.js";
import { startIntegrationDb } from "./setup.js";

const PATIENT_A = "11111111-1111-1111-1111-111111111111";
const IDENTIFIER_HASH_A =
  "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

describe("sharing schema — Story 5.1 (testcontainer)", () => {
  let db: IntegrationDb;

  beforeAll(async () => {
    db = await startIntegrationDb();
    // Seed the `users` row referenced by the FKs.
    await db.sql`INSERT INTO users (id) VALUES (${PATIENT_A}::uuid)`;
  }, 180_000);

  afterAll(async () => {
    await db.sql.end();
    await db.container.stop();
  });

  it("pending_invites_patient_identifier_uq rejects duplicate (patient_id, identifier_hash)", async () => {
    await db.sql`INSERT INTO pending_invites (patient_id, display_name, identifier_hash)
      VALUES (${PATIENT_A}::uuid, 'Dra. A', ${IDENTIFIER_HASH_A})`;

    let raised: { code?: string } | null = null;
    try {
      await db.sql`INSERT INTO pending_invites (patient_id, display_name, identifier_hash)
        VALUES (${PATIENT_A}::uuid, 'Dra. A (dup)', ${IDENTIFIER_HASH_A})`;
    } catch (err) {
      raised = err as { code?: string };
    }
    expect(raised?.code).toBe("23505");
  });

  it("share_token_biomarkers composite PK rejects duplicate (share_token_id, biomarker_category)", async () => {
    const [invite] = await db.sql<{ id: string }[]>`
      INSERT INTO pending_invites (patient_id, display_name, identifier_hash)
      VALUES (${PATIENT_A}::uuid, 'Dra. B',
        'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb')
      RETURNING id`;
    if (!invite) throw new Error("invite insert returned no row");
    const inviteId = invite.id;
    const [token] = await db.sql<{ id: string }[]>`
      INSERT INTO share_tokens
        (token_hash, token_hmac, patient_id, invite_id, expires_at)
      VALUES (
        'hash-1', 'hmac-1', ${PATIENT_A}::uuid, ${inviteId}::uuid,
        now() + interval '7 days')
      RETURNING id`;
    if (!token) throw new Error("share_tokens insert returned no row");
    const tokenId = token.id;

    await db.sql`INSERT INTO share_token_biomarkers
      (share_token_id, biomarker_category, visible)
      VALUES (${tokenId}::uuid, 'ferritin', true)`;

    let raised: { code?: string } | null = null;
    try {
      await db.sql`INSERT INTO share_token_biomarkers
        (share_token_id, biomarker_category, visible)
        VALUES (${tokenId}::uuid, 'ferritin', false)`;
    } catch (err) {
      raised = err as { code?: string };
    }
    expect(raised?.code).toBe("23505");
  });

  it("share_tokens ON DELETE CASCADE removes share_token_biomarkers rows", async () => {
    const [invite] = await db.sql<{ id: string }[]>`
      INSERT INTO pending_invites (patient_id, display_name, identifier_hash)
      VALUES (${PATIENT_A}::uuid, 'Dra. C',
        'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc')
      RETURNING id`;
    if (!invite) throw new Error("invite insert returned no row");
    const inviteId = invite.id;
    const [token] = await db.sql<{ id: string }[]>`
      INSERT INTO share_tokens
        (token_hash, token_hmac, patient_id, invite_id, expires_at)
      VALUES (
        'hash-cascade', 'hmac-cascade', ${PATIENT_A}::uuid,
        ${inviteId}::uuid, now() + interval '7 days')
      RETURNING id`;
    if (!token) throw new Error("share_tokens insert returned no row");
    const tokenId = token.id;
    await db.sql`INSERT INTO share_token_biomarkers
      (share_token_id, biomarker_category, visible)
      VALUES (${tokenId}::uuid, 'hemoglobin', true)`;

    await db.sql`DELETE FROM share_tokens WHERE id = ${tokenId}::uuid`;

    const remaining = await db.sql<{ count: string }[]>`
      SELECT count(*)::text AS count FROM share_token_biomarkers
      WHERE share_token_id = ${tokenId}::uuid`;
    expect(remaining[0]?.count).toBe("0");
  });
});
