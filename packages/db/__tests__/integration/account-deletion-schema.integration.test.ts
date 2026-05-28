/**
 * Story 5.6 T7.2 — testcontainer integration coverage for the new
 * `account_deletion_requests` schema:
 *   - table comes up via `drizzle-kit push --force`,
 *   - status enum rejects unknown values (22P02),
 *   - partial unique index `account_deletion_requests_active_uq`
 *     rejects a duplicate (queued|processing) row for the same
 *     patient_id,
 *   - `pseudonymize_patient_id(uuid, text)` returns the documented
 *     `'pseudonymized-' || sha256_hex` shape and matches the JS
 *     helper.
 */
import { createHash } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { IntegrationDb } from "./setup.js";
import { startIntegrationDb } from "./setup.js";

/**
 * Mirrors `services/llm/src/account-deletion.ts#pseudonymizePatientId`.
 * Inlined here so the integration suite has no cross-package import.
 */
function jsPseudonymize(patientId: string, salt: string): string {
  const hex = createHash("sha256")
    .update(patientId + salt, "utf8")
    .digest("hex");
  return `pseudonymized-${hex}`;
}

const PATIENT_A = "11111111-1111-1111-1111-111111111111";
const SALT = "test-salt-5.6";

describe("account_deletion_requests schema — Story 5.6 (testcontainer)", () => {
  let db: IntegrationDb;

  beforeAll(async () => {
    db = await startIntegrationDb();
    await db.sql`INSERT INTO users (id) VALUES (${PATIENT_A}::uuid)`;
  }, 180_000);

  afterAll(async () => {
    await db.sql.end();
    await db.container.stop();
  });

  it("accepts a queued row + defaults requested_at to now()", async () => {
    const [row] = await db.sql<{ id: string; requested_at: Date }[]>`
      INSERT INTO account_deletion_requests (patient_id)
      VALUES (${PATIENT_A}::uuid)
      RETURNING id, requested_at
    `;
    expect(row).toBeDefined();
    if (!row) throw new Error("row missing");
    // Within 5s of now.
    expect(Math.abs(row.requested_at.getTime() - Date.now())).toBeLessThan(
      5_000,
    );
  });

  it("rejects bogus status via pgEnum (22P02)", async () => {
    let raised: { code?: string } | null = null;
    try {
      await db.sql`
        INSERT INTO account_deletion_requests (patient_id, status)
        VALUES (${PATIENT_A}::uuid, 'in_progress')
      `;
    } catch (err) {
      raised = err as { code?: string };
    }
    expect(raised?.code).toBe("22P02");
  });

  it("partial unique index rejects a second active row per patient (23505)", async () => {
    const tempPatient = "44444444-4444-4444-4444-444444444444";
    await db.sql`INSERT INTO users (id) VALUES (${tempPatient}::uuid)`;
    await db.sql`
      INSERT INTO account_deletion_requests (patient_id, status)
      VALUES (${tempPatient}::uuid, 'queued')
    `;
    let raised: { code?: string } | null = null;
    try {
      await db.sql`
        INSERT INTO account_deletion_requests (patient_id, status)
        VALUES (${tempPatient}::uuid, 'processing')
      `;
    } catch (err) {
      raised = err as { code?: string };
    }
    expect(raised?.code).toBe("23505");
  });

  it("ledger row survives DELETE FROM users (no FK by design)", async () => {
    const tempPatient = "55555555-5555-5555-5555-555555555555";
    await db.sql`INSERT INTO users (id) VALUES (${tempPatient}::uuid)`;
    await db.sql`
      INSERT INTO account_deletion_requests (patient_id, status)
      VALUES (${tempPatient}::uuid, 'complete')
    `;
    await db.sql`DELETE FROM users WHERE id = ${tempPatient}::uuid`;
    const remaining = await db.sql<{ count: string }[]>`
      SELECT count(*)::text AS count
      FROM account_deletion_requests
      WHERE patient_id = ${tempPatient}::uuid
    `;
    // Spec invariant: the ledger row outlives the user.
    expect(remaining[0]?.count).toBe("1");
  });

  it("pseudonymize_patient_id matches the JS helper shape", async () => {
    const [row] = await db.sql<{ out: string }[]>`
      SELECT pseudonymize_patient_id(${PATIENT_A}::uuid, ${SALT}) AS out
    `;
    expect(row?.out).toMatch(/^pseudonymized-[0-9a-f]{64}$/);
    // Round-trip with the JS helper (mirrored above for no
    // cross-package import).
    expect(row?.out).toBe(jsPseudonymize(PATIENT_A, SALT));
  });
});
