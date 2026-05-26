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

-- A patient may read:
--   (1) their own audit rows (actor = self) — Story 1.4 surface;
--   (2) audit rows whose `resource_id` points at one of their
--       `share_tokens` (or the `conversation_starter_cache` row that
--       inherits the same scope) — Story 5.3 Access Log. This shows
--       the patient doctor-actor and system-actor events scoped to
--       their shares without exposing any row from another patient's
--       share_token.
--
-- `audit_log.resource_id` is typed `uuid` (packages/db/src/schema/audit.ts);
-- the `::uuid` cast on the LEFT side is preserved for the EXISTS subquery
-- so the inner comparison stays uuid-vs-uuid.
DROP POLICY IF EXISTS "audit_log_select_own" ON "audit_log";
CREATE POLICY "audit_log_select_own" ON "audit_log"
  FOR SELECT
  USING (
    actor_id::text = current_setting('app.current_patient_id', true)
    OR (
      resource_type IN ('share_token', 'conversation_starter_cache')
      AND EXISTS (
        SELECT 1 FROM share_tokens
        WHERE share_tokens.id = audit_log.resource_id
          AND share_tokens.patient_id::text = current_setting('app.current_patient_id', true)
      )
    )
  );

-- No UPDATE or DELETE policy: the audit trail is append-only at the database
-- layer (NFR-S4). Absence of these policies denies both operations.
