/**
 * RLS adversarial test matrix for the `emotional_checkins` table
 * (Story 7.2).
 *
 * Requires: `supabase start` (Supabase CLI). Runs under
 * `test:integration` — NOT in `pnpm test`.
 *
 * 4-identity matrix per the Story 7.1 / 7.2 carry-over:
 *   - `correctPatient` — sees their own row
 *   - `wrongPatient` — sees zero rows (row-level isolation)
 *   - `doctorWithAccess` — sees zero rows (doctor-zero-rows
 *     invariant; NO doctor policy ships)
 *   - `doctorWithoutAccess` — sees zero rows (same invariant)
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

async function seedEmotionalCheckin(args: {
  patientId: string;
  uploadId?: string;
  state?: "hopeful" | "worried" | "curious" | "exhausted" | "unsure";
  type?: "pre" | "post";
}): Promise<string> {
  await seedUser(args.patientId);
  seededUserIds.push(args.patientId);
  const uploadId =
    args.uploadId ?? (await seedUploadForPatient(args.patientId));
  const id = crypto.randomUUID();
  const { error } = await serviceClient.from("emotional_checkins").insert({
    id,
    patient_id: args.patientId,
    upload_id: uploadId,
    state: args.state ?? "hopeful",
    type: args.type ?? "pre",
    privacy_flag: "patient_only",
  });
  if (error) {
    throw new Error(`emotional_checkin seed failed: ${error.message}`);
  }
  seededIds.push(id);
  return id;
}

afterEach(async () => {
  if (seededIds.length > 0) {
    await serviceClient.from("emotional_checkins").delete().in("id", seededIds);
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

describe("emotional_checkins table RLS — Story 7.2 patient surface", () => {
  it("correctPatient sees their own pre check-in row", async () => {
    const patientId = crypto.randomUUID();
    const seededId = await seedEmotionalCheckin({ patientId });
    const run = asIdentity("correctPatient", { patientId });

    const rows = await run(
      (tx) => tx<{ id: string }[]>`
        SELECT id FROM emotional_checkins
        WHERE patient_id = ${patientId}::uuid
      `,
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe(seededId);
  });

  it("wrongPatient sees zero rows from another patient (RLS isolation)", async () => {
    const patientId = crypto.randomUUID();
    const otherPatientId = crypto.randomUUID();
    await seedEmotionalCheckin({ patientId });
    const run = asIdentity("wrongPatient", {
      patientId,
      otherPatientId,
    });

    const rows = await run(
      (tx) => tx<{ id: string }[]>`
        SELECT id FROM emotional_checkins
        WHERE patient_id = ${patientId}::uuid
      `,
    );

    expect(rows).toHaveLength(0);
  });

  it("doctorWithAccess sees zero rows (doctor-zero-rows invariant — no doctor policy ships in 7.2)", async () => {
    const patientId = crypto.randomUUID();
    await seedEmotionalCheckin({ patientId });
    const run = asIdentity("doctorWithAccess", {
      patientId,
      shareToken: crypto.randomUUID(),
    });

    const rows = await run(
      (tx) => tx<{ id: string }[]>`
        SELECT id FROM emotional_checkins
        WHERE patient_id = ${patientId}::uuid
      `,
    );

    expect(rows).toHaveLength(0);
  });

  it("doctorWithoutAccess sees zero rows (same invariant)", async () => {
    const patientId = crypto.randomUUID();
    await seedEmotionalCheckin({ patientId });
    const run = asIdentity("doctorWithoutAccess", { patientId });

    const rows = await run(
      (tx) => tx<{ id: string }[]>`
        SELECT id FROM emotional_checkins
        WHERE patient_id = ${patientId}::uuid
      `,
    );

    expect(rows).toHaveLength(0);
  });

  // Story 7.3 AC8 — the post-row 4-identity matrix. Same denial
  // shape as the pre-row tests above; the discriminator is the
  // `type='post'` seeded value.
  describe("type='post' (Story 7.3)", () => {
    it("correctPatient sees their own post check-in row", async () => {
      const patientId = crypto.randomUUID();
      const seededId = await seedEmotionalCheckin({ patientId, type: "post" });
      const run = asIdentity("correctPatient", { patientId });

      const rows = await run(
        (tx) => tx<{ id: string }[]>`
          SELECT id FROM emotional_checkins
          WHERE patient_id = ${patientId}::uuid AND type = 'post'
        `,
      );

      expect(rows).toHaveLength(1);
      expect(rows[0]?.id).toBe(seededId);
    });

    it("wrongPatient sees zero post rows (RLS isolation holds for both types)", async () => {
      const patientId = crypto.randomUUID();
      const otherPatientId = crypto.randomUUID();
      await seedEmotionalCheckin({ patientId, type: "post" });
      const run = asIdentity("wrongPatient", { patientId, otherPatientId });

      const rows = await run(
        (tx) => tx<{ id: string }[]>`
          SELECT id FROM emotional_checkins
          WHERE patient_id = ${patientId}::uuid AND type = 'post'
        `,
      );

      expect(rows).toHaveLength(0);
    });

    it("doctorWithAccess sees zero post rows (denial-by-RLS-absence covers both types)", async () => {
      const patientId = crypto.randomUUID();
      await seedEmotionalCheckin({ patientId, type: "post" });
      const run = asIdentity("doctorWithAccess", {
        patientId,
        shareToken: crypto.randomUUID(),
      });

      const rows = await run(
        (tx) => tx<{ id: string }[]>`
          SELECT id FROM emotional_checkins
          WHERE patient_id = ${patientId}::uuid AND type = 'post'
        `,
      );

      expect(rows).toHaveLength(0);
    });

    it("doctorWithoutAccess sees zero post rows", async () => {
      const patientId = crypto.randomUUID();
      await seedEmotionalCheckin({ patientId, type: "post" });
      const run = asIdentity("doctorWithoutAccess", { patientId });

      const rows = await run(
        (tx) => tx<{ id: string }[]>`
          SELECT id FROM emotional_checkins
          WHERE patient_id = ${patientId}::uuid AND type = 'post'
        `,
      );

      expect(rows).toHaveLength(0);
    });
  });
});
