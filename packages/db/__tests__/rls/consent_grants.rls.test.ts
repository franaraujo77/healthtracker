/**
 * RLS adversarial test matrix for the append-only `consent_grants` table
 * (Story 1.2). Requires: supabase start (Supabase CLI). Do NOT include in
 * pnpm test.
 *
 * Mirrors the audit_log test exactly:
 *  - INSERT WITH CHECK: own allowed, foreign rejected with Postgres 42501.
 *  - SELECT: own rows only.
 *  - UPDATE / DELETE: prove visibility under correctPatient first, then
 *    assert the operation is a no-op (no UPDATE/DELETE policy exists).
 */
import { afterEach, describe, expect, it } from "vitest";

import { asIdentity } from "./helpers";
import { anonClient, serviceClient } from "./setup";

interface ConsentRow {
  id: string;
  patient_id: string;
  consent_type: string;
}

const seededIds: string[] = [];

async function seedConsent(
  patientId: string,
  consentType = "blood_test_results",
): Promise<string> {
  const id = crypto.randomUUID();
  const { error } = await serviceClient.from("consent_grants").insert({
    id,
    patient_id: patientId,
    consent_type: consentType,
    version: "2026-05-19",
    metadata: { source: "rls-test" },
  });
  if (error) throw new Error(`consent seed failed: ${error.message}`);
  seededIds.push(id);
  return id;
}

afterEach(async () => {
  if (seededIds.length === 0) return;
  await serviceClient.from("consent_grants").delete().in("id", seededIds);
  seededIds.length = 0;
});

describe("consent_grants RLS isolation (append-only)", () => {
  it("correctPatient can INSERT a consent row for themselves", async () => {
    const patientId = crypto.randomUUID();
    const run = asIdentity("correctPatient", { patientId });

    const inserted = await run(
      (tx) => tx<{ id: string }[]>`
        INSERT INTO consent_grants (patient_id, consent_type, version, metadata)
        VALUES (${patientId}, ${"blood_test_results"}, ${"2026-05-19"}, ${JSON.stringify({ source: "rls-test" })}::jsonb)
        RETURNING id
      `,
    );

    expect(inserted).toHaveLength(1);
    if (inserted[0]) seededIds.push(inserted[0].id);
  });

  it("WITH CHECK blocks INSERT with a foreign patient_id (Postgres 42501)", async () => {
    const patientId = crypto.randomUUID();
    const foreignPatientId = crypto.randomUUID();
    const run = asIdentity("correctPatient", { patientId });

    await expect(
      run(
        (tx) => tx`
          INSERT INTO consent_grants (patient_id, consent_type, version)
          VALUES (${foreignPatientId}, ${"blood_test_results"}, ${"2026-05-19"})
        `,
      ),
    ).rejects.toMatchObject({ code: "42501" });
  });

  it("wrongPatient sees zero rows even when other rows exist", async () => {
    await seedConsent(crypto.randomUUID());

    const run = asIdentity("wrongPatient", {
      patientId: crypto.randomUUID(),
      otherPatientId: crypto.randomUUID(),
    });
    const rows = await run(
      (tx) => tx<{ id: string }[]>`SELECT id FROM consent_grants`,
    );

    expect(rows).toEqual([]);
  });

  it("unauthenticated PostgREST request gets zero rows or an explicit error", async () => {
    await seedConsent(crypto.randomUUID());

    const { data, error } = await anonClient
      .from("consent_grants")
      .select("id");

    if (error) {
      expect(error.code).toBeTruthy();
    } else {
      expect(data).toEqual([]);
    }
  });

  it("SELECT returns only the patient's own rows", async () => {
    const patientId = crypto.randomUUID();
    const otherPatientId = crypto.randomUUID();
    const ownId = await seedConsent(patientId);
    await seedConsent(otherPatientId);

    const run = asIdentity("correctPatient", { patientId });
    const rows = await run(
      (tx) =>
        tx<
          ConsentRow[]
        >`SELECT id, patient_id, consent_type FROM consent_grants`,
    );

    expect(rows.map((r) => r.id)).toEqual([ownId]);
    expect(rows.every((r) => r.patient_id === patientId)).toBe(true);
  });

  it("UPDATE on own rows is denied (no UPDATE policy → append-only)", async () => {
    const patientId = crypto.randomUUID();
    await seedConsent(patientId);
    const run = asIdentity("correctPatient", { patientId });

    // Prove the row IS visible to this patient before asserting the no-op.
    const visible = await run(
      (tx) =>
        tx<
          { id: string }[]
        >`SELECT id FROM consent_grants WHERE patient_id = ${patientId}`,
    );
    expect(visible).toHaveLength(1);

    await run(
      (tx) =>
        tx`UPDATE consent_grants SET version = ${"tampered"} WHERE patient_id = ${patientId}`,
    );

    const { data } = await serviceClient
      .from("consent_grants")
      .select("version")
      .eq("patient_id", patientId);
    expect(data?.every((r) => r.version === "2026-05-19")).toBe(true);
  });

  it("DELETE on own rows is denied (no DELETE policy → append-only)", async () => {
    const patientId = crypto.randomUUID();
    await seedConsent(patientId);
    const run = asIdentity("correctPatient", { patientId });

    const visible = await run(
      (tx) =>
        tx<
          { id: string }[]
        >`SELECT id FROM consent_grants WHERE patient_id = ${patientId}`,
    );
    expect(visible).toHaveLength(1);

    await run(
      (tx) => tx`DELETE FROM consent_grants WHERE patient_id = ${patientId}`,
    );

    const { data } = await serviceClient
      .from("consent_grants")
      .select("id")
      .eq("patient_id", patientId);
    // Exact count rather than `> 0`: a successful DELETE would yield 0;
    // RLS denial leaves the single seeded row intact.
    expect(data).toHaveLength(1);
  });
});
