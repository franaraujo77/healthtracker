-- custom_rls_emotional_checkins.sql
-- Story 7.2 — RLS for the `emotional_checkins` table.
--
-- Patient layer:
--   - SELECT own: rows whose `patient_id` matches the bound GUC
--     (`app.current_patient_id`, set by `protectedProcedure`).
--   - INSERT own: same predicate via WITH CHECK.
--   - UPDATE / DELETE: NONE — Story 7.2 is create-only.
--
-- **Doctor-zero-rows invariant.** No doctor policy ships with this
-- table. Mirrors Story 7.1's `life_events`: the Epic 7 privacy
-- backbone (FR47) requires explicit opt-in before any doctor surface
-- reads personal-context tables. Until then, `doctorProcedure` /
-- share-token-principal sessions get zero rows because no policy
-- permits them to. Enforced by ABSENCE of a policy — `privacy_flag`
-- is metadata for a future surface, NOT a defense.
--
-- Apply: `psql -f packages/db/policies/custom_rls_emotional_checkins.sql`

ALTER TABLE "emotional_checkins" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "emotional_checkins_select_own" ON "emotional_checkins";
CREATE POLICY "emotional_checkins_select_own" ON "emotional_checkins"
  FOR SELECT
  USING (
    patient_id::text = current_setting('app.current_patient_id', true)
  );

DROP POLICY IF EXISTS "emotional_checkins_insert_own" ON "emotional_checkins";
CREATE POLICY "emotional_checkins_insert_own" ON "emotional_checkins"
  FOR INSERT
  WITH CHECK (
    patient_id::text = current_setting('app.current_patient_id', true)
  );
