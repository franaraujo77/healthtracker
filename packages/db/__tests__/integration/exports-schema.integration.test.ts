/**
 * Story 5.5 T1.6 — testcontainer integration coverage for the new
 * `exports` schema:
 *   - table comes up via `drizzle-kit push --force`,
 *   - format / status enums reject unknown values (22P02),
 *   - ON DELETE CASCADE from `users(id)` removes export rows.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { IntegrationDb } from "./setup.js";
import { startIntegrationDb } from "./setup.js";

const PATIENT_A = "22222222-2222-2222-2222-222222222222";

describe("exports schema — Story 5.5 (testcontainer)", () => {
  let db: IntegrationDb;

  beforeAll(async () => {
    db = await startIntegrationDb();
    await db.sql`INSERT INTO users (id) VALUES (${PATIENT_A}::uuid)`;
  }, 180_000);

  afterAll(async () => {
    await db.sql.end();
    await db.container.stop();
  });

  it("accepts a queued JSON export and defaults expires_at to now()+24h", async () => {
    const [row] = await db.sql<{ id: string; expires_at: Date }[]>`
      INSERT INTO exports (patient_id, format)
      VALUES (${PATIENT_A}::uuid, 'json')
      RETURNING id, expires_at
    `;
    expect(row).toBeDefined();
    if (!row) throw new Error("row missing");
    const diffMs = row.expires_at.getTime() - Date.now();
    // Allow ±5s drift; should be ~24h.
    const TWENTY_FOUR_HOURS = 24 * 60 * 60 * 1000;
    expect(diffMs).toBeGreaterThan(TWENTY_FOUR_HOURS - 5_000);
    expect(diffMs).toBeLessThan(TWENTY_FOUR_HOURS + 5_000);
  });

  it("rejects bogus format via pgEnum (22P02)", async () => {
    let raised: { code?: string } | null = null;
    try {
      await db.sql`INSERT INTO exports (patient_id, format) VALUES (${PATIENT_A}::uuid, 'csv')`;
    } catch (err) {
      raised = err as { code?: string };
    }
    // 22P02 = invalid_text_representation (unknown enum value)
    expect(raised?.code).toBe("22P02");
  });

  it("rejects bogus status via pgEnum (22P02)", async () => {
    let raised: { code?: string } | null = null;
    try {
      await db.sql`INSERT INTO exports (patient_id, format, status) VALUES (${PATIENT_A}::uuid, 'json', 'in_progress')`;
    } catch (err) {
      raised = err as { code?: string };
    }
    expect(raised?.code).toBe("22P02");
  });

  it("ON DELETE CASCADE from users removes export rows", async () => {
    const tempPatient = "33333333-3333-3333-3333-333333333333";
    await db.sql`INSERT INTO users (id) VALUES (${tempPatient}::uuid)`;
    await db.sql`INSERT INTO exports (patient_id, format) VALUES (${tempPatient}::uuid, 'pdf')`;
    await db.sql`DELETE FROM users WHERE id = ${tempPatient}::uuid`;
    const remaining = await db.sql<{ count: string }[]>`
      SELECT count(*)::text AS count FROM exports WHERE patient_id = ${tempPatient}::uuid
    `;
    expect(remaining[0]?.count).toBe("0");
  });
});
