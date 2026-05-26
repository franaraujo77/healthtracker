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

  // ---------------------------------------------------------------------
  // Story 5.3 — share-token-scoped doctor-actor visibility (AC6, AC7).
  // ---------------------------------------------------------------------

  it("correctPatient sees share-token-scoped doctor-actor audit rows (Story 5.3)", async () => {
    // Patient A owns a share_token; a doctor's actor_id writes an
    // audit row scoped to that token. Under the extended
    // `audit_log_select_own` policy, patient A's `app.current_patient_id`
    // context MUST surface that row.
    const patientId = crypto.randomUUID();
    const doctorId = crypto.randomUUID();
    const inviteId = crypto.randomUUID();
    const tokenId = crypto.randomUUID();
    const auditId = crypto.randomUUID();

    const { error: e1 } = await serviceClient.from("pending_invites").insert({
      id: inviteId,
      patient_id: patientId,
      display_name: "Dra. T",
      identifier_hash: "t".repeat(64),
    });
    if (e1) throw new Error(`invite seed failed: ${e1.message}`);

    const { error: e2 } = await serviceClient.from("share_tokens").insert({
      id: tokenId,
      token_hash: `hash-${tokenId}`,
      token_hmac: `hmac-${tokenId}`,
      patient_id: patientId,
      invite_id: inviteId,
      expires_at: new Date(Date.now() + 7 * 86_400_000).toISOString(),
      revoked_at: null,
      duration: "7d",
    });
    if (e2) throw new Error(`share_tokens seed failed: ${e2.message}`);

    const { error: e3 } = await serviceClient.from("audit_log").insert({
      id: auditId,
      actor_id: doctorId,
      actor_type: "doctor",
      event: "share_token.read",
      resource_id: tokenId,
      resource_type: "share_token",
      metadata: {},
    });
    if (e3) throw new Error(`audit seed failed: ${e3.message}`);
    seededAuditIds.push(auditId);

    try {
      const run = asIdentity("correctPatient", { patientId });
      const rows = await run(
        (tx) =>
          tx<
            { id: string }[]
          >`SELECT id FROM audit_log WHERE id = ${auditId}::uuid`,
      );
      expect(rows.map((r) => r.id)).toContain(auditId);
    } finally {
      await serviceClient.from("share_tokens").delete().eq("id", tokenId);
      await serviceClient.from("pending_invites").delete().eq("id", inviteId);
    }
  });

  it("wrongPatient does NOT see another patient's share-token-scoped rows", async () => {
    const patientId = crypto.randomUUID();
    const otherPatientId = crypto.randomUUID();
    const doctorId = crypto.randomUUID();
    const inviteId = crypto.randomUUID();
    const tokenId = crypto.randomUUID();
    const auditId = crypto.randomUUID();

    await serviceClient.from("pending_invites").insert({
      id: inviteId,
      patient_id: patientId,
      display_name: "Dra. T",
      identifier_hash: "t".repeat(64),
    });
    await serviceClient.from("share_tokens").insert({
      id: tokenId,
      token_hash: `hash-${tokenId}`,
      token_hmac: `hmac-${tokenId}`,
      patient_id: patientId,
      invite_id: inviteId,
      expires_at: new Date(Date.now() + 7 * 86_400_000).toISOString(),
      revoked_at: null,
      duration: "7d",
    });
    await serviceClient.from("audit_log").insert({
      id: auditId,
      actor_id: doctorId,
      actor_type: "doctor",
      event: "share_token.read",
      resource_id: tokenId,
      resource_type: "share_token",
      metadata: {},
    });
    seededAuditIds.push(auditId);

    try {
      const run = asIdentity("wrongPatient", {
        patientId: otherPatientId,
        otherPatientId,
      });
      const rows = await run(
        (tx) =>
          tx<
            { id: string }[]
          >`SELECT id FROM audit_log WHERE id = ${auditId}::uuid`,
      );
      expect(rows).toHaveLength(0);
    } finally {
      await serviceClient.from("share_tokens").delete().eq("id", tokenId);
      await serviceClient.from("pending_invites").delete().eq("id", inviteId);
    }
  });

  it("doctor connection (no app.current_patient_id) sees zero audit rows", async () => {
    // The audit_log policy is keyed off `app.current_patient_id`; a
    // doctor connection (`app.current_share_token_id` only) MUST NOT
    // see any audit_log row even when that doctor was the actor.
    // Doctors don't browse the audit_log surface.
    const patientId = crypto.randomUUID();
    const doctorId = crypto.randomUUID();
    const inviteId = crypto.randomUUID();
    const tokenId = crypto.randomUUID();
    const auditId = crypto.randomUUID();

    await serviceClient.from("pending_invites").insert({
      id: inviteId,
      patient_id: patientId,
      display_name: "Dra. T",
      identifier_hash: "t".repeat(64),
    });
    await serviceClient.from("share_tokens").insert({
      id: tokenId,
      token_hash: `hash-${tokenId}`,
      token_hmac: `hmac-${tokenId}`,
      patient_id: patientId,
      invite_id: inviteId,
      expires_at: new Date(Date.now() + 7 * 86_400_000).toISOString(),
      revoked_at: null,
      duration: "7d",
    });
    await serviceClient.from("audit_log").insert({
      id: auditId,
      actor_id: doctorId,
      actor_type: "doctor",
      event: "share_token.read",
      resource_id: tokenId,
      resource_type: "share_token",
      metadata: {},
    });
    seededAuditIds.push(auditId);

    try {
      const run = asIdentity("doctorWithActiveToken", {
        patientId,
        shareTokenId: tokenId,
      });
      const rows = await run(
        (tx) =>
          tx<
            { id: string }[]
          >`SELECT id FROM audit_log WHERE id = ${auditId}::uuid`,
      );
      expect(rows).toHaveLength(0);
    } finally {
      await serviceClient.from("share_tokens").delete().eq("id", tokenId);
      await serviceClient.from("pending_invites").delete().eq("id", inviteId);
    }
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
