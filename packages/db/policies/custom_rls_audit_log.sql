-- custom_rls_audit_log.sql
-- RLS for the append-only `audit_log` table (Story 1.1, AR10 / NFR-S4).
--
-- The `custom_` prefix keeps drizzle-kit check from dropping this policy.

ALTER TABLE "audit_log" ENABLE ROW LEVEL SECURITY;

-- A patient may write audit rows only for themselves as actor.
DROP POLICY IF EXISTS "audit_log_insert_own" ON "audit_log";
CREATE POLICY "audit_log_insert_own" ON "audit_log"
  FOR INSERT
  WITH CHECK (
    actor_id::text = current_setting('app.current_patient_id', true)
  );

-- A patient may read only their own audit rows (consumed by Story 1.4).
DROP POLICY IF EXISTS "audit_log_select_own" ON "audit_log";
CREATE POLICY "audit_log_select_own" ON "audit_log"
  FOR SELECT
  USING (
    actor_id::text = current_setting('app.current_patient_id', true)
  );

-- No UPDATE or DELETE policy: the audit trail is append-only at the database
-- layer (NFR-S4). Absence of these policies denies both operations.
