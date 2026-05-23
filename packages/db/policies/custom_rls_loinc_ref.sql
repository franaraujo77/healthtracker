-- custom_rls_loinc_ref.sql
-- Story 2.3 — RLS for the `loinc_ref` table.
--
-- This is PUBLIC reference data — no PHI. Anyone (including
-- unauthenticated `anon` role) can SELECT. No INSERT/UPDATE/DELETE
-- policy — the table is seed-only via `pnpm db:seed`.
--
-- Apply: `psql -f packages/db/policies/custom_rls_loinc_ref.sql`.

ALTER TABLE "loinc_ref" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "loinc_ref_select_public" ON "loinc_ref";
CREATE POLICY "loinc_ref_select_public" ON "loinc_ref"
  FOR SELECT
  USING (true);
