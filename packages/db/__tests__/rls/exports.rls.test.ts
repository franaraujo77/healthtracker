/**
 * Story 5.5 T1.7 — RLS for `exports`.
 *
 * 3-identity matrix (no doctor-principal — exports are patient-only
 * by ADR):
 *   - correctPatient sees own
 *   - wrongPatient sees zero
 *   - serviceRole sees all
 *
 * Requires: `supabase start` + applied `custom_rls_exports.sql`.
 */
import { afterEach, describe, expect, it } from "vitest";

import { asIdentity } from "./helpers";
import { serviceClient } from "./setup";

const seededExportIds: string[] = [];

async function seedExport(patientId: string): Promise<string> {
  const exportId = crypto.randomUUID();
  const { error } = await serviceClient.from("exports").insert({
    id: exportId,
    patient_id: patientId,
    format: "json",
  });
  if (error) throw new Error(`exports seed failed: ${error.message}`);
  seededExportIds.push(exportId);
  return exportId;
}

afterEach(async () => {
  if (seededExportIds.length > 0) {
    await serviceClient.from("exports").delete().in("id", seededExportIds);
    seededExportIds.length = 0;
  }
});

describe("exports RLS", () => {
  it("correctPatient sees own exports", async () => {
    const patientId = crypto.randomUUID();
    const id = await seedExport(patientId);
    const run = asIdentity("correctPatient", { patientId });
    const rows = await run(
      (tx) => tx<{ id: string }[]>`
      SELECT id FROM exports WHERE patient_id = ${patientId}::uuid
    `,
    );
    expect(rows.map((r) => r.id)).toContain(id);
  });

  it("wrongPatient sees zero exports for another patient", async () => {
    const patientId = crypto.randomUUID();
    const otherPatientId = crypto.randomUUID();
    await seedExport(patientId);
    const run = asIdentity("wrongPatient", { patientId, otherPatientId });
    const rows = await run(
      (tx) => tx<{ id: string }[]>`
      SELECT id FROM exports WHERE patient_id = ${patientId}::uuid
    `,
    );
    expect(rows).toHaveLength(0);
  });

  it("serviceRole bypasses RLS and sees every exports row", async () => {
    const patientId = crypto.randomUUID();
    const otherPatientId = crypto.randomUUID();
    const idA = await seedExport(patientId);
    const idB = await seedExport(otherPatientId);
    const { data, error } = await serviceClient
      .from("exports")
      .select("id")
      .in("id", [idA, idB]);
    expect(error).toBeNull();
    const ids = ((data ?? []) as { id: string }[]).map((r) => r.id).sort();
    expect(ids).toEqual([idA, idB].sort());
  });
});
