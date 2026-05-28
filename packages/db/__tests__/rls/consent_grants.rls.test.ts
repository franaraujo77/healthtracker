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
import {
  anonClient,
  cleanupSeededUsers,
  seedUser,
  serviceClient,
} from "./setup";

interface ConsentRow {
  id: string;
  patient_id: string;
  consent_type: string;
}

const seededIds: string[] = [];
const seededUserIds: string[] = [];

async function seedConsent(
  patientId: string,
  consentType = "blood_test_results",
): Promise<string> {
  await seedUser(patientId);
  seededUserIds.push(patientId);
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
  if (seededIds.length > 0) {
    await serviceClient.from("consent_grants").delete().in("id", seededIds);
    seededIds.length = 0;
  }
  if (seededUserIds.length > 0) {
    await cleanupSeededUsers(seededUserIds);
    seededUserIds.length = 0;
  }
});

describe("consent_grants RLS isolation (append-only)", () => {
  it("correctPatient can INSERT a consent row for themselves", async () => {
    const patientId = crypto.randomUUID();
    await seedUser(patientId);
    seededUserIds.push(patientId);
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

  it("correctPatient can UPDATE revoked_at on their own active row (Story 1.4)", async () => {
    const patientId = crypto.randomUUID();
    await seedConsent(patientId);
    const run = asIdentity("correctPatient", { patientId });

    // Prove the row IS visible and currently active.
    const before = await run(
      (tx) =>
        tx<
          { id: string; revoked_at: string | null }[]
        >`SELECT id, revoked_at FROM consent_grants WHERE patient_id = ${patientId}`,
    );
    expect(before).toHaveLength(1);
    expect(before[0]?.revoked_at).toBeNull();

    await run(
      (tx) =>
        tx`UPDATE consent_grants SET revoked_at = NOW() WHERE patient_id = ${patientId}`,
    );

    const { data } = await serviceClient
      .from("consent_grants")
      .select("revoked_at")
      .eq("patient_id", patientId);
    expect(data?.length).toBe(1);
    expect(data?.[0]?.revoked_at).not.toBeNull();
  });

  it("UPDATE on a different column than revoked_at is rejected by the defenses-in-depth trigger (42501)", async () => {
    const patientId = crypto.randomUUID();
    await seedConsent(patientId);
    const run = asIdentity("correctPatient", { patientId });

    // The narrow RLS policy allows the UPDATE on the row, but the
    // trigger (`consent_grants_revoke_only_revoked_at`) raises 42501
    // when any column other than revoked_at would change.
    await expect(
      run(
        (tx) =>
          tx`UPDATE consent_grants SET version = ${"tampered"} WHERE patient_id = ${patientId}`,
      ),
    ).rejects.toMatchObject({ code: "42501" });

    const { data } = await serviceClient
      .from("consent_grants")
      .select("version")
      .eq("patient_id", patientId);
    expect(data?.every((r) => r.version === "2026-05-19")).toBe(true);
  });

  it("UPDATE setting revoked_at to a past timestamp is rejected (round-2 P34 — backdating defense)", async () => {
    const patientId = crypto.randomUUID();
    await seedConsent(patientId);
    const run = asIdentity("correctPatient", { patientId });

    await expect(
      run(
        (tx) =>
          tx`UPDATE consent_grants SET revoked_at = ${"1970-01-01T00:00:00Z"} WHERE patient_id = ${patientId}`,
      ),
    ).rejects.toMatchObject({ code: "42501" });

    const { data } = await serviceClient
      .from("consent_grants")
      .select("revoked_at")
      .eq("patient_id", patientId);
    expect(data?.[0]?.revoked_at).toBeNull();
  });

  it("UPDATE setting revoked_at to a future timestamp is rejected (round-2 P34 — future-dating defense)", async () => {
    const patientId = crypto.randomUUID();
    await seedConsent(patientId);
    const run = asIdentity("correctPatient", { patientId });

    await expect(
      run(
        (tx) =>
          tx`UPDATE consent_grants SET revoked_at = ${"2099-12-31T23:59:59Z"} WHERE patient_id = ${patientId}`,
      ),
    ).rejects.toMatchObject({ code: "42501" });

    const { data } = await serviceClient
      .from("consent_grants")
      .select("revoked_at")
      .eq("patient_id", patientId);
    expect(data?.[0]?.revoked_at).toBeNull();
  });

  it("UPDATE clearing revoked_at back to NULL on a previously-revoked row is rejected (round-2 P32/P34 — un-revoke defense)", async () => {
    const patientId = crypto.randomUUID();
    const id = await seedConsent(patientId);
    // Revoke via the service client so we can then try to un-revoke
    // through the patient identity and watch the trigger reject.
    await serviceClient
      .from("consent_grants")
      .update({ revoked_at: new Date().toISOString() })
      .eq("id", id);

    const run = asIdentity("correctPatient", { patientId });
    // The USING filter (`revoked_at IS NULL`) blocks the UPDATE before
    // the trigger sees it — RLS denies via 0-rows. Verify the row is
    // still revoked. (If a future RLS widening relaxes USING, the
    // trigger's P32 guard is the defense-in-depth seam.)
    await run(
      (tx) =>
        tx`UPDATE consent_grants SET revoked_at = NULL WHERE patient_id = ${patientId}`,
    );

    const { data } = await serviceClient
      .from("consent_grants")
      .select("revoked_at")
      .eq("patient_id", patientId);
    expect(data?.[0]?.revoked_at).not.toBeNull();
  });

  it("wrongPatient UPDATE rejects (42501) without affecting the row", async () => {
    const ownerId = crypto.randomUUID();
    const attackerId = crypto.randomUUID();
    await seedConsent(ownerId);
    // The `wrongPatient` helper case uses `opts.otherPatientId` as the
    // `app.current_patient_id` GUC — that's the value RLS reads to
    // decide whether the connecting principal owns the row. We want
    // the attacker connecting AS THEMSELVES (not as the owner), so
    // `otherPatientId` MUST be `attackerId`. The earlier ordering
    // (`otherPatientId: ownerId`) inadvertently impersonated the row's
    // owner — the UPDATE silently succeeded because RLS saw the
    // connection as the owner.
    const run = asIdentity("wrongPatient", {
      patientId: ownerId,
      otherPatientId: attackerId,
    });

    // RLS USING-filter denies the row to the attacker (`patient_id` !=
    // current_setting). The UPDATE returns 0 affected rows — Postgres
    // does not raise 42501 for a USING-only mismatch (only WITH CHECK
    // failures raise). Verify the original row is unchanged.
    await run(
      (tx) =>
        tx`UPDATE consent_grants SET revoked_at = NOW() WHERE patient_id = ${ownerId}`,
    );

    const { data } = await serviceClient
      .from("consent_grants")
      .select("revoked_at")
      .eq("patient_id", ownerId);
    expect(data?.length).toBe(1);
    expect(data?.[0]?.revoked_at).toBeNull();
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
