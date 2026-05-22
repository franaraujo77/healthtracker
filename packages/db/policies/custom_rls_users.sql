-- custom_rls_users.sql
-- RLS for the `users` table (Story 1.1). Token-principal model (AR5):
-- access is granted only to the patient whose id matches the SET LOCAL claim
-- app.current_patient_id, set by protectedProcedure.
--
-- The `custom_` prefix keeps drizzle-kit check from dropping this policy.

ALTER TABLE "users" ENABLE ROW LEVEL SECURITY;

-- A patient may read only their own row.
CREATE POLICY "users_select_own" ON "users"
  FOR SELECT
  USING (
    id::text = current_setting('app.current_patient_id', true)
  );

-- A patient may insert only their own row (id must equal their auth.uid()).
-- This is the registration insert performed by account.initializeProfile.
CREATE POLICY "users_insert_self" ON "users"
  FOR INSERT
  WITH CHECK (
    id::text = current_setting('app.current_patient_id', true)
  );

-- No UPDATE or DELETE policy: profile mutation and account deletion are
-- introduced by later stories and are denied until then.
