/**
 * RLS adversarial test matrix for the `voice_memos` table (Story 7.4).
 *
 * Requires: `supabase start` (Supabase CLI). Runs under
 * `test:integration` — NOT in `pnpm test`.
 *
 * 4-identity matrix per the Stories 7.1 / 7.2 carry-over:
 *   - `correctPatient` — sees their own row
 *   - `wrongPatient` — sees zero rows (row-level isolation)
 *   - `doctorWithAccess` — sees zero rows (doctor-zero-rows invariant)
 *   - `doctorWithoutAccess` — sees zero rows
 */
import { afterEach, describe, expect, it } from "vitest";

import { asIdentity } from "./helpers";
import { cleanupSeededUsers, seedUser, serviceClient } from "./setup";

const seededIds: string[] = [];
const seededUserIds: string[] = [];
const seededUploadIds: string[] = [];

async function seedUploadForPatient(patientId: string): Promise<string> {
  const uploadId = crypto.randomUUID();
  const { error } = await serviceClient.from("uploads").insert({
    id: uploadId,
    patient_id: patientId,
    idempotency_key: crypto.randomUUID(),
    storage_path: `${patientId}/${uploadId}.pdf`,
    mime_type: "application/pdf",
    size_bytes: 1024,
    original_filename: "test.pdf",
    source: "post_onboarding",
    status: "complete",
  });
  if (error) throw new Error(`uploads seed failed: ${error.message}`);
  seededUploadIds.push(uploadId);
  return uploadId;
}

async function seedVoiceMemo(args: {
  patientId: string;
  uploadId?: string;
}): Promise<string> {
  await seedUser(args.patientId);
  seededUserIds.push(args.patientId);
  const uploadId =
    args.uploadId ?? (await seedUploadForPatient(args.patientId));
  const id = crypto.randomUUID();
  const { error } = await serviceClient.from("voice_memos").insert({
    id,
    patient_id: args.patientId,
    upload_id: uploadId,
    storage_path: `${args.patientId}/${id}.m4a`,
    duration_ms: 5000,
    privacy_flag: "patient_only",
  });
  if (error) throw new Error(`voice_memo seed failed: ${error.message}`);
  seededIds.push(id);
  return id;
}

afterEach(async () => {
  if (seededIds.length > 0) {
    await serviceClient.from("voice_memos").delete().in("id", seededIds);
    seededIds.length = 0;
  }
  if (seededUploadIds.length > 0) {
    await serviceClient.from("uploads").delete().in("id", seededUploadIds);
    seededUploadIds.length = 0;
  }
  if (seededUserIds.length > 0) {
    await cleanupSeededUsers(seededUserIds);
    seededUserIds.length = 0;
  }
});

describe("voice_memos table RLS — Story 7.4 patient surface", () => {
  it("correctPatient sees their own voice memo row", async () => {
    const patientId = crypto.randomUUID();
    const seededId = await seedVoiceMemo({ patientId });
    const run = asIdentity("correctPatient", { patientId });

    const rows = await run(
      (tx) => tx<{ id: string }[]>`
        SELECT id FROM voice_memos
        WHERE patient_id = ${patientId}::uuid
      `,
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe(seededId);
  });

  it("wrongPatient sees zero rows from another patient", async () => {
    const patientId = crypto.randomUUID();
    const otherPatientId = crypto.randomUUID();
    await seedVoiceMemo({ patientId });
    const run = asIdentity("wrongPatient", { patientId, otherPatientId });

    const rows = await run(
      (tx) => tx<{ id: string }[]>`
        SELECT id FROM voice_memos
        WHERE patient_id = ${patientId}::uuid
      `,
    );

    expect(rows).toHaveLength(0);
  });

  it("doctorWithAccess sees zero rows (denial-by-RLS-absence)", async () => {
    const patientId = crypto.randomUUID();
    await seedVoiceMemo({ patientId });
    const run = asIdentity("doctorWithAccess", {
      patientId,
      shareToken: crypto.randomUUID(),
    });

    const rows = await run(
      (tx) => tx<{ id: string }[]>`
        SELECT id FROM voice_memos
        WHERE patient_id = ${patientId}::uuid
      `,
    );

    expect(rows).toHaveLength(0);
  });

  it("doctorWithoutAccess sees zero rows", async () => {
    const patientId = crypto.randomUUID();
    await seedVoiceMemo({ patientId });
    const run = asIdentity("doctorWithoutAccess", { patientId });

    const rows = await run(
      (tx) => tx<{ id: string }[]>`
        SELECT id FROM voice_memos
        WHERE patient_id = ${patientId}::uuid
      `,
    );

    expect(rows).toHaveLength(0);
  });
});
