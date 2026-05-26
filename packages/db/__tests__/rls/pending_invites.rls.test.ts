/**
 * Story 5.1 T2.7 — RLS for `pending_invites`.
 * 3-identity matrix: correctPatient / wrongPatient / serviceRole.
 * Requires: `supabase start` + applied `custom_rls_pending_invites.sql`.
 */
import { afterEach, describe, expect, it } from "vitest";

import { asIdentity } from "./helpers";
import { serviceClient } from "./setup";

const seededIds: string[] = [];

async function seedInvite(args: {
  patientId: string;
  identifierHash: string;
  displayName?: string;
}): Promise<string> {
  const id = crypto.randomUUID();
  const { error } = await serviceClient.from("pending_invites").insert({
    id,
    patient_id: args.patientId,
    display_name: args.displayName ?? "Dra. Renata",
    identifier_hash: args.identifierHash,
  });
  if (error) throw new Error(`pending_invites seed failed: ${error.message}`);
  seededIds.push(id);
  return id;
}

afterEach(async () => {
  if (seededIds.length === 0) return;
  await serviceClient.from("pending_invites").delete().in("id", seededIds);
  seededIds.length = 0;
});

describe("pending_invites RLS", () => {
  it("correctPatient sees own invite", async () => {
    const patientId = crypto.randomUUID();
    const id = await seedInvite({
      patientId,
      identifierHash: "h".repeat(64),
    });
    const run = asIdentity("correctPatient", { patientId });
    const rows = await run(
      (tx) => tx<{ id: string }[]>`
      SELECT id FROM pending_invites WHERE patient_id = ${patientId}::uuid
    `,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe(id);
  });

  it("wrongPatient sees zero rows from another patient", async () => {
    const patientId = crypto.randomUUID();
    const otherPatientId = crypto.randomUUID();
    await seedInvite({ patientId, identifierHash: "h".repeat(64) });
    const run = asIdentity("wrongPatient", { patientId, otherPatientId });
    const rows = await run(
      (tx) => tx<{ id: string }[]>`
      SELECT id FROM pending_invites WHERE patient_id = ${patientId}::uuid
    `,
    );
    expect(rows).toHaveLength(0);
  });
});
