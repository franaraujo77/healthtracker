/**
 * Story 8.1 — RLS for the operator surface on `extraction_review_queue`.
 *
 * 5-identity matrix locking the anonymisation invariant (NFR-S7 / AR5):
 *   OPERATOR              — SEES `loinc_unresolved`; 0 rows of
 *                           `low_confidence`, `users`, `uploads`;
 *                           UPDATE/DELETE affect 0 rows (read-only 8.1).
 *   OWNING_PATIENT        — SEES own `low_confidence`; 0 rows of
 *                           `loinc_unresolved` (regression lock).
 *   OTHER_PATIENT         — 0 rows.
 *   DOCTOR_WITH_TOKEN     — 0 rows (no doctor policy — regression lock).
 *   SERVICE_ROLE          — full access (worker / seed path).
 *
 * The crown jewels are the OPERATOR assertions: the operator can read
 * the anonymised queue and NOTHING that carries PII. We assert "0 rows",
 * never "did not error" (denial-by-RLS-absence discipline).
 *
 * Requires: `supabase start` + applied
 * `custom_rls_extraction_review_queue.sql`. Per the Epic 6/7 retro
 * carry-forward, if testcontainers/Rancher is down locally, the
 * `rls-adversarial` GHA job runs this against a clean shadow DB.
 */
import { afterEach, describe, expect, it } from "vitest";

import { asIdentity } from "./helpers";
import { cleanupSeededUsers, seedUser, serviceClient } from "./setup";

const seededUserIds: string[] = [];

interface SeedResult {
  patientId: string;
  uploadId: string;
}

async function seedQueue(): Promise<SeedResult> {
  const patientId = crypto.randomUUID();
  await seedUser(patientId);
  seededUserIds.push(patientId);

  const uploadId = crypto.randomUUID();
  const { error: uploadErr } = await serviceClient.from("uploads").insert({
    id: uploadId,
    patient_id: patientId,
    idempotency_key: crypto.randomUUID(),
    storage_path: `lab_uploads/${patientId}/${uploadId}.pdf`,
    mime_type: "application/pdf",
    size_bytes: 1024,
    original_filename: "joao-silva-exame.pdf", // PII — operator must NEVER read this
    source: "post_onboarding",
  });
  if (uploadErr) throw new Error(`uploads seed failed: ${uploadErr.message}`);

  const { error: queueErr } = await serviceClient
    .from("extraction_review_queue")
    .insert([
      {
        patient_id: patientId,
        upload_id: uploadId,
        biomarker_name: "TSH",
        value_text: "2,4",
        unit_text: "mU/L",
        lab_name: "Lab A",
        collected_at_text: "2024-03-12",
        confidence_score: "0.95",
        reason: "loinc_unresolved",
      },
      {
        patient_id: patientId,
        upload_id: uploadId,
        biomarker_name: "Glicose",
        value_text: "99",
        unit_text: "mg/dL",
        lab_name: "Lab A",
        collected_at_text: "2024-03-12",
        confidence_score: "0.71",
        reason: "low_confidence",
      },
    ]);
  if (queueErr) throw new Error(`queue seed failed: ${queueErr.message}`);

  return { patientId, uploadId };
}

afterEach(async () => {
  if (seededUserIds.length > 0) {
    // Cascade FK on extraction_review_queue.patient_id + uploads.patient_id
    // reaps the child rows when the user is deleted.
    await cleanupSeededUsers(seededUserIds);
    seededUserIds.length = 0;
  }
});

describe("extraction_review_queue operator RLS — Story 8.1 / 5-identity matrix", () => {
  it("OPERATOR sees loinc_unresolved rows", async () => {
    const { patientId } = await seedQueue();
    const run = asIdentity("operator", { patientId });
    const rows = await run(
      (tx) => tx<{ reason: string }[]>`
        SELECT reason FROM extraction_review_queue
        WHERE reason = 'loinc_unresolved'
      `,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.reason).toBe("loinc_unresolved");
  });

  it("OPERATOR sees ZERO low_confidence rows (those are patient-only)", async () => {
    const { patientId } = await seedQueue();
    const run = asIdentity("operator", { patientId });
    const rows = await run(
      (tx) => tx<{ id: string }[]>`
        SELECT id FROM extraction_review_queue WHERE reason = 'low_confidence'
      `,
    );
    expect(rows).toHaveLength(0);
  });

  it("OPERATOR sees ZERO rows of `users` (anonymisation — no operator policy)", async () => {
    const { patientId } = await seedQueue();
    const run = asIdentity("operator", { patientId });
    const rows = await run(
      (tx) => tx<{ id: string }[]>`
        SELECT id FROM users WHERE id = ${patientId}::uuid
      `,
    );
    expect(rows).toHaveLength(0);
  });

  it("OPERATOR sees ZERO rows of `uploads` (anonymisation — original_filename PII never exposed)", async () => {
    const { patientId, uploadId } = await seedQueue();
    const run = asIdentity("operator", { patientId });
    const rows = await run(
      (tx) => tx<{ id: string }[]>`
        SELECT id FROM uploads WHERE id = ${uploadId}::uuid
      `,
    );
    expect(rows).toHaveLength(0);
  });

  it("OPERATOR UPDATE affects ZERO rows (read-only in 8.1 — no operator write policy)", async () => {
    const { patientId } = await seedQueue();
    const run = asIdentity("operator", { patientId });
    const rows = await run(
      (tx) => tx<{ id: string }[]>`
        UPDATE extraction_review_queue SET resolved_at = now()
        WHERE reason = 'loinc_unresolved'
        RETURNING id
      `,
    );
    expect(rows).toHaveLength(0);
  });

  it("OPERATOR DELETE affects ZERO rows (no operator delete policy)", async () => {
    const { patientId } = await seedQueue();
    const run = asIdentity("operator", { patientId });
    const rows = await run(
      (tx) => tx<{ id: string }[]>`
        DELETE FROM extraction_review_queue
        WHERE reason = 'loinc_unresolved'
        RETURNING id
      `,
    );
    expect(rows).toHaveLength(0);
  });

  it("OWNING_PATIENT sees own low_confidence row", async () => {
    const { patientId } = await seedQueue();
    const run = asIdentity("correctPatient", { patientId });
    const rows = await run(
      (tx) => tx<{ reason: string }[]>`
        SELECT reason FROM extraction_review_queue WHERE reason = 'low_confidence'
      `,
    );
    expect(rows).toHaveLength(1);
  });

  it("OWNING_PATIENT sees ZERO loinc_unresolved rows (regression lock — still invisible to patients)", async () => {
    const { patientId } = await seedQueue();
    const run = asIdentity("correctPatient", { patientId });
    const rows = await run(
      (tx) => tx<{ id: string }[]>`
        SELECT id FROM extraction_review_queue WHERE reason = 'loinc_unresolved'
      `,
    );
    expect(rows).toHaveLength(0);
  });

  it("OTHER_PATIENT sees ZERO rows", async () => {
    const { patientId } = await seedQueue();
    const run = asIdentity("wrongPatient", {
      patientId,
      otherPatientId: crypto.randomUUID(),
    });
    const rows = await run(
      (tx) => tx<{ id: string }[]>`
        SELECT id FROM extraction_review_queue
      `,
    );
    expect(rows).toHaveLength(0);
  });

  it("DOCTOR_WITH_TOKEN sees ZERO rows (no doctor policy on the review queue)", async () => {
    const { patientId } = await seedQueue();
    const run = asIdentity("doctorWithActiveToken", {
      patientId,
      shareTokenId: crypto.randomUUID(),
      doctorUserId: crypto.randomUUID(),
    });
    const rows = await run(
      (tx) => tx<{ id: string }[]>`
        SELECT id FROM extraction_review_queue
      `,
    );
    expect(rows).toHaveLength(0);
  });

  it("SERVICE_ROLE sees every row (worker / seed path bypasses RLS)", async () => {
    const { uploadId } = await seedQueue();
    const { data, error } = await serviceClient
      .from("extraction_review_queue")
      .select("reason")
      .eq("upload_id", uploadId);
    expect(error).toBeNull();
    expect((data ?? []).length).toBe(2);
  });
});
