-- custom_rls_share_token_biomarkers.sql
-- Story 5.1 — RLS for `share_token_biomarkers` (the LGPD per-biomarker
-- scope junction; NFR-S3 central guarantee of Epic 5).
--
-- Patient principal: SELECT rows for share_tokens they own.
-- Doctor principal: SELECT ONLY rows where `visible = true` AND the
--   parent `share_tokens` row is unrevoked + unexpired. This is the
--   defense-in-depth backstop for the UI toggle — even if a client
--   bug surfaced hidden categories, the doctor connection would see
--   zero rows.

ALTER TABLE "share_token_biomarkers" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "share_token_biomarkers_select_own_patient" ON "share_token_biomarkers";
CREATE POLICY "share_token_biomarkers_select_own_patient" ON "share_token_biomarkers"
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM share_tokens
      WHERE share_tokens.id = share_token_biomarkers.share_token_id
        AND share_tokens.patient_id::text = current_setting('app.current_patient_id', true)
    )
  );

DROP POLICY IF EXISTS "share_token_biomarkers_select_own_doctor" ON "share_token_biomarkers";
CREATE POLICY "share_token_biomarkers_select_own_doctor" ON "share_token_biomarkers"
  FOR SELECT
  USING (
    share_token_biomarkers.share_token_id::text = current_setting('app.current_share_token_id', true)
    AND share_token_biomarkers.visible = true
    AND EXISTS (
      SELECT 1 FROM share_tokens
      WHERE share_tokens.id = share_token_biomarkers.share_token_id
        AND share_tokens.revoked_at IS NULL
        AND share_tokens.expires_at > now()
    )
  );
