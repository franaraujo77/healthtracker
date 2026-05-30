-- custom_rls_life_events.sql
-- Story 7.1 — RLS for the `life_events` table.
--
-- Patient layer:
--   - SELECT own: rows whose `patient_id` matches the bound GUC
--     (`app.current_patient_id`, set by `protectedProcedure`).
--   - INSERT own: same predicate via WITH CHECK so a patient cannot
--     forge a row attributed to another `patient_id`.
--   - UPDATE / DELETE: NONE — Story 7.1 is create-only (edit/delete
--     deferred to Story 7.x). Add narrowly-scoped policies when
--     that surface ships.
--
-- **Doctor-zero-rows invariant.** NO doctor policy ships with this
-- table. The Epic 7 privacy backbone (FR47) requires explicit opt-in
-- before any doctor surface can read life events; until that lands,
-- `doctorProcedure` / share-token-principal sessions get zero rows
-- because no policy permits them to. This is enforced by ABSENCE of
-- a policy — `privacy_flag` is metadata for the future surface, NOT
-- a defense.
--
-- Apply: `psql -f packages/db/policies/custom_rls_life_events.sql`
-- (team convention; `drizzle-kit check` ignores `custom_` policies).

ALTER TABLE "life_events" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "life_events_select_own" ON "life_events";
CREATE POLICY "life_events_select_own" ON "life_events"
  FOR SELECT
  USING (
    patient_id::text = current_setting('app.current_patient_id', true)
  );

DROP POLICY IF EXISTS "life_events_insert_own" ON "life_events";
CREATE POLICY "life_events_insert_own" ON "life_events"
  FOR INSERT
  WITH CHECK (
    patient_id::text = current_setting('app.current_patient_id', true)
  );
