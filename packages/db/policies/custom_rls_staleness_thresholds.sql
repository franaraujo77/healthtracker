-- custom_rls_staleness_thresholds.sql
-- Story 6.5 — RLS for the `staleness_thresholds` table (AC9).
--
-- **Doctor-only preference table.** No patient principal — patients
-- have no surface to introspect a doctor's staleness configuration.
--
-- Doctor principal binding uses the `app.current_doctor_user_id`
-- GUC (set by the new session-only professional procedure mirroring
-- Story 6.3's `doctorProcedure` pattern). The repo's RLS uses GUCs
-- instead of Supabase's `auth.uid()` so the same policies are testable
-- against the bare `postgres:16-alpine` testcontainer (which has no
-- `auth` schema).
--
-- NO DELETE policy — application layer does not expose a delete path
-- (AC4 deletion-semantics decision). A future "reset to default" UI
-- would add this policy then.
--
-- Apply: `psql -f packages/db/policies/custom_rls_staleness_thresholds.sql`

ALTER TABLE "staleness_thresholds" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "staleness_thresholds_select_own" ON "staleness_thresholds";
CREATE POLICY "staleness_thresholds_select_own" ON "staleness_thresholds"
  FOR SELECT
  USING (
    professional_user_id::text =
      current_setting('app.current_doctor_user_id', true)
  );

DROP POLICY IF EXISTS "staleness_thresholds_insert_own" ON "staleness_thresholds";
CREATE POLICY "staleness_thresholds_insert_own" ON "staleness_thresholds"
  FOR INSERT
  WITH CHECK (
    professional_user_id::text =
      current_setting('app.current_doctor_user_id', true)
  );

DROP POLICY IF EXISTS "staleness_thresholds_update_own" ON "staleness_thresholds";
CREATE POLICY "staleness_thresholds_update_own" ON "staleness_thresholds"
  FOR UPDATE
  USING (
    professional_user_id::text =
      current_setting('app.current_doctor_user_id', true)
  )
  WITH CHECK (
    professional_user_id::text =
      current_setting('app.current_doctor_user_id', true)
  );

-- DELETE policy intentionally omitted (see file header).

DROP POLICY IF EXISTS "staleness_thresholds_service_role_all"
  ON "staleness_thresholds";
CREATE POLICY "staleness_thresholds_service_role_all"
  ON "staleness_thresholds"
  FOR ALL
  USING (
    current_setting('app.current_user_role', true) = 'service_role'
  )
  WITH CHECK (
    current_setting('app.current_user_role', true) = 'service_role'
  );
