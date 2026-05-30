-- custom_rls_patient_invites.sql
-- Story 6.4 — RLS for the `patient_invites` table (AC9).
--
-- **Doctor → patient acquisition surface.** Doctor (creator) reads/
-- writes own rows; the patient claiming the invite UPDATEs the row to
-- `status='resolved'` under their own session (inside the
-- `initializeProfile` tx) via the second clause of the UPDATE policy.
--
-- The doctor principal is bound by `app.current_doctor_user_id` (the
-- same GUC introduced by Story 6.3 for `professionals`). Patient-side
-- writes ride on Supabase Auth's `auth.uid()` because the new patient's
-- own session is active at claim time.
--
-- ** NO patient SELECT policy** — patients do not need read access to
-- their referrer-attribution row; the Início referrer surface (T5.6)
-- reads it via the service-role-bound `accountRouter` resolver path.
--
-- Service-role bypass for worker / admin paths.
--
-- Apply: `psql -f packages/db/policies/custom_rls_patient_invites.sql`

ALTER TABLE "patient_invites" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "patient_invites_select_own" ON "patient_invites";
CREATE POLICY "patient_invites_select_own" ON "patient_invites"
  FOR SELECT
  USING (
    professional_user_id::text =
      current_setting('app.current_doctor_user_id', true)
  );

DROP POLICY IF EXISTS "patient_invites_insert_own" ON "patient_invites";
CREATE POLICY "patient_invites_insert_own" ON "patient_invites"
  FOR INSERT
  WITH CHECK (
    professional_user_id::text =
      current_setting('app.current_doctor_user_id', true)
  );

-- UPDATE: either the doctor (revoke flow, deferred) OR the
-- claiming-patient (inside initializeProfile). The patient-claim
-- branch is racing-revoke-safe via the application's WHERE
-- `status='pending'` predicate.
DROP POLICY IF EXISTS "patient_invites_update_own_or_resolving_patient"
  ON "patient_invites";
CREATE POLICY "patient_invites_update_own_or_resolving_patient"
  ON "patient_invites"
  FOR UPDATE
  USING (
    professional_user_id::text =
      current_setting('app.current_doctor_user_id', true)
    OR (
      status = 'pending'
      AND revoked_at IS NULL
      AND expires_at > now()
    )
  )
  WITH CHECK (
    professional_user_id::text =
      current_setting('app.current_doctor_user_id', true)
    OR (
      status = 'resolved'
      AND resolved_user_id::text =
        current_setting('app.current_patient_id', true)
    )
  );

DROP POLICY IF EXISTS "patient_invites_service_role_all" ON "patient_invites";
CREATE POLICY "patient_invites_service_role_all" ON "patient_invites"
  FOR ALL
  USING (
    current_setting('app.current_user_role', true) = 'service_role'
  )
  WITH CHECK (
    current_setting('app.current_user_role', true) = 'service_role'
  );
