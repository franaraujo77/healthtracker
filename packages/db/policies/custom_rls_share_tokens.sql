-- custom_rls_share_tokens.sql
-- Story 5.1 — RLS for the `share_tokens` table. Two SELECT policies,
-- one per principal type (patient vs doctor).
--
-- Patient principal (`app.current_patient_id`): SELECT own rows only.
-- Doctor principal (`app.current_share_token_id`): SELECT the single
--   share token whose `id` matches the GUC, gated on
--   `revoked_at IS NULL AND (expires_at IS NULL OR expires_at > now())`
--   (Story 5.2 AC6 — `expires_at` is nullable; NULL means "sem prazo").
--
-- No INSERT / UPDATE / DELETE policies — all mutations flow through
-- `sharingRouter` (service-role tRPC).

ALTER TABLE "share_tokens" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "share_tokens_select_own_patient" ON "share_tokens";
CREATE POLICY "share_tokens_select_own_patient" ON "share_tokens"
  FOR SELECT
  USING (
    patient_id::text = current_setting('app.current_patient_id', true)
  );

DROP POLICY IF EXISTS "share_tokens_select_own_doctor" ON "share_tokens";
CREATE POLICY "share_tokens_select_own_doctor" ON "share_tokens"
  FOR SELECT
  USING (
    id::text = current_setting('app.current_share_token_id', true)
    AND revoked_at IS NULL
    AND (expires_at IS NULL OR expires_at > now())
  );
