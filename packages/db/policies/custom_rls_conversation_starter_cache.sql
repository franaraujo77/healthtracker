-- custom_rls_conversation_starter_cache.sql
-- Story 5.2 — RLS for the Conversation Starter pre-gen cache.
--
-- Patient principal (`app.current_patient_id`): SELECT own rows only.
-- Doctor principal (`app.current_share_token_id`): SELECT a single
--   cache row only if (a) it belongs to the bound share token, (b)
--   `status = 'ready'` (Story 6.2 doctor surface will render an
--   inline "preparing" message when the cache row exists but is not
--   yet ready), and (c) the parent `share_tokens` row is non-revoked
--   AND non-expired (NULL means no expiry per Story 5.2 AC6).
-- Service role: bypasses RLS (Supabase convention). The `services/llm`
--   Conversation Starter worker writes via the service-role pool.
--
-- No INSERT / UPDATE / DELETE policies at either principal — all
-- mutations flow through the service-role worker.

ALTER TABLE "conversation_starter_cache" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "conversation_starter_cache_select_own_patient" ON "conversation_starter_cache";
CREATE POLICY "conversation_starter_cache_select_own_patient" ON "conversation_starter_cache"
  FOR SELECT
  USING (
    patient_id::text = current_setting('app.current_patient_id', true)
  );

DROP POLICY IF EXISTS "conversation_starter_cache_select_own_doctor" ON "conversation_starter_cache";
CREATE POLICY "conversation_starter_cache_select_own_doctor" ON "conversation_starter_cache"
  FOR SELECT
  USING (
    share_token_id::text = current_setting('app.current_share_token_id', true)
    AND status = 'ready'
    AND EXISTS (
      SELECT 1 FROM share_tokens
      WHERE share_tokens.id = conversation_starter_cache.share_token_id
        AND share_tokens.revoked_at IS NULL
        AND (share_tokens.expires_at IS NULL OR share_tokens.expires_at > now())
    )
  );
