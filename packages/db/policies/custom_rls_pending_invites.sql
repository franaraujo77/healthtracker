-- custom_rls_pending_invites.sql
-- Story 5.1 — RLS for the `pending_invites` table.
--
-- Patient layer: SELECT own only.
-- Writes (INSERT / UPDATE / DELETE): NONE at the patient layer —
--   `sharingRouter.createPendingInvite` writes via the service-role
--   tRPC transaction (Supabase service-role bypasses RLS).
--
-- Apply: `psql -f packages/db/policies/custom_rls_pending_invites.sql`
-- The testcontainer integration setup auto-loads every `custom_rls_*.sql`
-- file in alpha order on container boot.

ALTER TABLE "pending_invites" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "pending_invites_select_own" ON "pending_invites";
CREATE POLICY "pending_invites_select_own" ON "pending_invites"
  FOR SELECT
  USING (
    patient_id::text = current_setting('app.current_patient_id', true)
  );
