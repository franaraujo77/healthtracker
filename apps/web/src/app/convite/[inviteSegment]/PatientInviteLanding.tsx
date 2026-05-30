"use client";

import { RegisterForm } from "~/app/auth/register/register-form";

/**
 * Story 6.4 AC7 T5.5 — wraps the existing `<RegisterForm>` with the
 * invite context threaded as props. Client component because
 * `<RegisterForm>` itself is client-side (Supabase auth signUp +
 * TanStack Form + tRPC mutation all run client-side).
 *
 * The form's `initializeProfile` mutation receives
 * `{ inviteId, tokenHmac }` from these props; the server-side helper
 * `resolvePatientInviteWithinTx` flips the `patient_invites` row to
 * `status='resolved'` and emits the `patient_invite.resolved` audit
 * row atomically inside the existing registration tx.
 *
 * If the invite was concurrently revoked between the landing page
 * load and the form submit, the server-side helper silently no-ops
 * (registration completes unattributed). The landing page does NOT
 * re-poll for invite state — the seam is acceptable for MVP.
 */
export interface PatientInviteLandingProps {
  inviteId: string;
  tokenHmac: string;
}

export function PatientInviteLanding(
  props: PatientInviteLandingProps,
): React.ReactElement {
  return <RegisterForm inviteId={props.inviteId} tokenHmac={props.tokenHmac} />;
}
