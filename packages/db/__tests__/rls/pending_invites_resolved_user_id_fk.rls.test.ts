/**
 * Story 6.3 T6.2 — regression test that locks the
 * `pending_invites.resolved_user_id` FK's `onDelete: "set null"`
 * semantics.
 *
 * **Why this test exists.** Story 5.6 establishes the cascade rule:
 * every NEW FK to `users(id)` MUST use `onDelete: 'cascade'`.
 * Story 6.3 lands the FIRST documented exception — `resolved_user_id`
 * uses `set null` instead, because the `pending_invites` row encodes
 * the patient's intent ("I wanted to share with Dr. X") and must
 * survive the doctor deleting their account. Future maintainers
 * skimming the rule will reflexively "fix" the exception unless a
 * regression test makes the choice load-bearing.
 *
 * Test: insert pending_invite with resolved_user_id pointing at a
 * doctor user → DELETE the doctor user → assert the invite row
 * SURVIVES and its `resolved_user_id` is now NULL.
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
      .from("pending_invites")
      .delete()
      .in("id", seededInviteIds);
    seededInviteIds.length = 0;
  }
  if (seededUserIds.length > 0) {
    await cleanupSeededUsers(seededUserIds);
    seededUserIds.length = 0;
  }
});

describe("pending_invites.resolved_user_id FK — Story 6.3 AC9 cascade-rule exception", () => {
  it("doctor account deletion sets resolved_user_id to NULL — invite row survives", async () => {
    const patientId = crypto.randomUUID();
    const doctorUserId = crypto.randomUUID();
    const inviteId = crypto.randomUUID();

    await seedUser(patientId);
    seededUserIds.push(patientId);
    await seedUser(doctorUserId);
    // Don't push doctorUserId — we delete it manually below.

    const { error: insertErr } = await serviceClient
      .from("pending_invites")
      .insert({
        id: inviteId,
        patient_id: patientId,
        display_name: "Dra. Doomed",
        identifier_hash: "d".repeat(64),
        resolved_user_id: doctorUserId,
      });
    if (insertErr) {
      throw new Error(`pending_invites seed failed: ${insertErr.message}`);
    }
    seededInviteIds.push(inviteId);

    // Sanity: row exists with resolved_user_id populated.
    const before = await serviceClient
      .from("pending_invites")
      .select("id, resolved_user_id")
      .eq("id", inviteId)
      .single();
    expect(before.error).toBeNull();
    expect(before.data?.resolved_user_id).toBe(doctorUserId);

    // Delete the doctor user — FK `onDelete: "set null"` MUST nullify
    // the invite's resolved_user_id WITHOUT deleting the invite row.
    const { error: delErr } = await serviceClient
      .from("users")
      .delete()
      .eq("id", doctorUserId);
    if (delErr) {
      throw new Error(`users delete failed: ${delErr.message}`);
    }

    const after = await serviceClient
      .from("pending_invites")
      .select("id, resolved_user_id, patient_id")
      .eq("id", inviteId)
      .single();
    expect(after.error).toBeNull();
    // The invite row MUST survive — cascade would have deleted it,
    // erasing the patient's authored intent on a third-party doctor
    // action. This is the load-bearing assertion.
    expect(after.data).not.toBeNull();
    // resolved_user_id MUST be NULL after the doctor's deletion.
    expect(after.data?.resolved_user_id).toBeNull();
    // patient_id is untouched (sanity).
    expect(after.data?.patient_id).toBe(patientId);
  });
});
