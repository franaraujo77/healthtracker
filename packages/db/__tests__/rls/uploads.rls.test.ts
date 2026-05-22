/**
 * RLS adversarial test matrix for the `uploads` table (Story 1.5).
 * Requires: `supabase start` (Supabase CLI). Do NOT include in `pnpm test`.
 *
 * Mirrors the `consent_grants.rls.test.ts` and `audit_log.rls.test.ts`
 * matrices:
 *   - INSERT WITH CHECK: own allowed, foreign rejected with Postgres 42501.
 *   - SELECT: own rows only.
 *   - UPDATE / DELETE: prove visibility under correctPatient first, then
 *     assert the operation is a no-op (no UPDATE/DELETE policy exists;
 *     Epic 2 will add a narrow service-role UPDATE policy for state-
 *     machine transitions).
 *   - Idempotency UNIQUE: a duplicate `idempotency_key` from the same
 *     patient must violate the UNIQUE constraint (Postgres 23505), not RLS.
 */
import { afterEach, describe, expect, it } from "vitest";

import { asIdentity } from "./helpers";
import { anonClient, serviceClient } from "./setup";

interface UploadRow {
  id: string;
  patient_id: string;
  status: string;
}

const seededIds: string[] = [];

async function seedUpload(
  patientId: string,
  idempotencyKey = crypto.randomUUID(),
): Promise<string> {
  const id = crypto.randomUUID();
  const { error } = await serviceClient.from("uploads").insert({
    id,
    patient_id: patientId,
    idempotency_key: idempotencyKey,
    storage_path: `${patientId}/${idempotencyKey}/exam.pdf`,
    mime_type: "application/pdf",
    size_bytes: 1024,
    original_filename: "exam.pdf",
    source: "onboarding_import",
    status: "queued",
  });
  if (error) throw new Error(`upload seed failed: ${error.message}`);
  seededIds.push(id);
  return id;
}

afterEach(async () => {
  if (seededIds.length === 0) return;
  await serviceClient.from("uploads").delete().in("id", seededIds);
  seededIds.length = 0;
});

describe("uploads RLS isolation (append-only at patient layer)", () => {
  it("correctPatient can INSERT an upload row for themselves", async () => {
    const patientId = crypto.randomUUID();
    const idempotencyKey = crypto.randomUUID();
    const run = asIdentity("correctPatient", { patientId });

    const inserted = await run(
      (tx) => tx<{ id: string }[]>`
        INSERT INTO uploads (
          patient_id, idempotency_key, storage_path, mime_type,
          size_bytes, original_filename, source, status
        )
        VALUES (
          ${patientId}, ${idempotencyKey},
          ${`${patientId}/${idempotencyKey}/exam.pdf`},
          ${"application/pdf"}, ${1024}, ${"exam.pdf"},
          ${"onboarding_import"}, ${"queued"}
        )
        RETURNING id
      `,
    );

    expect(inserted).toHaveLength(1);
    if (inserted[0]) seededIds.push(inserted[0].id);
  });

  it("WITH CHECK blocks INSERT with a foreign patient_id (Postgres 42501)", async () => {
    const patientId = crypto.randomUUID();
    const foreignPatientId = crypto.randomUUID();
    const idempotencyKey = crypto.randomUUID();
    const run = asIdentity("correctPatient", { patientId });

    await expect(
      run(
        (tx) => tx`
          INSERT INTO uploads (
            patient_id, idempotency_key, storage_path, mime_type,
            size_bytes, original_filename, source, status
          )
          VALUES (
            ${foreignPatientId}, ${idempotencyKey},
            ${`${foreignPatientId}/${idempotencyKey}/exam.pdf`},
            ${"application/pdf"}, ${1024}, ${"exam.pdf"},
            ${"onboarding_import"}, ${"queued"}
          )
        `,
      ),
    ).rejects.toMatchObject({ code: "42501" });
  });

  it("idempotency_key UNIQUE rejects a duplicate INSERT from the same patient (Postgres 23505)", async () => {
    const patientId = crypto.randomUUID();
    const idempotencyKey = crypto.randomUUID();
    await seedUpload(patientId, idempotencyKey);
    const run = asIdentity("correctPatient", { patientId });

    await expect(
      run(
        (tx) => tx`
          INSERT INTO uploads (
            patient_id, idempotency_key, storage_path, mime_type,
            size_bytes, original_filename, source, status
          )
          VALUES (
            ${patientId}, ${idempotencyKey},
            ${`${patientId}/${idempotencyKey}/exam2.pdf`},
            ${"application/pdf"}, ${512}, ${"exam2.pdf"},
            ${"onboarding_import"}, ${"queued"}
          )
        `,
      ),
    ).rejects.toMatchObject({ code: "23505" });
  });

  it("wrongPatient sees zero rows even when other rows exist", async () => {
    await seedUpload(crypto.randomUUID());

    const run = asIdentity("wrongPatient", {
      patientId: crypto.randomUUID(),
      otherPatientId: crypto.randomUUID(),
    });
    const rows = await run(
      (tx) => tx<{ id: string }[]>`SELECT id FROM uploads`,
    );

    expect(rows).toEqual([]);
  });

  it("unauthenticated PostgREST request gets zero rows or an explicit error", async () => {
    await seedUpload(crypto.randomUUID());

    const { data, error } = await anonClient.from("uploads").select("id");

    if (error) {
      expect(error.code).toBeTruthy();
    } else {
      expect(data).toEqual([]);
    }
  });

  it("SELECT returns only the patient's own rows", async () => {
    const patientId = crypto.randomUUID();
    const otherPatientId = crypto.randomUUID();
    const ownId = await seedUpload(patientId);
    await seedUpload(otherPatientId);

    const run = asIdentity("correctPatient", { patientId });
    const rows = await run(
      (tx) => tx<UploadRow[]>`SELECT id, patient_id, status FROM uploads`,
    );

    expect(rows.map((r) => r.id)).toEqual([ownId]);
    expect(rows.every((r) => r.patient_id === patientId)).toBe(true);
  });

  it("UPDATE on own rows is denied at the patient layer (no UPDATE policy)", async () => {
    const patientId = crypto.randomUUID();
    await seedUpload(patientId);
    const run = asIdentity("correctPatient", { patientId });

    // Visibility-first: prove the row IS visible to this patient
    // before asserting the UPDATE no-op.
    const visible = await run(
      (tx) =>
        tx<
          { id: string }[]
        >`SELECT id FROM uploads WHERE patient_id = ${patientId}`,
    );
    expect(visible).toHaveLength(1);

    await run(
      (tx) =>
        tx`UPDATE uploads SET status = ${"complete"} WHERE patient_id = ${patientId}`,
    );

    const { data } = await serviceClient
      .from("uploads")
      .select("status")
      .eq("patient_id", patientId);
    expect(data?.every((r) => r.status === "queued")).toBe(true);
  });

  it("DELETE on own rows is denied (no DELETE policy → append-only at patient layer)", async () => {
    const patientId = crypto.randomUUID();
    await seedUpload(patientId);
    const run = asIdentity("correctPatient", { patientId });

    const visible = await run(
      (tx) =>
        tx<
          { id: string }[]
        >`SELECT id FROM uploads WHERE patient_id = ${patientId}`,
    );
    expect(visible).toHaveLength(1);

    await run((tx) => tx`DELETE FROM uploads WHERE patient_id = ${patientId}`);

    const { data } = await serviceClient
      .from("uploads")
      .select("id")
      .eq("patient_id", patientId);
    expect(data).toHaveLength(1);
  });
});
