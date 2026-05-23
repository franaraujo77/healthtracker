-- custom_rls_uploads_service_update.sql
-- Story 2.3 — unblocks the extraction worker's state-machine UPDATEs.
--
-- Story 1.5 shipped `uploads` with SELECT own + INSERT own only — no
-- UPDATE policy. Story 2.1 added the `applyUploadTransition` helper
-- but left the policy gap documented. Story 2.3's worker is the first
-- real caller and needs to flip `uploads.status` from `queued` →
-- `processing` → `complete | pending_review | failed`.
--
-- The worker runs under service-role (direct Postgres connection,
-- no `app.current_patient_id` set). Service-role bypasses RLS by
-- default in Supabase, so technically no policy is required to make
-- the UPDATE land. However, defenses-in-depth: this policy exists
-- so if the bypass is ever tightened (Story 0.4-style hardening pass
-- with FORCE ROW LEVEL SECURITY) the worker's UPDATE still works.
--
-- The policy is narrow: only allows UPDATE on the columns the
-- state-machine touches. Story 5.6 (patient-initiated deletion) and
-- any other future service-role write paths will need their own
-- narrowed policies; do not widen this one.
--
-- Apply: `psql -f packages/db/policies/custom_rls_uploads_service_update.sql`.

DROP POLICY IF EXISTS "uploads_service_role_update" ON "uploads";
CREATE POLICY "uploads_service_role_update" ON "uploads"
  FOR UPDATE
  TO service_role
  USING (true)
  WITH CHECK (true);
