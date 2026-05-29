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
--       `share_tokens` — Story 5.3 Access Log. This shows the patient
--       doctor-actor and system-actor events scoped to their shares
--       without exposing any row from another patient's share_token.
--
-- Story 5.3 review-fix (2026-05-26): the previous predicate also
-- accepted `resource_type='conversation_starter_cache'`, but no
-- production emitter ever writes that resource_type — both
-- `services/llm/src/consumers/generate-conversation-starter.ts` and
-- the resolver-side emitter in `packages/api/src/router/sharing.ts`
-- write `resource_type='share_token'`. The branch was dead and is
-- removed for clarity.
--
-- `audit_log.resource_id` is typed `uuid` (packages/db/src/schema/audit.ts).
DROP POLICY IF EXISTS "audit_log_select_own" ON "audit_log";
CREATE POLICY "audit_log_select_own" ON "audit_log"
  FOR SELECT
  USING (
    actor_id::text = current_setting('app.current_patient_id', true)
    OR (
      resource_type = 'share_token'
      AND EXISTS (
        SELECT 1 FROM share_tokens
        WHERE share_tokens.id = audit_log.resource_id
          AND share_tokens.patient_id::text = current_setting('app.current_patient_id', true)
      )
    )
  );

-- No UPDATE or DELETE policy: the audit trail is append-only at the database
-- layer (NFR-S4). Absence of these policies denies both operations.
