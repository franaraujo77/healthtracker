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

  // Story 5.2 T1.4 — `expires_at` is nullable; the "Sem prazo" branch
  // INSERTs NULL.
  it("share_tokens accepts NULL expires_at (Story 5.2 — Sem prazo)", async () => {
    const [invite] = await db.sql<{ id: string }[]>`
      INSERT INTO pending_invites (patient_id, display_name, identifier_hash)
      VALUES (${PATIENT_A}::uuid, 'Dra. NoExp',
        'dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd')
      RETURNING id`;
    if (!invite) throw new Error("invite insert returned no row");
    const inviteId = invite.id;
    const [token] = await db.sql<{ id: string; expires_at: Date | null }[]>`
      INSERT INTO share_tokens
        (token_hash, token_hmac, patient_id, invite_id, expires_at)
      VALUES (
        'hash-noexp', 'hmac-noexp', ${PATIENT_A}::uuid,
        ${inviteId}::uuid, NULL)
      RETURNING id, expires_at`;
    expect(token?.expires_at).toBeNull();
  });

  // Story 5.2 T1.4 — `conversation_starter_cache.status` check
  // constraint rejects values outside the closed set.
  it("conversation_starter_cache rejects status outside ('queued','ready','failed')", async () => {
    const [invite] = await db.sql<{ id: string }[]>`
      INSERT INTO pending_invites (patient_id, display_name, identifier_hash)
      VALUES (${PATIENT_A}::uuid, 'Dra. CS',
        'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee')
      RETURNING id`;
    if (!invite) throw new Error("invite insert returned no row");
    const [token] = await db.sql<{ id: string }[]>`
      INSERT INTO share_tokens
        (token_hash, token_hmac, patient_id, invite_id, expires_at)
      VALUES ('hash-cs1', 'hmac-cs1', ${PATIENT_A}::uuid,
        ${invite.id}::uuid, NULL)
      RETURNING id`;
    if (!token) throw new Error("share_tokens insert returned no row");

    let raised: { code?: string } | null = null;
    try {
      await db.sql`INSERT INTO conversation_starter_cache
        (share_token_id, patient_id, status)
        VALUES (${token.id}::uuid, ${PATIENT_A}::uuid, 'bogus')`;
    } catch (err) {
      raised = err as { code?: string };
    }
    // 23514 = check_violation
    expect(raised?.code).toBe("23514");
  });

  // Story 5.2 T1.4 — ON DELETE CASCADE from share_tokens reaches
  // conversation_starter_cache.
  it("conversation_starter_cache cascades on share_tokens DELETE", async () => {
    const [invite] = await db.sql<{ id: string }[]>`
      INSERT INTO pending_invites (patient_id, display_name, identifier_hash)
      VALUES (${PATIENT_A}::uuid, 'Dra. CS2',
        'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff')
      RETURNING id`;
    if (!invite) throw new Error("invite insert returned no row");
    const [token] = await db.sql<{ id: string }[]>`
      INSERT INTO share_tokens
        (token_hash, token_hmac, patient_id, invite_id, expires_at)
      VALUES ('hash-cs2', 'hmac-cs2', ${PATIENT_A}::uuid,
        ${invite.id}::uuid, now() + interval '7 days')
      RETURNING id`;
    if (!token) throw new Error("share_tokens insert returned no row");
    await db.sql`INSERT INTO conversation_starter_cache
      (share_token_id, patient_id, status)
      VALUES (${token.id}::uuid, ${PATIENT_A}::uuid, 'queued')`;

    await db.sql`DELETE FROM share_tokens WHERE id = ${token.id}::uuid`;
    const remaining = await db.sql<{ count: string }[]>`
      SELECT count(*)::text AS count FROM conversation_starter_cache
      WHERE share_token_id = ${token.id}::uuid`;
    expect(remaining[0]?.count).toBe("0");
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
