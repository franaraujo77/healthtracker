-- custom_rls_notification_preferences.sql
-- Story 2.8 — RLS for the `notification_preferences` table.
--
-- Patient layer:
--   - SELECT own
--   - INSERT own (first-time toggle UPSERTs the row)
--   - UPDATE own (subsequent toggles)
--   - NO DELETE — a patient who wants to "reset" toggles re-UPSERTs
--     the default-true values.
--
-- Service-role bypasses RLS; the worker reads preferences at
-- dispatch time to decide whether to skip the Expo Push POST.
--
-- Apply: `psql -f packages/db/policies/custom_rls_notification_preferences.sql`.

ALTER TABLE "notification_preferences" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "notification_preferences_select_own"
  ON "notification_preferences";
CREATE POLICY "notification_preferences_select_own"
  ON "notification_preferences"
  FOR SELECT
  USING (
    patient_id::text = current_setting('app.current_patient_id', true)
  );

DROP POLICY IF EXISTS "notification_preferences_insert_own"
  ON "notification_preferences";
CREATE POLICY "notification_preferences_insert_own"
  ON "notification_preferences"
  FOR INSERT
  WITH CHECK (
    patient_id::text = current_setting('app.current_patient_id', true)
  );

DROP POLICY IF EXISTS "notification_preferences_update_own"
  ON "notification_preferences";
CREATE POLICY "notification_preferences_update_own"
  ON "notification_preferences"
  FOR UPDATE
  USING (
    patient_id::text = current_setting('app.current_patient_id', true)
  )
  WITH CHECK (
    patient_id::text = current_setting('app.current_patient_id', true)
  );

-- Defense-in-depth: revoke broad grants; only `authenticated` gets
-- the narrow surface the policies above enforce.
REVOKE ALL ON "notification_preferences" FROM PUBLIC;
REVOKE ALL ON "notification_preferences" FROM "anon";
GRANT SELECT, INSERT, UPDATE ON "notification_preferences" TO "authenticated";
