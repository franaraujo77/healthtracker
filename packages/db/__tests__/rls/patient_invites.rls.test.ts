/**
 * Story 6.4 T7.1 — RLS for the `patient_invites` table.
 *
 * **AC10 / CLAUDE.md 7-identity matrix (introduced by Story 6.4 —
 * adds `unrelatedDoctor`).** Mandatory matrix:
 *   - `correctPatient` (no relation) → 0 rows
 *   - `wrongPatient` → 0 rows
 *   - `serviceRole` → all rows
 *   - `doctorWithActiveToken` AS OWNER → 1 row (own)
 *   - `doctorWithActiveToken` AS DIFFERENT doctor (`unrelatedDoctor`) → 0 rows
 *   - `doctorWithExpiredToken` AS OWNER → 1 row
 *   - `doctorWithRevokedToken` AS OWNER → 1 row
 *
 * The Story 6.3 RLS pattern carries: `professionals` (and now
 * `patient_invites`) are bound by `app.current_doctor_user_id`, NOT
 * `app.current_share_token_id`. A doctor whose CURRENT share-token
 * is expired/revoked still sees their own `patient_invites` rows.
 *
 * Requires: `supabase start` + applied `custom_rls_patient_invites.sql`.
 */
import { afterEach, describe, expect, it } from "vitest";

import { asIdentity } from "./helpers";
import { cleanupSeededUsers, seedUser, serviceClient } from "./setup";

const seededUserIds: string[] = [];
const seededInviteIds: string[] = [];

async function seedProfessional(userId: string): Promise<void> {
  await seedUser(userId);
  seededUserIds.push(userId);
  const { error } = await serviceClient.from("professionals").insert({
    user_id: userId,
    display_name: "Dr. Test",
    category: "clinico_geral",
  });
  if (error && !error.message.includes("duplicate")) {
    throw new Error(`professionals seed failed: ${error.message}`);
  }
}

async function seedPatientInvite(args: {
  professionalUserId: string;
  identifierHash?: string;
  identifierKind?: string;
}): Promise<string> {
  const inviteId = crypto.randomUUID();
  const { error } = await serviceClient.from("patient_invites").insert({
    id: inviteId,
    professional_user_id: args.professionalUserId,
    identifier_hash:
      args.identifierHash ??
      crypto.randomUUID().replace(/-/g, "").padEnd(64, "a"),
    identifier_kind: args.identifierKind ?? "email",
    token_hmac: `hmac-${inviteId}`,
  });
  if (error) {
    throw new Error(`patient_invites seed failed: ${error.message}`);
  }
  seededInviteIds.push(inviteId);
  return inviteId;
}

afterEach(async () => {
  if (seededInviteIds.length > 0) {
    await serviceClient
      .from("patient_invites")
      .delete()
      .in("id", seededInviteIds);
    seededInviteIds.length = 0;
  }
  if (seededUserIds.length > 0) {
    await cleanupSeededUsers(seededUserIds);
    seededUserIds.length = 0;
  }
});

describe("patient_invites RLS — Story 6.4 AC10 / 7-identity matrix", () => {
  it("correctPatient sees ZERO patient_invites rows (no patient SELECT policy)", async () => {
    const patientId = crypto.randomUUID();
    await seedUser(patientId);
    seededUserIds.push(patientId);
    const doctorUserId = crypto.randomUUID();
    await seedProfessional(doctorUserId);
    await seedPatientInvite({ professionalUserId: doctorUserId });

    const run = asIdentity("correctPatient", { patientId });
    const rows = await run(
      (tx) => tx<{ id: string }[]>`SELECT id FROM patient_invites`,
    );
    expect(rows).toHaveLength(0);
  });

  it("wrongPatient sees ZERO patient_invites rows", async () => {
    const doctorUserId = crypto.randomUUID();
    await seedProfessional(doctorUserId);
    await seedPatientInvite({ professionalUserId: doctorUserId });

    const run = asIdentity("wrongPatient", {
      patientId: crypto.randomUUID(),
      otherPatientId: crypto.randomUUID(),
    });
    const rows = await run(
      (tx) => tx<{ id: string }[]>`SELECT id FROM patient_invites`,
    );
    expect(rows).toHaveLength(0);
  });

  it("serviceRole bypasses RLS and sees every patient_invites row", async () => {
    const doctorA = crypto.randomUUID();
    const doctorB = crypto.randomUUID();
    await seedProfessional(doctorA);
    await seedProfessional(doctorB);
    const inviteA = await seedPatientInvite({ professionalUserId: doctorA });
    const inviteB = await seedPatientInvite({ professionalUserId: doctorB });

    const { data, error } = await serviceClient
      .from("patient_invites")
      .select("id")
      .in("id", [inviteA, inviteB]);
    expect(error).toBeNull();
    const ids = ((data ?? []) as { id: string }[]).map((r) => r.id).sort();
    expect(ids).toEqual([inviteA, inviteB].sort());
  });

  it("doctorWithActiveToken (OWNER) sees own patient_invites row", async () => {
    const doctorUserId = crypto.randomUUID();
    await seedProfessional(doctorUserId);
    const inviteId = await seedPatientInvite({
      professionalUserId: doctorUserId,
    });

    const run = asIdentity("doctorWithActiveToken", {
      patientId: crypto.randomUUID(),
      shareTokenId: crypto.randomUUID(),
      doctorUserId,
    });
    const rows = await run(
      (tx) => tx<{ id: string }[]>`
        SELECT id FROM patient_invites WHERE id = ${inviteId}::uuid
      `,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe(inviteId);
  });

  it("UNRELATED_DOCTOR (7th identity) sees ZERO rows for a different doctor's patient_invites row", async () => {
    // The load-bearing 7th identity introduced by Story 6.4. Doctor A
    // owns the row; doctor B's session (bound via auth.uid() ↔
    // app.current_doctor_user_id) must NOT see it.
    const ownerDoctor = crypto.randomUUID();
    const unrelatedDoctor = crypto.randomUUID();
    await seedProfessional(ownerDoctor);
    await seedProfessional(unrelatedDoctor);
    const inviteId = await seedPatientInvite({
      professionalUserId: ownerDoctor,
    });

    const run = asIdentity("doctorWithActiveToken", {
      patientId: crypto.randomUUID(),
      shareTokenId: crypto.randomUUID(),
      doctorUserId: unrelatedDoctor,
    });
    const rows = await run(
      (tx) => tx<{ id: string }[]>`
        SELECT id FROM patient_invites WHERE id = ${inviteId}::uuid
      `,
    );
    expect(rows).toHaveLength(0);
  });

  it("doctorWithExpiredToken (OWNER) sees own row — patient_invites is NOT share-token-gated", async () => {
    // Activation is `auth.uid()`-scoped (Story 6.3 invariant carried
    // forward); an expired share-token does not revoke the doctor's
    // ownership of their own patient_invites rows.
    const doctorUserId = crypto.randomUUID();
    await seedProfessional(doctorUserId);
    const inviteId = await seedPatientInvite({
      professionalUserId: doctorUserId,
    });

    const run = asIdentity("doctorWithExpiredToken", {
      patientId: crypto.randomUUID(),
      shareTokenId: crypto.randomUUID(),
      doctorUserId,
    });
    const rows = await run(
      (tx) => tx<{ id: string }[]>`
        SELECT id FROM patient_invites WHERE id = ${inviteId}::uuid
      `,
    );
    expect(rows).toHaveLength(1);
  });

  it("doctorWithRevokedToken (OWNER) sees own row — same reason", async () => {
    const doctorUserId = crypto.randomUUID();
    await seedProfessional(doctorUserId);
    const inviteId = await seedPatientInvite({
      professionalUserId: doctorUserId,
    });

    const run = asIdentity("doctorWithRevokedToken", {
      patientId: crypto.randomUUID(),
      shareTokenId: crypto.randomUUID(),
      doctorUserId,
    });
    const rows = await run(
      (tx) => tx<{ id: string }[]>`
        SELECT id FROM patient_invites WHERE id = ${inviteId}::uuid
      `,
    );
    expect(rows).toHaveLength(1);
  });

  it("INSERT WITH CHECK blocks inserting a row for a different professional_user_id", async () => {
    const ownDoctor = crypto.randomUUID();
    const otherDoctor = crypto.randomUUID();
    await seedProfessional(ownDoctor);
    await seedProfessional(otherDoctor);

    const run = asIdentity("doctorWithActiveToken", {
      patientId: crypto.randomUUID(),
      shareTokenId: crypto.randomUUID(),
      doctorUserId: ownDoctor,
    });
    await expect(
      run(
        (tx) => tx`
        INSERT INTO patient_invites
          (professional_user_id, identifier_hash, identifier_kind, token_hmac)
        VALUES (
          ${otherDoctor}::uuid,
          ${"a".repeat(64)},
          'email',
          ${`hmac-${crypto.randomUUID()}`}
        )
      `,
      ),
    ).rejects.toMatchObject({ code: "42501" });
  });
});
