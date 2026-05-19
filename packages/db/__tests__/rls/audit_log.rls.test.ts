/**
 * RLS adversarial test matrix for the append-only `audit_log` table
 * (Story 1.1, AR10 / NFR-S4).
 * Requires: supabase start (Supabase CLI). Do NOT include in pnpm test.
 *
 * Verifies:
 *  - INSERT WITH CHECK: a patient can only write rows where actor_id matches
 *    their app.current_patient_id claim.
 *  - SELECT: a patient sees only their own rows.
 *  - UPDATE / DELETE: denied for every authenticated patient (no policy →
 *    append-only at the DB layer).
 */
import { afterEach, describe, expect, it } from "vitest";

import { asIdentity } from "./helpers";
import { serviceClient } from "./setup";

interface AuditRow {
  id: string;
  actor_id: string;
}

const seededAuditIds: string[] = [];

async function seedAudit(actorId: string): Promise<string> {
  const id = crypto.randomUUID();
  const { error } = await serviceClient.from("audit_log").insert({
    id,
    actor_id: actorId,
    actor_type: "patient",
    event: "patient.created",
    resource_id: actorId,
    resource_type: "user",
    metadata: { actor: "self" },
  });
  if (error) throw new Error(`audit seed failed: ${error.message}`);
  seededAuditIds.push(id);
  return id;
}

afterEach(async () => {
  if (seededAuditIds.length === 0) return;
  await serviceClient.from("audit_log").delete().in("id", seededAuditIds);
  seededAuditIds.length = 0;
});

describe("audit_log RLS isolation (append-only)", () => {
  it("correctPatient can INSERT an audit row for themselves", async () => {
    const patientId = crypto.randomUUID();
    const run = asIdentity("correctPatient", { patientId });

    const inserted = await run(
      (tx) => tx<{ id: string }[]>`
        INSERT INTO audit_log (actor_id, actor_type, event, resource_id, resource_type, metadata)
        VALUES (${patientId}, ${"patient"}, ${"patient.created"}, ${patientId}, ${"user"}, ${JSON.stringify({ actor: "self" })}::jsonb)
        RETURNING id
      `,
    );

    expect(inserted).toHaveLength(1);
    if (inserted[0]) seededAuditIds.push(inserted[0].id);
  });

  it("WITH CHECK blocks INSERT with a foreign actor_id (Postgres 42501)", async () => {
    const patientId = crypto.randomUUID();
    const foreignActorId = crypto.randomUUID();
    const run = asIdentity("correctPatient", { patientId });

    await expect(
      run(
        (tx) => tx`
          INSERT INTO audit_log (actor_id, actor_type, event, resource_id, resource_type)
          VALUES (${foreignActorId}, ${"patient"}, ${"patient.created"}, ${foreignActorId}, ${"user"})
        `,
      ),
    ).rejects.toMatchObject({ code: "42501" });
  });

  it("SELECT returns only the patient's own rows", async () => {
    const patientId = crypto.randomUUID();
    const otherPatientId = crypto.randomUUID();
    const ownAuditId = await seedAudit(patientId);
    await seedAudit(otherPatientId);

    const run = asIdentity("correctPatient", { patientId });
    const rows = await run(
      (tx) => tx<AuditRow[]>`SELECT id, actor_id FROM audit_log`,
    );

    expect(rows.map((r) => r.id)).toEqual([ownAuditId]);
    expect(rows.every((r) => r.actor_id === patientId)).toBe(true);
  });

  it("UPDATE on own rows is denied (no UPDATE policy → append-only)", async () => {
    const patientId = crypto.randomUUID();
    await seedAudit(patientId);
    const run = asIdentity("correctPatient", { patientId });

    // Prove first that the row IS visible to this patient via SELECT — so
    // a SELECT-policy regression can't masquerade as UPDATE denial.
    const visible = await run(
      (tx) =>
        tx<
          { id: string }[]
        >`SELECT id FROM audit_log WHERE actor_id = ${patientId}`,
    );
    expect(visible).toHaveLength(1);

    // No UPDATE policy means the row is not visible to the UPDATE, so the
    // statement succeeds but affects 0 rows. Assert the event is unchanged.
    await run(
      (tx) =>
        tx`UPDATE audit_log SET event = ${"tampered"} WHERE actor_id = ${patientId}`,
    );

    const { data } = await serviceClient
      .from("audit_log")
      .select("event")
      .eq("actor_id", patientId);
    expect(data?.every((r) => r.event === "patient.created")).toBe(true);
  });

  it("DELETE on own rows is denied (no DELETE policy → append-only)", async () => {
    const patientId = crypto.randomUUID();
    await seedAudit(patientId);
    const run = asIdentity("correctPatient", { patientId });

    // Prove the row IS visible via SELECT before asserting DELETE is a no-op.
    const visible = await run(
      (tx) =>
        tx<
          { id: string }[]
        >`SELECT id FROM audit_log WHERE actor_id = ${patientId}`,
    );
    expect(visible).toHaveLength(1);

    await run((tx) => tx`DELETE FROM audit_log WHERE actor_id = ${patientId}`);

    const { data } = await serviceClient
      .from("audit_log")
      .select("id")
      .eq("actor_id", patientId);
    expect((data ?? []).length).toBeGreaterThan(0);
  });
});
