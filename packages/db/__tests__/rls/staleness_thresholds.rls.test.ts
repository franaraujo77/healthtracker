/**
 * Story 6.5 T7.1 — RLS for the `staleness_thresholds` table.
 *
 * **AC10 / CLAUDE.md 7-identity matrix (introduced by Story 6.4 —
 * applied here verbatim).** The staleness table is bound by
 * `app.current_doctor_user_id` (NOT `app.current_share_token_id`) —
 * doctor preference, `auth.uid()`-scoped. A doctor whose CURRENT
 * share-token is expired/revoked still sees their own rows.
 *
 *   - correctPatient → 0 rows (no patient policy)
 *   - wrongPatient → 0 rows
 *   - serviceRole → all rows
 *   - doctorWithActiveToken AS OWNER → own row
 *   - UNRELATED activated doctor → 0 rows
 *   - doctorWithExpiredToken AS OWNER → own row
 *   - doctorWithRevokedToken AS OWNER → own row
 *
 * Requires: `supabase start` + applied
 * `custom_rls_staleness_thresholds.sql`.
 */
import { afterEach, describe, expect, it } from "vitest";

import { asIdentity } from "./helpers";
import { cleanupSeededUsers, seedUser, serviceClient } from "./setup";

const seededUserIds: string[] = [];

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

async function seedStaleness(args: {
  professionalUserId: string;
  category?: string;
  thresholdDays?: number;
}): Promise<{ professionalUserId: string; category: string }> {
  const category = args.category ?? "lipid_panel";
  const { error } = await serviceClient.from("staleness_thresholds").insert({
    professional_user_id: args.professionalUserId,
    biomarker_category: category,
    threshold_days: args.thresholdDays ?? 180,
  });
  if (error) {
    throw new Error(`staleness_thresholds seed failed: ${error.message}`);
  }
  return { professionalUserId: args.professionalUserId, category };
}

afterEach(async () => {
  if (seededUserIds.length > 0) {
    // Cascade FK on `staleness_thresholds.professional_user_id →
    // professionals.user_id → users.id` reaps the rows automatically.
    await cleanupSeededUsers(seededUserIds);
    seededUserIds.length = 0;
  }
});

describe("staleness_thresholds RLS — Story 6.5 AC10 / 7-identity matrix", () => {
  it("correctPatient sees ZERO rows (no patient SELECT policy)", async () => {
    const patientId = crypto.randomUUID();
    await seedUser(patientId);
    seededUserIds.push(patientId);
    const doctorUserId = crypto.randomUUID();
    await seedProfessional(doctorUserId);
    await seedStaleness({ professionalUserId: doctorUserId });

    const run = asIdentity("correctPatient", { patientId });
    const rows = await run(
      (tx) =>
        tx<{ professional_user_id: string }[]>`
          SELECT professional_user_id FROM staleness_thresholds
        `,
    );
    expect(rows).toHaveLength(0);
  });

  it("wrongPatient sees ZERO rows", async () => {
    const doctorUserId = crypto.randomUUID();
    await seedProfessional(doctorUserId);
    await seedStaleness({ professionalUserId: doctorUserId });

    const run = asIdentity("wrongPatient", {
      patientId: crypto.randomUUID(),
      otherPatientId: crypto.randomUUID(),
    });
    const rows = await run(
      (tx) =>
        tx<{ professional_user_id: string }[]>`
          SELECT professional_user_id FROM staleness_thresholds
        `,
    );
    expect(rows).toHaveLength(0);
  });

  it("serviceRole bypasses RLS and sees every row", async () => {
    const doctorA = crypto.randomUUID();
    const doctorB = crypto.randomUUID();
    await seedProfessional(doctorA);
    await seedProfessional(doctorB);
    await seedStaleness({
      professionalUserId: doctorA,
      category: "lipid_panel",
    });
    await seedStaleness({ professionalUserId: doctorB, category: "thyroid" });

    const { data, error } = await serviceClient
      .from("staleness_thresholds")
      .select("professional_user_id")
      .in("professional_user_id", [doctorA, doctorB]);
    expect(error).toBeNull();
    const ids = ((data ?? []) as { professional_user_id: string }[])
      .map((r) => r.professional_user_id)
      .sort();
    expect(ids).toEqual([doctorA, doctorB].sort());
  });

  it("doctorWithActiveToken (OWNER) sees own staleness row", async () => {
    const doctorUserId = crypto.randomUUID();
    await seedProfessional(doctorUserId);
    await seedStaleness({ professionalUserId: doctorUserId });

    const run = asIdentity("doctorWithActiveToken", {
      patientId: crypto.randomUUID(),
      shareTokenId: crypto.randomUUID(),
      doctorUserId,
    });
    const rows = await run(
      (tx) => tx<{ professional_user_id: string }[]>`
        SELECT professional_user_id FROM staleness_thresholds
        WHERE professional_user_id = ${doctorUserId}::uuid
      `,
    );
    expect(rows).toHaveLength(1);
  });

  it("UNRELATED_DOCTOR (7th identity) sees ZERO rows for another doctor's row", async () => {
    const ownerDoctor = crypto.randomUUID();
    const unrelatedDoctor = crypto.randomUUID();
    await seedProfessional(ownerDoctor);
    await seedProfessional(unrelatedDoctor);
    await seedStaleness({ professionalUserId: ownerDoctor });

    const run = asIdentity("doctorWithActiveToken", {
      patientId: crypto.randomUUID(),
      shareTokenId: crypto.randomUUID(),
      doctorUserId: unrelatedDoctor,
    });
    const rows = await run(
      (tx) => tx<{ professional_user_id: string }[]>`
        SELECT professional_user_id FROM staleness_thresholds
        WHERE professional_user_id = ${ownerDoctor}::uuid
      `,
    );
    expect(rows).toHaveLength(0);
  });

  it("doctorWithExpiredToken (OWNER) sees own row — not share-token-gated", async () => {
    const doctorUserId = crypto.randomUUID();
    await seedProfessional(doctorUserId);
    await seedStaleness({ professionalUserId: doctorUserId });

    const run = asIdentity("doctorWithExpiredToken", {
      patientId: crypto.randomUUID(),
      shareTokenId: crypto.randomUUID(),
      doctorUserId,
    });
    const rows = await run(
      (tx) => tx<{ professional_user_id: string }[]>`
        SELECT professional_user_id FROM staleness_thresholds
        WHERE professional_user_id = ${doctorUserId}::uuid
      `,
    );
    expect(rows).toHaveLength(1);
  });

  it("doctorWithRevokedToken (OWNER) sees own row — same reason", async () => {
    const doctorUserId = crypto.randomUUID();
    await seedProfessional(doctorUserId);
    await seedStaleness({ professionalUserId: doctorUserId });

    const run = asIdentity("doctorWithRevokedToken", {
      patientId: crypto.randomUUID(),
      shareTokenId: crypto.randomUUID(),
      doctorUserId,
    });
    const rows = await run(
      (tx) => tx<{ professional_user_id: string }[]>`
        SELECT professional_user_id FROM staleness_thresholds
        WHERE professional_user_id = ${doctorUserId}::uuid
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
          INSERT INTO staleness_thresholds
            (professional_user_id, biomarker_category, threshold_days)
          VALUES (${otherDoctor}::uuid, 'lipid_panel', 90)
        `,
      ),
    ).rejects.toMatchObject({ code: "42501" });
  });

  it("UPDATE on another doctor's row affects 0 rows (RLS hides it)", async () => {
    const ownerDoctor = crypto.randomUUID();
    const probingDoctor = crypto.randomUUID();
    await seedProfessional(ownerDoctor);
    await seedProfessional(probingDoctor);
    await seedStaleness({
      professionalUserId: ownerDoctor,
      category: "lipid_panel",
      thresholdDays: 180,
    });

    const run = asIdentity("doctorWithActiveToken", {
      patientId: crypto.randomUUID(),
      shareTokenId: crypto.randomUUID(),
      doctorUserId: probingDoctor,
    });
    const rows = await run(
      (tx) => tx<{ professional_user_id: string }[]>`
        UPDATE staleness_thresholds
        SET threshold_days = 30
        WHERE professional_user_id = ${ownerDoctor}::uuid
        RETURNING professional_user_id
      `,
    );
    expect(rows).toHaveLength(0);

    // Confirm via service role that the owner's row is unchanged.
    const { data } = await serviceClient
      .from("staleness_thresholds")
      .select("threshold_days")
      .eq("professional_user_id", ownerDoctor)
      .eq("biomarker_category", "lipid_panel");
    expect(
      ((data ?? []) as { threshold_days: number }[])[0]?.threshold_days,
    ).toBe(180);
  });

  it("DELETE policy intentionally absent — OWNER cannot delete via doctor session", async () => {
    const doctorUserId = crypto.randomUUID();
    await seedProfessional(doctorUserId);
    await seedStaleness({ professionalUserId: doctorUserId });

    const run = asIdentity("doctorWithActiveToken", {
      patientId: crypto.randomUUID(),
      shareTokenId: crypto.randomUUID(),
      doctorUserId,
    });
    const rows = await run(
      (tx) => tx<{ professional_user_id: string }[]>`
        DELETE FROM staleness_thresholds
        WHERE professional_user_id = ${doctorUserId}::uuid
        RETURNING professional_user_id
      `,
    );
    // No DELETE policy → no rows match → 0 rows affected.
    expect(rows).toHaveLength(0);
  });
});
