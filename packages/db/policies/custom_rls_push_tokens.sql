-- custom_rls_push_tokens.sql
-- Story 2.5 — RLS for the `push_tokens` table.
--
-- Patient layer:
--   - SELECT own
--   - INSERT own (the registration mutation writes via the patient
--     connection; the WITH CHECK guards the patient_id field)
--   - UPDATE own (re-register updates expo_token + last_seen_at +
--     clears revoked_at)
--   - NO DELETE — use the `revoked_at` soft-delete column instead.
--
-- Service-role bypasses RLS; the worker reads tokens via service-role
-- to dispatch notifications.
--
-- Apply: `psql -f packages/db/policies/custom_rls_push_tokens.sql`.

ALTER TABLE "push_tokens" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "push_tokens_select_own" ON "push_tokens";
CREATE POLICY "push_tokens_select_own" ON "push_tokens"
  FOR SELECT
  USING (
    patient_id::text = current_setting('app.current_patient_id', true)
  );

DROP POLICY IF EXISTS "push_tokens_insert_own" ON "push_tokens";
CREATE POLICY "push_tokens_insert_own" ON "push_tokens"
  FOR INSERT
  WITH CHECK (
    patient_id::text = current_setting('app.current_patient_id', true)
  );

DROP POLICY IF EXISTS "push_tokens_update_own" ON "push_tokens";
CREATE POLICY "push_tokens_update_own" ON "push_tokens"
  FOR UPDATE
  USING (
    patient_id::text = current_setting('app.current_patient_id', true)
  )
  WITH CHECK (
    patient_id::text = current_setting('app.current_patient_id', true)
  );

-- Defense-in-depth: revoke broad grants; only `authenticated` gets the
-- narrow surface the policies above enforce.
REVOKE ALL ON "push_tokens" FROM PUBLIC;
REVOKE ALL ON "push_tokens" FROM "anon";
GRANT SELECT, INSERT, UPDATE ON "push_tokens" TO "authenticated";
