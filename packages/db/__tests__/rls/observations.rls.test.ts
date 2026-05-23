/**
 * RLS adversarial test matrix for the `observations` table.
 * Requires: `supabase start` (Supabase CLI). Do NOT include in pnpm test.
 *
 * Story 3.1 wires the first two identity cases (correctPatient,
 * wrongPatient) — these are the patient-facing READ surface
 * (`observations_select_own` policy in
 * `packages/db/policies/custom_rls_observations.sql`). The doctor-
 * facing cases (`doctorWithAccess`, `doctorWithoutAccess`,
 * `expiredToken`, `revokedToken`) land in Story 5.1+ when the
 * sharing surface ships.
 */
import { afterEach, describe, expect, it } from "vitest";

import { asIdentity } from "./helpers";
import { serviceClient } from "./setup";

const seededIds: string[] = [];

async function seedObservation(args: {
  patientId: string;
  loincCode?: string;
  biomarkerName?: string;
  collectedAt?: string;
}): Promise<string> {
  const id = crypto.randomUUID();
  const { error } = await serviceClient.from("observations").insert({
    id,
    patient_id: args.patientId,
    upload_id: null,
    loinc_code: args.loincCode ?? "718-7",
    biomarker_name: args.biomarkerName ?? "Hemoglobina",
    value_numeric: "14.2",
    unit_ucum: "g/dL",
    lab_name: "InBody 770",
    collected_at: args.collectedAt ?? "2024-03-15",
    confidence_score: "1.0",
    source: "manual_bia",
  });
  if (error) throw new Error(`observation seed failed: ${error.message}`);
  seededIds.push(id);
  return id;
}

afterEach(async () => {
  if (seededIds.length === 0) return;
  await serviceClient.from("observations").delete().in("id", seededIds);
  seededIds.length = 0;
});

describe("observations table RLS — Story 3.1 read surface", () => {
  it("correctPatient sees their own observation rows", async () => {
    const patientId = crypto.randomUUID();
    const seededId = await seedObservation({ patientId });
    const run = asIdentity("correctPatient", { patientId });

    const rows = await run(
      (tx) => tx<{ id: string }[]>`
        SELECT id FROM observations
        WHERE patient_id = ${patientId}::uuid
          AND deleted_at IS NULL
      `,
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe(seededId);
  });

  it("wrongPatient sees zero rows from another patient (RLS row-level isolation)", async () => {
    const patientId = crypto.randomUUID();
    const otherPatientId = crypto.randomUUID();
    await seedObservation({ patientId });
    const run = asIdentity("wrongPatient", {
      patientId,
      otherPatientId,
    });

    // Query for the rows that *would* exist if RLS were broken.
    const rows = await run(
      (tx) => tx<{ id: string }[]>`
        SELECT id FROM observations
        WHERE patient_id = ${patientId}::uuid
      `,
    );

    expect(rows).toHaveLength(0);
  });

  it.todo(
    "doctorWithAccess: reads rows scoped to active share token for patient (Story 5.1)",
  );

  it.todo("doctorWithoutAccess: gets zero rows (Story 5.1)");

  it.todo("expiredToken: auth rejected or zero rows returned (Story 5.1)");

  it.todo("revokedToken: gets zero rows (Story 5.1)");
});
