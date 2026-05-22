-- custom_rls_observations.sql
-- Story 2.3 — RLS for the `observations` table.
--
-- Patient layer: SELECT own only.
-- Writes (INSERT / UPDATE / DELETE): NONE at the patient layer.
--   - INSERTs come from the extraction worker (`services/extraction/`)
--     via service-role connection — service-role bypasses RLS.
--   - UPDATEs are not expected (append-only; correction means a new
--     row with `source = 'patient_corrected'`).
--   - DELETEs: Story 5.6 patient-deletion path (service-role).
--
-- Apply: `psql -f packages/db/policies/custom_rls_observations.sql`
-- (the team's convention; `drizzle-kit check` ignores `custom_` policies).

ALTER TABLE "observations" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "observations_select_own" ON "observations";
CREATE POLICY "observations_select_own" ON "observations"
  FOR SELECT
  USING (
    patient_id::text = current_setting('app.current_patient_id', true)
  );
