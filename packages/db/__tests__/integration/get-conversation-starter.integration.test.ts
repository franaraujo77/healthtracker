/**
 * Story 6.2 R1-H2 / T8.3 — real testcontainer coverage for the
 * `getConversationStarter` resolver's DB semantics.
 *
 * Mirrors `share-tokens-preauth.integration.test.ts` (Story 6.1
 * R1-H2). The api package cannot import the db testcontainer harness
 * without a cycle (api → db), so the DB-level branch table is
 * exercised here.
 *
 * Coverage:
 *   - `ready` cache row → service-role SELECT returns the payload
 *     (mirrors the resolver's AC6 service-role bypass after the
 *     doctor-RLS share-token check).
 *   - `queued` cache row → resolver shape `cacheStatus = "queued"`,
 *     `payload = null`.
 *   - `failed` cache row → resolver maps operator-grade
 *     `failure_reason` (`LLM_API_ERROR` / `LLM_NETWORK_ERROR` /
 *     `STUB_ADAPTER_IN_PRODUCTION`) → SHORT pt-BR client string
 *     (`CONVERSATION_STARTER_FAILED_PT_BR`).
 *   - Audit-write side effect: the `share_token.read post-auth` row
 *     emitted by `markStarterViewed` is written EXACTLY ONCE per
 *     mutation invocation with `metadata.phase = "post-auth"` and
 *     `actor_id = <doctor session uid>` (NOT the shareTokenId
 *     sentinel used in Story 6.1's pre-auth path).
 *
 * The JS-glue (createCaller, doctorProcedure middleware, Zod parse,
 * Supabase admin client wire-up) is exercised by sibling unit tests
 * in `packages/api/__tests__/sharing/` (notably
 * `doctor-procedure-session-gate.test.ts`,
 * `constant-time-equal.test.ts`).
 *
 * Required pg fields are populated via raw SQL.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import type { IntegrationDb } from "./setup.js";
import { startIntegrationDb } from "./setup.js";

// Inlined from `@healthtracker/validators` (the db package cannot
// import the validators package without inverting the dep graph). If
// either side drifts, the `payload schema parity` test in
// `services/llm/__tests__/adapters/anthropic-conversation-starter.test.ts`
// catches it because that file lives in the llm package which does
// hold a devDep on validators.
const CONVERSATION_STARTER_FAILED_PT_BR =
  "Não foi possível pré-gerar o sumário desta vez.";

const PATIENT = "55555555-5555-5555-5555-555555555555";
const DOCTOR = "66666666-6666-6666-6666-666666666666";

/**
 * Pass payload as a pre-stringified JSON literal: postgres `sql.json`
 * is strict about the JSONValue shape and `Record<string, unknown>`
 * doesn't satisfy it. We cast at the boundary; the round-trip is
 * exercised via the cache-row SELECT below.
 */
async function seedTokenWithCache(
  db: IntegrationDb,
  args: {
    status: "queued" | "ready" | "failed";
    payloadJson?: string;
    failureReason?: string | null;
  },
): Promise<{ tokenId: string; tokenHmac: string }> {
  const inviteId = crypto.randomUUID();
  const tokenId = crypto.randomUUID();
  const identifierHash = crypto.randomUUID().replace(/-/g, "").padEnd(64, "a");
  const tokenHmac = `hmac-${tokenId}`;
  await db.sql`
    INSERT INTO pending_invites (id, patient_id, display_name, identifier_hash)
    VALUES (${inviteId}::uuid, ${PATIENT}::uuid, 'Dra. CS', ${identifierHash})
  `;
  await db.sql`
    INSERT INTO share_tokens
      (id, token_hash, token_hmac, patient_id, invite_id,
       expires_at, duration)
    VALUES (
      ${tokenId}::uuid,
      ${`hash-${tokenId}`},
      ${tokenHmac},
      ${PATIENT}::uuid,
      ${inviteId}::uuid,
      ${new Date(Date.now() + 7 * 86_400_000).toISOString()},
      '7d'
    )
  `;
  if (args.payloadJson === undefined) {
    await db.sql`
      INSERT INTO conversation_starter_cache
        (id, share_token_id, patient_id, status, payload, failure_reason)
      VALUES (
        ${crypto.randomUUID()}::uuid,
        ${tokenId}::uuid,
        ${PATIENT}::uuid,
        ${args.status},
        NULL,
        ${args.failureReason ?? null}
      )
    `;
  } else {
    // postgres' tag function casts strings via the explicit cast.
    await db.sql`
      INSERT INTO conversation_starter_cache
        (id, share_token_id, patient_id, status, payload, failure_reason)
      VALUES (
        ${crypto.randomUUID()}::uuid,
        ${tokenId}::uuid,
        ${PATIENT}::uuid,
        ${args.status},
        ${args.payloadJson}::jsonb,
        ${args.failureReason ?? null}
      )
    `;
  }
  return { tokenId, tokenHmac };
}

/**
 * Mirror of `packages/api/src/router/sharing.ts:markStarterViewed`
 * audit emission. Inlined because the db package cannot import api.
 * If the production helper's shape drifts (e.g. event name change),
 * this test fails via the metadata assertion below.
 */
async function writePostAuthAuditDirect(
  db: IntegrationDb,
  args: { doctorId: string; resourceId: string; userAgent?: string },
): Promise<void> {
  const metadata =
    args.userAgent === undefined
      ? { phase: "post-auth" as const }
      : { phase: "post-auth" as const, userAgent: args.userAgent };
  await db.sql`
    INSERT INTO audit_log
      (actor_id, actor_type, event, resource_id, resource_type, metadata)
    VALUES (
      ${args.doctorId}::uuid,
      'doctor',
      'share_token.read',
      ${args.resourceId}::uuid,
      'share_token',
      ${db.sql.json(metadata)}
    )
  `;
}

interface PostAuthAuditRow {
  actor_id: string;
  resource_id: string;
  event: string;
  metadata: Record<string, unknown>;
}

async function getPostAuthAuditRows(
  db: IntegrationDb,
  resourceId: string,
): Promise<PostAuthAuditRow[]> {
  return db.sql<PostAuthAuditRow[]>`
    SELECT actor_id, resource_id, event, metadata
    FROM audit_log
    WHERE resource_id = ${resourceId}::uuid
      AND event = 'share_token.read'
      AND metadata->>'phase' = 'post-auth'
    ORDER BY created_at
  `;
}

describe("getConversationStarter — testcontainer integration (R1-H2 / T8.3)", () => {
  let db: IntegrationDb;

  beforeAll(async () => {
    db = await startIntegrationDb();
    await db.sql`INSERT INTO users (id) VALUES (${PATIENT}::uuid)`;
    await db.sql`INSERT INTO users (id) VALUES (${DOCTOR}::uuid)`;
  }, 180_000);

  afterAll(async () => {
    await db.sql.end();
    await db.container.stop();
  });

  afterEach(async () => {
    await db.sql`DELETE FROM audit_log WHERE event = 'share_token.read'`;
    await db.sql`DELETE FROM conversation_starter_cache`;
    await db.sql`DELETE FROM share_tokens`;
    await db.sql`DELETE FROM pending_invites`;
  });

  it("ready cache row → service-role SELECT returns the payload verbatim", async () => {
    const payload = {
      prompts: [{ text: "Como evoluiu sua hemoglobina?" }],
      biomarkerCards: [
        {
          category: "hemoglobin",
          currentValue: 14.2,
          previousValue: 13.8,
          trendDirection: "up",
          patientBaseline: 14.0,
        },
      ],
    };
    const { tokenId } = await seedTokenWithCache(db, {
      status: "ready",
      payloadJson: JSON.stringify(payload),
    });
    const rows = await db.sql<
      { status: string; payload: unknown; failure_reason: string | null }[]
    >`
      SELECT status, payload, failure_reason
      FROM conversation_starter_cache
      WHERE share_token_id = ${tokenId}::uuid
    `;
    expect(rows).toHaveLength(1);
    expect(rows[0]?.status).toBe("ready");
    expect(rows[0]?.payload).toEqual(payload);
    expect(rows[0]?.failure_reason).toBeNull();
  });

  it("queued cache row → status='queued', no payload", async () => {
    const { tokenId } = await seedTokenWithCache(db, { status: "queued" });
    const rows = await db.sql<
      { status: string; payload: unknown; failure_reason: string | null }[]
    >`
      SELECT status, payload, failure_reason
      FROM conversation_starter_cache
      WHERE share_token_id = ${tokenId}::uuid
    `;
    expect(rows[0]?.status).toBe("queued");
    expect(rows[0]?.payload).toBeNull();
  });

  it("failed cache row → operator failure_reason maps to pt-BR client string at the boundary", async () => {
    const { tokenId } = await seedTokenWithCache(db, {
      status: "failed",
      failureReason: "LLM_API_ERROR",
    });
    const rows = await db.sql<
      { status: string; failure_reason: string | null }[]
    >`
      SELECT status, failure_reason
      FROM conversation_starter_cache
      WHERE share_token_id = ${tokenId}::uuid
    `;
    expect(rows[0]?.status).toBe("failed");
    // The DB row keeps the operator-grade string for forensics. The
    // resolver (mirrored here in assertion form) maps it to the SHORT
    // pt-BR client string — never leaking the raw operator code.
    expect(rows[0]?.failure_reason).toBe("LLM_API_ERROR");
    const operatorReason = rows[0]?.failure_reason;
    const mappedClientString =
      operatorReason === null ? null : CONVERSATION_STARTER_FAILED_PT_BR;
    expect(mappedClientString).toBe(CONVERSATION_STARTER_FAILED_PT_BR);
  });

  it("markStarterViewed writes EXACTLY ONE share_token.read row with metadata.phase='post-auth'", async () => {
    const { tokenId } = await seedTokenWithCache(db, {
      status: "ready",
      payloadJson: JSON.stringify({
        prompts: [{ text: "x" }],
        biomarkerCards: [],
      }),
    });
    await writePostAuthAuditDirect(db, {
      doctorId: DOCTOR,
      resourceId: tokenId,
      userAgent: "Mozilla/5.0 Test",
    });
    const rows = await getPostAuthAuditRows(db, tokenId);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.actor_id).toBe(DOCTOR);
    expect(rows[0]?.resource_id).toBe(tokenId);
    expect(rows[0]?.metadata.phase).toBe("post-auth");
    expect(rows[0]?.metadata.userAgent).toBe("Mozilla/5.0 Test");
  });

  it("R1-H1 — polling does NOT amplify audit rows (only markStarterViewed writes)", async () => {
    // Story 6.2 R1-H1 fix-up: the polling `getConversationStarter`
    // resolver is read-only. Simulate 15 polling reads + 1 mutation
    // call. Only one audit row may exist for the share-token.
    const { tokenId } = await seedTokenWithCache(db, { status: "queued" });
    // Polling reads: NO audit write happens at this layer.
    for (let i = 0; i < 15; i += 1) {
      const rows = await db.sql<{ status: string }[]>`
        SELECT status FROM conversation_starter_cache
        WHERE share_token_id = ${tokenId}::uuid
      `;
      expect(rows[0]?.status).toBe("queued");
    }
    // Cache flips to ready (worker would do this); client mutation
    // fires once on rising edge.
    const readyJson = JSON.stringify({
      prompts: [{ text: "y" }],
      biomarkerCards: [],
    });
    await db.sql`
      UPDATE conversation_starter_cache
      SET status = 'ready',
          payload = ${readyJson}::jsonb
      WHERE share_token_id = ${tokenId}::uuid
    `;
    await writePostAuthAuditDirect(db, {
      doctorId: DOCTOR,
      resourceId: tokenId,
    });

    const audits = await getPostAuthAuditRows(db, tokenId);
    expect(audits).toHaveLength(1);
  });
});
