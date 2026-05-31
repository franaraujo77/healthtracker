/**
 * RLS adversarial test matrix for the `life_events` table (Story 7.1).
 *
 * Requires: `supabase start` (Supabase CLI). Do NOT include in
 * `pnpm test` — runs under `test:integration`.
 *
 * 4-identity matrix per the story carry-over:
 *   - `correctPatient` — sees their own row
 *   - `wrongPatient` — sees zero rows (row-level isolation)
 *   - `doctorWithAccess` — sees zero rows (doctor-zero-rows invariant,
 *      NO doctor policy ships in 7.1; doctor sessions get nothing)
 *   - `doctorWithoutAccess` — sees zero rows (same invariant)
 */
import { afterEach, describe, expect, it } from "vitest";

import { asIdentity } from "./helpers";
import { cleanupSeededUsers, seedUser, serviceClient } from "./setup";

const seededIds: string[] = [];
const seededUserIds: string[] = [];

async function seedLifeEvent(args: {
  patientId: string;
  eventDate?: string;
  description?: string;
  category?:
    | "health"
    | "lifestyle"
    | "travel"
    | "stress"
    | "medication"
    | "other";
}): Promise<string> {
  await seedUser(args.patientId);
  seededUserIds.push(args.patientId);
  const id = crypto.randomUUID();
  const { error } = await serviceClient.from("life_events").insert({
    id,
    patient_id: args.patientId,
    event_date: args.eventDate ?? "2024-06-01",
    description: args.description ?? "comecei nova rotina",
    category: args.category ?? "lifestyle",
    privacy_flag: "patient_only",
  });
  if (error) throw new Error(`life_event seed failed: ${error.message}`);
  seededIds.push(id);
  return id;
}

afterEach(async () => {
  if (seededIds.length > 0) {
    await serviceClient.from("life_events").delete().in("id", seededIds);
    seededIds.length = 0;
  }
  if (seededUserIds.length > 0) {
    await cleanupSeededUsers(seededUserIds);
    seededUserIds.length = 0;
  }
});

describe("life_events table RLS — Story 7.1 patient surface", () => {
  it("correctPatient sees their own life-event rows", async () => {
    const patientId = crypto.randomUUID();
    const seededId = await seedLifeEvent({ patientId });
    const run = asIdentity("correctPatient", { patientId });

    const rows = await run(
      (tx) => tx<{ id: string }[]>`
        SELECT id FROM life_events
        WHERE patient_id = ${patientId}::uuid
      `,
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe(seededId);
  });

  it("wrongPatient sees zero rows from another patient (RLS isolation)", async () => {
    const patientId = crypto.randomUUID();
    const otherPatientId = crypto.randomUUID();
    await seedLifeEvent({ patientId });
    const run = asIdentity("wrongPatient", {
      patientId,
      otherPatientId,
    });

    const rows = await run(
      (tx) => tx<{ id: string }[]>`
        SELECT id FROM life_events
        WHERE patient_id = ${patientId}::uuid
      `,
    );

    expect(rows).toHaveLength(0);
  });

  // PR R1 fix — the legacy `doctorWithAccess` / `doctorWithoutAccess`
  // helpers set `app.current_patient_id` to the target patient (they
  // were designed for sharing-table tests that gate on additional
  // GUCs). For Epic 7's denial-by-RLS-absence pattern, the correct
  // identity is `doctorWithActiveToken` (Story 6.5 staleness_thresholds
  // precedent) which binds `app.current_share_token_id` +
  // `app.current_doctor_user_id` but NEVER `app.current_patient_id`.
  // The policy predicate `patient_id::text = current_setting(
  // 'app.current_patient_id', true)` then evaluates to NULL → row
  // filtered out, locking the doctor-zero-rows invariant.
  it("doctorWithActiveToken sees zero rows (doctor-zero-rows invariant — no doctor policy ships in 7.1)", async () => {
    const patientId = crypto.randomUUID();
    await seedLifeEvent({ patientId });
    const run = asIdentity("doctorWithActiveToken", {
      patientId,
      shareTokenId: crypto.randomUUID(),
      doctorUserId: crypto.randomUUID(),
    });

    const rows = await run(
      (tx) => tx<{ id: string }[]>`
        SELECT id FROM life_events
        WHERE patient_id = ${patientId}::uuid
      `,
    );

    expect(rows).toHaveLength(0);
  });
});
