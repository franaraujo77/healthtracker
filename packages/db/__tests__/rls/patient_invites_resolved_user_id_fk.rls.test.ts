/**
 * Story 6.4 T7.2 — regression test that locks the
 * `patient_invites.resolved_user_id` FK's `onDelete: "set null"`
 * semantics.
 *
 * **SECOND documented exception** to Story 5.6's cascade rule (the
 * first is `pending_invites.resolved_user_id`, Story 6.3). When the
 * patient who claimed the invite later deletes their account, the
 * doctor's referral telemetry must SURVIVE — only the linkage breaks.
 * Cascading would silently delete doctor-authored data on a patient
 * action, which is directionally wrong.
 *
 * Future maintainers skimming Story 5.6's cascade rule will reflexively
 * "fix" this exception unless a regression test makes the choice
 * load-bearing. CI fails if a refactor flips it to cascade.
 *
 * Requires: `supabase start`.
 */
import { afterEach, describe, expect, it } from "vitest";

import { cleanupSeededUsers, seedUser, serviceClient } from "./setup";

const seededUserIds: string[] = [];
const seededInviteIds: string[] = [];

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

describe("patient_invites.resolved_user_id FK — Story 6.4 AC4 cascade-rule exception #2", () => {
  it("patient account deletion sets resolved_user_id to NULL — invite row survives", async () => {
    const doctorUserId = crypto.randomUUID();
    const patientUserId = crypto.randomUUID();
    const inviteId = crypto.randomUUID();

    await seedUser(doctorUserId);
    seededUserIds.push(doctorUserId);
    await seedUser(patientUserId);
    // Don't push patientUserId — we delete it manually below.

    // Seed the doctor's professional row first (FK target).
    const { error: profErr } = await serviceClient
      .from("professionals")
      .insert({
        user_id: doctorUserId,
        display_name: "Dr. Inviter",
        category: "clinico_geral",
      });
    if (profErr) {
      throw new Error(`professionals seed failed: ${profErr.message}`);
    }

    const { error: inviteErr } = await serviceClient
      .from("patient_invites")
      .insert({
        id: inviteId,
        professional_user_id: doctorUserId,
        identifier_hash: "a".repeat(64),
        identifier_kind: "email",
        token_hmac: `hmac-${inviteId}`,
        resolved_user_id: patientUserId,
        status: "resolved",
      });
    if (inviteErr) {
      throw new Error(`patient_invites seed failed: ${inviteErr.message}`);
    }
    seededInviteIds.push(inviteId);

    // Sanity: row exists with resolved_user_id populated.
    const before = await serviceClient
      .from("patient_invites")
      .select("id, resolved_user_id")
      .eq("id", inviteId)
      .single();
    expect(before.error).toBeNull();
    expect(before.data?.resolved_user_id).toBe(patientUserId);

    // Delete the patient user — FK `onDelete: "set null"` MUST nullify
    // the invite's resolved_user_id WITHOUT deleting the row.
    const { error: delErr } = await serviceClient
      .from("users")
      .delete()
      .eq("id", patientUserId);
    if (delErr) {
      throw new Error(`users delete failed: ${delErr.message}`);
    }

    const after = await serviceClient
      .from("patient_invites")
      .select("id, resolved_user_id, professional_user_id")
      .eq("id", inviteId)
      .single();
    expect(after.error).toBeNull();
    // The invite row MUST survive — load-bearing assertion.
    expect(after.data).not.toBeNull();
    // resolved_user_id MUST be NULL after the patient's deletion.
    expect(after.data?.resolved_user_id).toBeNull();
    // professional_user_id is untouched.
    expect(after.data?.professional_user_id).toBe(doctorUserId);
  });
});
