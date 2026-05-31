-- custom_rls_voice_memos.sql
-- Story 7.4 — RLS for the `voice_memos` table.
--
-- Patient layer:
--   - SELECT own: `patient_id` matches the bound GUC.
--   - INSERT own: same predicate via WITH CHECK.
--   - UPDATE / DELETE: NONE — Story 7.4 is create-only.
--
-- **Doctor-zero-rows invariant.** No doctor policy ships. Mirrors
-- the Epic 7 personal-context pattern (life_events, emotional_checkins):
-- the absence of a doctor policy IS the defense; `privacy_flag` is
-- metadata for a future explicit-consent surface.
--
-- Apply: `psql -f packages/db/policies/custom_rls_voice_memos.sql`

ALTER TABLE "voice_memos" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "voice_memos_select_own" ON "voice_memos";
CREATE POLICY "voice_memos_select_own" ON "voice_memos"
  FOR SELECT
  USING (
    patient_id::text = current_setting('app.current_patient_id', true)
  );

DROP POLICY IF EXISTS "voice_memos_insert_own" ON "voice_memos";
CREATE POLICY "voice_memos_insert_own" ON "voice_memos"
  FOR INSERT
  WITH CHECK (
    patient_id::text = current_setting('app.current_patient_id', true)
  );
