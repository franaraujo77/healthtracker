/**
 * Story 5.6 T7.3 — RLS for `account_deletion_requests`.
 *
 * 3-identity matrix (no doctor-principal — deletion is strictly
 * patient-only by ADR):
 *   - correctPatient sees own pre-deletion row
 *   - wrongPatient sees zero
 *   - serviceRole sees all (worker bypass)
 *
 * Requires: `supabase start` + applied
 * `custom_rls_account_deletion_requests.sql`.
 */
import { afterEach, describe, expect, it } from "vitest";

import { asIdentity } from "./helpers";
import { serviceClient } from "./setup";

const seededIds: string[] = [];

async function seedRequest(patientId: string): Promise<string> {
  const id = crypto.randomUUID();
  const { error } = await serviceClient
    .from("account_deletion_requests")
    .insert({ id, patient_id: patientId, status: "queued" });
  if (error) {
    throw new Error(`seed failed: ${error.message}`);
  }
  seededIds.push(id);
  return id;
}

afterEach(async () => {
  if (seededIds.length > 0) {
    await serviceClient
      .from("account_deletion_requests")
      .delete()
      .in("id", seededIds);
    seededIds.length = 0;
  }
});

describe("account_deletion_requests RLS", () => {
  it("correctPatient sees own pre-deletion row", async () => {
    const patientId = crypto.randomUUID();
    const id = await seedRequest(patientId);
    const run = asIdentity("correctPatient", { patientId });
    const rows = await run(
      (tx) => tx<{ id: string }[]>`
        SELECT id FROM account_deletion_requests
        WHERE patient_id = ${patientId}::uuid
      `,
    );
    expect(rows.map((r) => r.id)).toContain(id);
  });

  it("wrongPatient sees zero rows for another patient", async () => {
    const patientId = crypto.randomUUID();
    const otherPatientId = crypto.randomUUID();
    await seedRequest(patientId);
    const run = asIdentity("wrongPatient", { patientId, otherPatientId });
    const rows = await run(
      (tx) => tx<{ id: string }[]>`
        SELECT id FROM account_deletion_requests
        WHERE patient_id = ${patientId}::uuid
      `,
    );
    expect(rows).toHaveLength(0);
  });

  it("serviceRole sees all rows (worker bypass)", async () => {
    const patientId = crypto.randomUUID();
    await seedRequest(patientId);
    const { data, error } = await serviceClient
      .from("account_deletion_requests")
      .select("id")
      .eq("patient_id", patientId);
    expect(error).toBeNull();
    expect(data?.length).toBe(1);
  });
});
