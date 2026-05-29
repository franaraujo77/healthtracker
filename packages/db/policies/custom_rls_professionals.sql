-- custom_rls_professionals.sql
-- Story 6.3 — RLS for the `professionals` table (AC9).
--
-- Three policies:
--   * `professionals_select_own`   — doctor reads own row.
--   * `professionals_insert_own`   — doctor inserts only as themselves.
--   * `professionals_service_role_all` — admin / operator bypass.
--
-- NO UPDATE / DELETE policies — display-name edits are a future
-- story (deferred); deletion piggybacks on the `users` cascade FK
-- declared in `packages/db/src/schema/professionals.ts`.
--
-- **Doctor principal binding.** The repo's existing RLS pattern uses
-- transaction-scoped GUCs (`current_setting('app.X', true)`) rather
-- than Supabase's `auth.uid()` so the same policies are testable
-- against the bare `postgres:16-alpine` testcontainer (which has no
-- `auth` schema). The `doctorProcedure` middleware sets
-- `app.current_doctor_user_id` to the verified Supabase session uid
-- (Story 6.3 extension; the existing `app.current_share_token_id`
-- continues to bind the share-token principal for `share_*` tables).
-- Activation status is `auth.uid()`-scoped (NOT share-token-scoped):
-- a doctor activated via patient A's token IS activated when viewing
-- patient B's report (AC4 / AC10 — Doctor Acquisition Loop closure).

ALTER TABLE "professionals" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "professionals_select_own" ON "professionals";
CREATE POLICY "professionals_select_own" ON "professionals"
  FOR SELECT
  USING (
    user_id::text = current_setting('app.current_doctor_user_id', true)
  );

DROP POLICY IF EXISTS "professionals_insert_own" ON "professionals";
CREATE POLICY "professionals_insert_own" ON "professionals"
  FOR INSERT
  WITH CHECK (
    user_id::text = current_setting('app.current_doctor_user_id', true)
  );

-- service_role bypass — workers / ops queries / migrations.
DROP POLICY IF EXISTS "professionals_service_role_all" ON "professionals";
CREATE POLICY "professionals_service_role_all" ON "professionals"
  FOR ALL
  USING (
    current_setting('app.current_user_role', true) = 'service_role'
  )
  WITH CHECK (
    current_setting('app.current_user_role', true) = 'service_role'
  );
