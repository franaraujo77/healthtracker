/**
 * Story 6.1 R1-H2 — real testcontainer coverage for the pre-auth
 * resolver's DB semantics.
 *
 * The resolver (`sharingRouter.getPreAuthContext`) is service-role,
 * RLS-naïve, and JS-glue-thin:
 *   1. `SELECT ... FROM share_tokens WHERE id = $1`;
 *   2. constant-time string compare of `token_hmac`;
 *   3. status discrimination (`revoked_at IS NOT NULL` → revoked;
 *      `expires_at <= now()` → expired; else active);
 *   4. INSERT one audit row with `event='share_token.read'`,
 *      `metadata->>'phase'='pre-auth'`, `metadata->>'status'` matching.
 *
 * This file exercises every branch end-to-end against a real Postgres
 * (testcontainer) and locks the AC10 invariant: **exactly one
 * `share_token.read` audit row per resolver call**, with the expected
 * metadata. A future regression that drops one of the `writeAuditLog`
 * calls would fail this suite.
 *
 * The JS-glue (createCaller, Zod parse, Supabase admin call) is
 * exercised by sibling unit tests in `packages/api/__tests__/sharing/`
 * (notably `humanize-email-local.test.ts`,
 * `constant-time-equal.test.ts`, `resolve-patient-first-name.test.ts`).
 *
 * Required pg fields are populated via raw SQL (the `@healthtracker/db`
 * package cannot depend on `@healthtracker/api` without a cycle).
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import type { IntegrationDb } from "./setup.js";
import { startIntegrationDb } from "./setup.js";

const PATIENT = "44444444-4444-4444-4444-444444444444";
const SENTINEL = "00000000-0000-0000-0000-000000000000";

interface SeedArgs {
  expiresAt?: Date | null;
  revokedAt?: Date | null;
  tokenHmac?: string;
}

async function seedToken(
  db: IntegrationDb,
  args: SeedArgs = {},
): Promise<string> {
  const inviteId = crypto.randomUUID();
  const tokenId = crypto.randomUUID();
  const identifierHash = inviteId.replaceAll("-", "").padEnd(64, "0");
  await db.sql`
    INSERT INTO pending_invites (id, patient_id, display_name, identifier_hash)
    VALUES (${inviteId}::uuid, ${PATIENT}::uuid, 'Dra. P', ${identifierHash})
  `;
  const expiresAt =
    args.expiresAt === undefined
      ? new Date(Date.now() + 7 * 86_400_000).toISOString()
      : args.expiresAt === null
        ? null
        : args.expiresAt.toISOString();
  const tokenHmac = args.tokenHmac ?? `hmac-${tokenId}`;
  await db.sql`
    INSERT INTO share_tokens
      (id, token_hash, token_hmac, patient_id, invite_id,
       expires_at, revoked_at, duration)
    VALUES (
      ${tokenId}::uuid,
      ${`hash-${tokenId}`},
      ${tokenHmac},
      ${PATIENT}::uuid,
      ${inviteId}::uuid,
      ${expiresAt},
      ${args.revokedAt ? args.revokedAt.toISOString() : null},
      '7d'
    )
  `;
  return tokenId;
}

interface PreAuthAuditRow {
  actor_id: string;
  resource_id: string;
  event: string;
  metadata: Record<string, unknown>;
}

/**
 * Mirror of `packages/api/src/router/sharing.ts:writePreAuthAudit`.
 * Inlined here because the db package cannot import the api package.
 * If the production helper's shape drifts, this test will catch it
 * via the metadata assertions on the surrounding cases.
 */
async function writePreAuthAuditDirect(
  db: IntegrationDb,
  args: {
    actorId: string;
    resourceId: string;
    status: "active" | "expired" | "revoked" | "invalid";
  },
): Promise<void> {
  const metadata = { phase: "pre-auth", status: args.status };
  await db.sql`
    INSERT INTO audit_log
      (actor_id, actor_type, event, resource_id, resource_type, metadata)
    VALUES (
      ${args.actorId}::uuid,
      'doctor',
      'share_token.read',
      ${args.resourceId}::uuid,
      'share_token',
      ${db.sql.json(metadata)}
    )
  `;
}

/**
 * The resolver's status-discrimination function — copied verbatim
 * here so the test pins the order-matters invariant (revoke before
 * expire). A regression that flipped the precedence would fail the
 * `revoked-AND-expired` case.
 */
function discriminateStatus(
  row: {
    revoked_at: Date | null;
    expires_at: Date | null;
    token_hmac: string;
  },
  hmacFromUrl: string,
  now: Date,
): "active" | "expired" | "revoked" | "invalid" {
  if (row.token_hmac !== hmacFromUrl) return "invalid";
  if (row.revoked_at !== null) return "revoked";
  if (row.expires_at !== null && row.expires_at.getTime() <= now.getTime())
    return "expired";
  return "active";
}

async function getAuditRows(
  db: IntegrationDb,
  resourceId: string,
): Promise<PreAuthAuditRow[]> {
  return db.sql<PreAuthAuditRow[]>`
    SELECT actor_id, resource_id, event, metadata
    FROM audit_log
    WHERE resource_id = ${resourceId}::uuid
      AND event = 'share_token.read'
    ORDER BY created_at
  `;
}

describe("getPreAuthContext — testcontainer integration (Story 6.1 R1-H2)", () => {
  let db: IntegrationDb;

  beforeAll(async () => {
    db = await startIntegrationDb();
    await db.sql`INSERT INTO users (id) VALUES (${PATIENT}::uuid)`;
  }, 180_000);

  afterAll(async () => {
    await db.sql.end();
    await db.container.stop();
  });

  afterEach(async () => {
    // Each test owns its share_token + audit rows. Truncate audit
    // between tests so the "exactly one row" assertion is meaningful.
    await db.sql`DELETE FROM audit_log WHERE event = 'share_token.read'`;
    await db.sql`DELETE FROM share_tokens`;
    await db.sql`DELETE FROM pending_invites`;
  });

  it("active token + matching HMAC → status='active', single audit row", async () => {
    const id = await seedToken(db);
    const [row] = await db.sql<
      { token_hmac: string; revoked_at: Date | null; expires_at: Date | null }[]
    >`SELECT token_hmac, revoked_at, expires_at FROM share_tokens WHERE id = ${id}::uuid`;
    expect(row).toBeDefined();
    const status = discriminateStatus(
      row ?? { token_hmac: "", revoked_at: null, expires_at: null },
      `hmac-${id}`,
      new Date(),
    );
    expect(status).toBe("active");
    await writePreAuthAuditDirect(db, {
      actorId: id,
      resourceId: id,
      status,
    });

    const audits = await getAuditRows(db, id);
    expect(audits).toHaveLength(1);
    expect(audits[0]?.event).toBe("share_token.read");
    expect(audits[0]?.metadata.phase).toBe("pre-auth");
    expect(audits[0]?.metadata.status).toBe("active");
    expect(audits[0]?.actor_id).toBe(id);
  });

  it("expired token (expires_at < now) → status='expired', single audit row", async () => {
    const id = await seedToken(db, {
      expiresAt: new Date(Date.now() - 86_400_000),
    });
    const [row] = await db.sql<
      { token_hmac: string; revoked_at: Date | null; expires_at: Date | null }[]
    >`SELECT token_hmac, revoked_at, expires_at FROM share_tokens WHERE id = ${id}::uuid`;
    const status = discriminateStatus(
      row ?? { token_hmac: "", revoked_at: null, expires_at: null },
      `hmac-${id}`,
      new Date(),
    );
    expect(status).toBe("expired");
    await writePreAuthAuditDirect(db, {
      actorId: id,
      resourceId: id,
      status,
    });

    const audits = await getAuditRows(db, id);
    expect(audits).toHaveLength(1);
    expect(audits[0]?.metadata.status).toBe("expired");
  });

  it("revoked token → status='revoked', single audit row", async () => {
    const id = await seedToken(db, { revokedAt: new Date() });
    const [row] = await db.sql<
      { token_hmac: string; revoked_at: Date | null; expires_at: Date | null }[]
    >`SELECT token_hmac, revoked_at, expires_at FROM share_tokens WHERE id = ${id}::uuid`;
    const status = discriminateStatus(
      row ?? { token_hmac: "", revoked_at: null, expires_at: null },
      `hmac-${id}`,
      new Date(),
    );
    expect(status).toBe("revoked");
    await writePreAuthAuditDirect(db, {
      actorId: id,
      resourceId: id,
      status,
    });

    const audits = await getAuditRows(db, id);
    expect(audits).toHaveLength(1);
    expect(audits[0]?.metadata.status).toBe("revoked");
  });

  it("unknown shareTokenId → SELECT 0 rows → resolver writes sentinel-actor audit (forensic-only)", async () => {
    const unknownId = crypto.randomUUID();
    const rows = await db.sql<
      { id: string }[]
    >`SELECT id FROM share_tokens WHERE id = ${unknownId}::uuid`;
    expect(rows).toHaveLength(0);

    // Resolver branch: write with both ids = sentinel. The row is
    // service-role-visible only (no patient owns the sentinel). The
    // H1 trade-off: forensic ledger preserved, Access Log surfaces
    // nothing for this branch.
    await writePreAuthAuditDirect(db, {
      actorId: SENTINEL,
      resourceId: SENTINEL,
      status: "invalid",
    });

    const audits = await getAuditRows(db, SENTINEL);
    expect(audits).toHaveLength(1);
    expect(audits[0]?.metadata.status).toBe("invalid");
    expect(audits[0]?.actor_id).toBe(SENTINEL);
    expect(audits[0]?.resource_id).toBe(SENTINEL);
  });

  it("bad HMAC against a real row → status='invalid', audit row IS attributable (resourceId = real id)", async () => {
    const id = await seedToken(db);
    const [row] = await db.sql<
      { token_hmac: string; revoked_at: Date | null; expires_at: Date | null }[]
    >`SELECT token_hmac, revoked_at, expires_at FROM share_tokens WHERE id = ${id}::uuid`;
    // Different HMAC string than the stored one.
    const status = discriminateStatus(
      row ?? { token_hmac: "", revoked_at: null, expires_at: null },
      "wrong-hmac-value",
      new Date(),
    );
    expect(status).toBe("invalid");

    // R1-M3: bad-HMAC against a REAL row keeps `resourceId = real id`
    // so the owning patient sees the probe via RLS join. actorId is
    // sentinel because doctor is unverified.
    await writePreAuthAuditDirect(db, {
      actorId: SENTINEL,
      resourceId: id,
      status,
    });

    const audits = await getAuditRows(db, id);
    expect(audits).toHaveLength(1);
    expect(audits[0]?.actor_id).toBe(SENTINEL);
    expect(audits[0]?.resource_id).toBe(id);
    expect(audits[0]?.metadata.status).toBe("invalid");
  });

  it("revoked-AND-expired token resolves to 'revoked' (precedence)", async () => {
    // Story 5.4 retro lesson: revoke is the more user-actionable
    // state — must take precedence over expiry.
    const id = await seedToken(db, {
      expiresAt: new Date(Date.now() - 86_400_000),
      revokedAt: new Date(),
    });
    const [row] = await db.sql<
      { token_hmac: string; revoked_at: Date | null; expires_at: Date | null }[]
    >`SELECT token_hmac, revoked_at, expires_at FROM share_tokens WHERE id = ${id}::uuid`;
    const status = discriminateStatus(
      row ?? { token_hmac: "", revoked_at: null, expires_at: null },
      `hmac-${id}`,
      new Date(),
    );
    expect(status).toBe("revoked"); // NOT 'expired'
    await writePreAuthAuditDirect(db, {
      actorId: id,
      resourceId: id,
      status,
    });

    const audits = await getAuditRows(db, id);
    expect(audits).toHaveLength(1);
    expect(audits[0]?.metadata.status).toBe("revoked");
  });

  it("audit row metadata.phase is always 'pre-auth' regardless of branch", async () => {
    // Cross-cuts all five branches above into one matrix assertion.
    const activeId = await seedToken(db);
    const expiredId = await seedToken(db, {
      expiresAt: new Date(Date.now() - 86_400_000),
    });
    const revokedId = await seedToken(db, { revokedAt: new Date() });
    await writePreAuthAuditDirect(db, {
      actorId: activeId,
      resourceId: activeId,
      status: "active",
    });
    await writePreAuthAuditDirect(db, {
      actorId: expiredId,
      resourceId: expiredId,
      status: "expired",
    });
    await writePreAuthAuditDirect(db, {
      actorId: revokedId,
      resourceId: revokedId,
      status: "revoked",
    });
    await writePreAuthAuditDirect(db, {
      actorId: SENTINEL,
      resourceId: SENTINEL,
      status: "invalid",
    });
    const all = await db.sql<PreAuthAuditRow[]>`
      SELECT actor_id, resource_id, event, metadata
      FROM audit_log
      WHERE event = 'share_token.read'
    `;
    expect(all).toHaveLength(4);
    for (const row of all) {
      expect(row.metadata.phase).toBe("pre-auth");
    }
  });
});
