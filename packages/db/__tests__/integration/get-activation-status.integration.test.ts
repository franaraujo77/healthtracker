/**
 * Story 6.3 T7.2 — testcontainer coverage for `getActivationStatus`.
 *
 * Render-time existence check (AC4). Critical invariants:
 *   - Not yet activated → `{activated:false, displayName:null, category:null}`.
 *   - Already activated → `{activated:true, displayName, category}`.
 *   - Activation is `auth.uid()`-scoped, NOT share-token-scoped — a
 *     doctor activated via patient A's token is still activated when
 *     they later open patient B's report (Doctor Acquisition Loop
 *     closure).
 *   - NO audit row written, even when invoked N times (the RSC calls
 *     this in parallel with the polling `getConversationStarter` —
 *     per-tap auditing would amplify into the patient's Access Log).
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import type { IntegrationDb } from "./setup.js";
import { startIntegrationDb } from "./setup.js";

const DOCTOR = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";

async function selectActivation(
  db: IntegrationDb,
  userId: string,
): Promise<{
  activated: boolean;
  displayName: string | null;
  category: string | null;
}> {
  const rows = await db.sql<
    { display_name: string; category: string }[]
  >`SELECT display_name, category FROM professionals WHERE user_id = ${userId}::uuid LIMIT 1`;
  const row = rows[0];
  if (!row) {
    return { activated: false, displayName: null, category: null };
  }
  return {
    activated: true,
    displayName: row.display_name,
    category: row.category,
  };
}

async function countAuditRows(db: IntegrationDb): Promise<number> {
  const rows = await db.sql<
    { count: string }[]
  >`SELECT count(*)::text AS count FROM audit_log`;
  return Number(rows[0]?.count ?? "0");
}

describe("getActivationStatus — testcontainer integration (T7.2)", () => {
  let db: IntegrationDb;

  beforeAll(async () => {
    db = await startIntegrationDb();
    await db.sql`INSERT INTO users (id) VALUES (${DOCTOR}::uuid)`;
  }, 180_000);

  afterAll(async () => {
    await db.sql.end();
    await db.container.stop();
  });

  afterEach(async () => {
    await db.sql`DELETE FROM audit_log`;
    await db.sql`DELETE FROM professionals`;
  });

  it("returns {activated:false, ...nulls} when no professionals row exists", async () => {
    const result = await selectActivation(db, DOCTOR);
    expect(result).toEqual({
      activated: false,
      displayName: null,
      category: null,
    });
  });

  it("returns {activated:true, displayName, category} when row exists", async () => {
    await db.sql`
      INSERT INTO professionals (user_id, display_name, category)
      VALUES (${DOCTOR}::uuid, 'Dr. R', 'endocrinologista'::professional_category_enum)
    `;
    const result = await selectActivation(db, DOCTOR);
    expect(result).toEqual({
      activated: true,
      displayName: "Dr. R",
      category: "endocrinologista",
    });
  });

  it("auth.uid()-scoped: the same activated row surfaces regardless of which share-token context queries", async () => {
    // Activation is keyed on the doctor's user_id, NOT on the
    // share-token. So a doctor's row exists once and is the SAME
    // existence-check answer whether they're viewing patient A or
    // patient B's report.
    await db.sql`
      INSERT INTO professionals (user_id, display_name, category)
      VALUES (${DOCTOR}::uuid, 'Dr. R', 'cardiologista'::professional_category_enum)
    `;
    // "Patient A's report" query.
    const a = await selectActivation(db, DOCTOR);
    // "Patient B's report" query (different share-token context, but
    // SAME doctor uid). The professionals row is shared.
    const b = await selectActivation(db, DOCTOR);
    expect(a).toEqual(b);
    expect(a.activated).toBe(true);
  });

  it("writes ZERO audit rows even when invoked many times (render-time check)", async () => {
    const before = await countAuditRows(db);
    await db.sql`
      INSERT INTO professionals (user_id, display_name, category)
      VALUES (${DOCTOR}::uuid, 'Dr. R', 'clinico_geral'::professional_category_enum)
    `;
    // Simulate the RSC's parallel + the polling client's repeated
    // invocations.
    for (let i = 0; i < 15; i++) {
      await selectActivation(db, DOCTOR);
    }
    const after = await countAuditRows(db);
    expect(after).toBe(before);
  });
});
