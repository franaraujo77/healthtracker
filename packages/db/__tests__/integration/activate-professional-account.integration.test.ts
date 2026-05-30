/**
 * Story 6.3 T7.1 — testcontainer coverage for
 * `activateProfessionalAccount`'s DB semantics.
 *
 * The db package cannot import the api package without inverting
 * the dep graph; we exercise the DB-level branch table by mirroring
 * the resolver's SQL in raw template-literal form. The JS-glue
 * (createCaller, doctorProcedure middleware, Zod parse, HMAC check)
 * is covered by sibling unit tests in `packages/api/__tests__/sharing/`.
 *
 * Coverage:
 *   - Happy path: fresh activation flips `pending_invites.resolved_user_id`,
 *     inserts `professionals`, emits exactly one
 *     `professional_account.activated` audit row.
 *   - Idempotent re-tap (same doctor uid, same invite): one row, one
 *     audit row, no duplicate INSERT.
 *   - Cross-doctor CONFLICT: doctor A activates, doctor B with a
 *     different uid hitting the same invite → resolved_user_id stays
 *     A's, no professionals row for B, no extra audit row.
 *   - No additive audit on re-tap (R1-H1 lesson from Story 6.2).
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import type { IntegrationDb } from "./setup.js";
import { startIntegrationDb } from "./setup.js";

const PATIENT = "77777777-7777-7777-7777-777777777777";
const DOCTOR_A = "88888888-8888-8888-8888-888888888888";
const DOCTOR_B = "99999999-9999-9999-9999-999999999999";

async function seedInviteAndToken(db: IntegrationDb): Promise<{
  inviteId: string;
  shareTokenId: string;
}> {
  const inviteId = crypto.randomUUID();
  const shareTokenId = crypto.randomUUID();
  const identifierHash = crypto.randomUUID().replace(/-/g, "").padEnd(64, "a");
  await db.sql`
    INSERT INTO pending_invites (id, patient_id, display_name, identifier_hash)
    VALUES (${inviteId}::uuid, ${PATIENT}::uuid, 'Dra. Activate', ${identifierHash})
  `;
  await db.sql`
    INSERT INTO share_tokens
      (id, token_hash, token_hmac, patient_id, invite_id,
       expires_at, duration)
    VALUES (
      ${shareTokenId}::uuid,
      ${`hash-${shareTokenId}`},
      ${`hmac-${shareTokenId}`},
      ${PATIENT}::uuid,
      ${inviteId}::uuid,
      ${new Date(Date.now() + 7 * 86_400_000).toISOString()},
      '7d'
    )
  `;
  return { inviteId, shareTokenId };
}

/**
 * Mirror of `sharingRouter.activateProfessionalAccount` — inlined per
 * the get-conversation-starter precedent. Returns the same shape the
 * resolver returns, or throws an `Error` with `.code` set on the
 * branch the resolver would throw a `TRPCError` (CONFLICT / NOT_FOUND).
 */
async function activateInline(
  db: IntegrationDb,
  args: {
    doctorUserId: string;
    shareTokenId: string;
    displayName: string;
    category: string;
  },
): Promise<{
  displayName: string;
  category: string;
  alreadyActivated: boolean;
}> {
  // Steps 1+2 (RLS-bound SELECT + HMAC) are sibling unit-test
  // territory; here we go straight to the FOR UPDATE + branch + INSERT.
  return db.sql.begin(async (tx) => {
    const tokenRows = await tx<
      { id: string; invite_id: string }[]
    >`SELECT id, invite_id FROM share_tokens WHERE id = ${args.shareTokenId}::uuid`;
    const tokenRow = tokenRows[0];
    if (!tokenRow) {
      const err = new Error("NOT_FOUND");
      (err as Error & { code: string }).code = "NOT_FOUND";
      throw err;
    }
    const inviteRows = await tx<
      { id: string; resolved_user_id: string | null }[]
    >`
      SELECT id, resolved_user_id
      FROM pending_invites
      WHERE id = ${tokenRow.invite_id}::uuid
      FOR UPDATE
    `;
    const inviteRow = inviteRows[0];
    if (!inviteRow) {
      const err = new Error("NOT_FOUND");
      (err as Error & { code: string }).code = "NOT_FOUND";
      throw err;
    }
    if (inviteRow.resolved_user_id === null) {
      await tx`
        UPDATE pending_invites
        SET resolved_user_id = ${args.doctorUserId}::uuid
        WHERE id = ${tokenRow.invite_id}::uuid
          AND resolved_user_id IS NULL
      `;
    } else if (inviteRow.resolved_user_id !== args.doctorUserId) {
      const err = new Error("INVITE_ALREADY_CLAIMED_BY_DIFFERENT_DOCTOR");
      (err as Error & { code: string }).code = "CONFLICT";
      throw err;
    }
    const inserted = await tx<
      { user_id: string; display_name: string; category: string }[]
    >`
      INSERT INTO professionals (user_id, display_name, category)
      VALUES (${args.doctorUserId}::uuid, ${args.displayName}, ${args.category}::professional_category_enum)
      ON CONFLICT (user_id) DO NOTHING
      RETURNING user_id, display_name, category
    `;
    let displayName: string;
    let category: string;
    let alreadyActivated: boolean;
    if (inserted[0]) {
      displayName = inserted[0].display_name;
      category = inserted[0].category;
      alreadyActivated = false;
    } else {
      const existing = await tx<
        { display_name: string; category: string }[]
      >`SELECT display_name, category FROM professionals WHERE user_id = ${args.doctorUserId}::uuid`;
      const row = existing[0];
      if (!row) {
        throw new Error("row vanished mid-tx");
      }
      displayName = row.display_name;
      category = row.category;
      alreadyActivated = true;
    }
    if (!alreadyActivated) {
      await tx`
        INSERT INTO audit_log
          (actor_id, actor_type, event, resource_id, resource_type, metadata)
        VALUES (
          ${args.doctorUserId}::uuid,
          'doctor',
          'professional_account.activated',
          ${args.doctorUserId}::uuid,
          'professional',
          ${tx.json({
            shareTokenId: args.shareTokenId,
            inviteId: tokenRow.invite_id,
            category: args.category,
          })}
        )
      `;
    }
    return { displayName, category, alreadyActivated };
  });
}

describe("activateProfessionalAccount — testcontainer integration (T7.1)", () => {
  let db: IntegrationDb;

  beforeAll(async () => {
    db = await startIntegrationDb();
    await db.sql`INSERT INTO users (id) VALUES (${PATIENT}::uuid)`;
    await db.sql`INSERT INTO users (id) VALUES (${DOCTOR_A}::uuid)`;
    await db.sql`INSERT INTO users (id) VALUES (${DOCTOR_B}::uuid)`;
  }, 180_000);

  afterAll(async () => {
    await db.sql.end();
    await db.container.stop();
  });

  afterEach(async () => {
    await db.sql`DELETE FROM audit_log WHERE event = 'professional_account.activated'`;
    await db.sql`DELETE FROM professionals`;
    await db.sql`DELETE FROM share_tokens`;
    await db.sql`DELETE FROM pending_invites`;
  });

  it("happy path — fresh activation flips resolved_user_id, INSERTs professionals, emits ONE audit row", async () => {
    const { inviteId, shareTokenId } = await seedInviteAndToken(db);
    const result = await activateInline(db, {
      doctorUserId: DOCTOR_A,
      shareTokenId,
      displayName: "Dr. Rodrigo",
      category: "cardiologista",
    });
    expect(result).toEqual({
      displayName: "Dr. Rodrigo",
      category: "cardiologista",
      alreadyActivated: false,
    });
    const invites = await db.sql<
      { resolved_user_id: string | null }[]
    >`SELECT resolved_user_id FROM pending_invites WHERE id = ${inviteId}::uuid`;
    expect(invites[0]?.resolved_user_id).toBe(DOCTOR_A);
    const profs = await db.sql<
      { user_id: string; display_name: string }[]
    >`SELECT user_id, display_name FROM professionals WHERE user_id = ${DOCTOR_A}::uuid`;
    expect(profs).toHaveLength(1);
    expect(profs[0]?.display_name).toBe("Dr. Rodrigo");
    const audits = await db.sql<
      { actor_id: string; metadata: Record<string, unknown> }[]
    >`SELECT actor_id, metadata FROM audit_log WHERE event = 'professional_account.activated'`;
    expect(audits).toHaveLength(1);
    expect(audits[0]?.actor_id).toBe(DOCTOR_A);
    expect(audits[0]?.metadata).toMatchObject({
      shareTokenId,
      inviteId,
      category: "cardiologista",
    });
  });

  it("idempotent re-tap — same doctor activates twice → ONE professionals row, ONE audit row, alreadyActivated:true on 2nd", async () => {
    const { shareTokenId } = await seedInviteAndToken(db);
    const first = await activateInline(db, {
      doctorUserId: DOCTOR_A,
      shareTokenId,
      displayName: "Dr. Rodrigo",
      category: "cardiologista",
    });
    expect(first.alreadyActivated).toBe(false);
    const second = await activateInline(db, {
      doctorUserId: DOCTOR_A,
      shareTokenId,
      displayName: "Dr. Rodrigo (edited)",
      category: "endocrinologista",
    });
    // Existing row's fields are returned (idempotent — display_name
    // / category from the second call are NOT applied).
    expect(second.alreadyActivated).toBe(true);
    expect(second.displayName).toBe("Dr. Rodrigo");
    expect(second.category).toBe("cardiologista");
    const profs = await db.sql<
      { user_id: string }[]
    >`SELECT user_id FROM professionals WHERE user_id = ${DOCTOR_A}::uuid`;
    expect(profs).toHaveLength(1);
    const audits = await db.sql<
      { actor_id: string }[]
    >`SELECT actor_id FROM audit_log WHERE event = 'professional_account.activated'`;
    // R1-H1 — exactly ONE row across both calls (re-tap is silent).
    expect(audits).toHaveLength(1);
  });

  it("cross-doctor CONFLICT — doctor A activates, doctor B different uid → CONFLICT, no B row, no extra audit", async () => {
    const { inviteId, shareTokenId } = await seedInviteAndToken(db);
    await activateInline(db, {
      doctorUserId: DOCTOR_A,
      shareTokenId,
      displayName: "Dr. A",
      category: "cardiologista",
    });
    await expect(
      activateInline(db, {
        doctorUserId: DOCTOR_B,
        shareTokenId,
        displayName: "Dr. B",
        category: "endocrinologista",
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    // resolved_user_id MUST still be A's uid.
    const invites = await db.sql<
      { resolved_user_id: string | null }[]
    >`SELECT resolved_user_id FROM pending_invites WHERE id = ${inviteId}::uuid`;
    expect(invites[0]?.resolved_user_id).toBe(DOCTOR_A);
    // No professionals row for B.
    const bRow = await db.sql<
      { user_id: string }[]
    >`SELECT user_id FROM professionals WHERE user_id = ${DOCTOR_B}::uuid`;
    expect(bRow).toHaveLength(0);
    // Exactly ONE audit row (A's).
    const audits = await db.sql<
      { actor_id: string }[]
    >`SELECT actor_id FROM audit_log WHERE event = 'professional_account.activated'`;
    expect(audits).toHaveLength(1);
    expect(audits[0]?.actor_id).toBe(DOCTOR_A);
  });
});
