/**
 * Story 6.3 T6.1 — RLS for the `professionals` table.
 *
 * CLAUDE.md "Code review discipline" — the 6-identity matrix is
 * mandatory on every new sharing-related table:
 *   correctPatient / wrongPatient / serviceRole
 *   doctorWithActiveToken (own) / doctorWithActiveToken (other doctor)
 *   doctorWithExpiredToken / doctorWithRevokedToken
 *
 * The `professionals` policy uses `app.current_doctor_user_id`
 * (set by `doctorProcedure` from the verified Supabase session uid)
 * rather than `app.current_share_token_id` — activation is
 * `auth.uid()`-scoped (AC4 / AC10 — Doctor Acquisition Loop closure).
 *
 * Requires: `supabase start` + applied
 * `custom_rls_professionals.sql`.
 */
import { afterEach, describe, expect, it } from "vitest";

import type { ProfessionalCategory } from "@healthtracker/validators";

import { asIdentity } from "./helpers";
import { cleanupSeededUsers, seedUser, serviceClient } from "./setup";

const seededUserIds: string[] = [];

// R1-N1 fix-up: derive `category` from the canonical
// `ProfessionalCategory` type instead of duplicating the enum
// literal union here. The seed helper now drifts with the validator
// schema, not in spite of it.
async function seedProfessional(args: {
  userId: string;
  displayName?: string;
  category?: ProfessionalCategory;
}): Promise<string> {
  await seedUser(args.userId);
  seededUserIds.push(args.userId);
  const { error } = await serviceClient.from("professionals").insert({
    user_id: args.userId,
    display_name: args.displayName ?? "Dr. Test",
    category: args.category ?? "clinico_geral",
  });
  if (error) {
    throw new Error(`professionals seed failed: ${error.message}`);
  }
  return args.userId;
}

afterEach(async () => {
  if (seededUserIds.length > 0) {
    // Cascade FK on `professionals.user_id → users.id` reaps the
    // professionals row when we delete the user.
    await cleanupSeededUsers(seededUserIds);
    seededUserIds.length = 0;
  }
});

describe("professionals RLS — Story 6.3 AC9 / 6-identity matrix", () => {
  it("correctPatient sees zero professionals rows (patient principal — wrong table)", async () => {
    // Patients don't have professional rows; the policy filters on
    // `app.current_doctor_user_id` which is NOT set under the patient
    // principal. Even if the GUC were spuriously set, no patient row
    // matches.
    const patientId = crypto.randomUUID();
    await seedUser(patientId);
    seededUserIds.push(patientId);
    const doctorUserId = crypto.randomUUID();
    await seedProfessional({ userId: doctorUserId });
    const run = asIdentity("correctPatient", { patientId });
    const rows = await run(
      (tx) => tx<{ user_id: string }[]>`SELECT user_id FROM professionals`,
    );
    expect(rows).toHaveLength(0);
  });

  it("wrongPatient sees zero professionals rows", async () => {
    const doctorUserId = crypto.randomUUID();
    await seedProfessional({ userId: doctorUserId });
    const run = asIdentity("wrongPatient", {
      patientId: crypto.randomUUID(),
      otherPatientId: crypto.randomUUID(),
    });
    const rows = await run(
      (tx) => tx<{ user_id: string }[]>`SELECT user_id FROM professionals`,
    );
    expect(rows).toHaveLength(0);
  });

  it("serviceRole bypasses RLS and sees every professionals row", async () => {
    const doctorA = crypto.randomUUID();
    const doctorB = crypto.randomUUID();
    await seedProfessional({ userId: doctorA });
    await seedProfessional({ userId: doctorB });
    const { data, error } = await serviceClient
      .from("professionals")
      .select("user_id")
      .in("user_id", [doctorA, doctorB]);
    expect(error).toBeNull();
    const ids = ((data ?? []) as { user_id: string }[])
      .map((r) => r.user_id)
      .sort();
    expect(ids).toEqual([doctorA, doctorB].sort());
  });

  it("doctorWithActiveToken sees own professionals row when GUC binds to it", async () => {
    const patientId = crypto.randomUUID();
    const doctorUserId = crypto.randomUUID();
    await seedProfessional({ userId: doctorUserId });
    // Bind the doctor principal — the GUC `app.current_doctor_user_id`
    // selects the row.
    const run = asIdentity("doctorWithActiveToken", {
      patientId,
      shareTokenId: crypto.randomUUID(),
      doctorUserId,
    });
    const rows = await run(
      (tx) => tx<{ user_id: string }[]>`
        SELECT user_id FROM professionals WHERE user_id = ${doctorUserId}::uuid
      `,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.user_id).toBe(doctorUserId);
  });

  it("doctorWithActiveToken sees ZERO rows for a different doctor's professionals row", async () => {
    // Cross-doctor isolation — doctor A's session must not see doctor B's row.
    const doctorA = crypto.randomUUID();
    const doctorB = crypto.randomUUID();
    await seedProfessional({ userId: doctorB });
    const run = asIdentity("doctorWithActiveToken", {
      patientId: crypto.randomUUID(),
      shareTokenId: crypto.randomUUID(),
      doctorUserId: doctorA,
    });
    const rows = await run(
      (tx) => tx<{ user_id: string }[]>`
        SELECT user_id FROM professionals WHERE user_id = ${doctorB}::uuid
      `,
    );
    expect(rows).toHaveLength(0);
  });

  it("doctorWithExpiredToken sees ZERO rows when GUC binds to a different doctor's id", async () => {
    // The professionals policy is `auth.uid()`-scoped; an expired
    // share-token does not by itself revoke activation. The expired
    // identity in this matrix simulates "doctor whose CURRENT
    // share-token expired" — they still see their own row if the
    // GUC binds (it's a doctor-side identity binding). We test the
    // adversarial path: GUC binds to a DIFFERENT doctor → 0 rows.
    const targetDoctor = crypto.randomUUID();
    await seedProfessional({ userId: targetDoctor });
    const probingDoctor = crypto.randomUUID();
    const run = asIdentity("doctorWithExpiredToken", {
      patientId: crypto.randomUUID(),
      shareTokenId: crypto.randomUUID(),
      doctorUserId: probingDoctor,
    });
    const rows = await run(
      (tx) => tx<{ user_id: string }[]>`
        SELECT user_id FROM professionals WHERE user_id = ${targetDoctor}::uuid
      `,
    );
    expect(rows).toHaveLength(0);
  });

  it("doctorWithRevokedToken sees ZERO rows when GUC binds to a different doctor's id", async () => {
    const targetDoctor = crypto.randomUUID();
    await seedProfessional({ userId: targetDoctor });
    const probingDoctor = crypto.randomUUID();
    const run = asIdentity("doctorWithRevokedToken", {
      patientId: crypto.randomUUID(),
      shareTokenId: crypto.randomUUID(),
      doctorUserId: probingDoctor,
    });
    const rows = await run(
      (tx) => tx<{ user_id: string }[]>`
        SELECT user_id FROM professionals WHERE user_id = ${targetDoctor}::uuid
      `,
    );
    expect(rows).toHaveLength(0);
  });

  it("INSERT WITH CHECK blocks inserting a row for a different user_id (Postgres 42501)", async () => {
    const ownDoctor = crypto.randomUUID();
    const otherDoctor = crypto.randomUUID();
    await seedUser(otherDoctor);
    seededUserIds.push(otherDoctor);
    await seedUser(ownDoctor);
    seededUserIds.push(ownDoctor);
    const run = asIdentity("doctorWithActiveToken", {
      patientId: crypto.randomUUID(),
      shareTokenId: crypto.randomUUID(),
      doctorUserId: ownDoctor,
    });
    await expect(
      run(
        (tx) => tx`
        INSERT INTO professionals (user_id, display_name, category)
        VALUES (${otherDoctor}::uuid, 'Dr. Hacker', 'clinico_geral')
      `,
      ),
    ).rejects.toMatchObject({ code: "42501" });
  });
});
