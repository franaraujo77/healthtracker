-- custom_rls_exports.sql
-- Story 5.5 — RLS for the `exports` table (LGPD Art. 18 data-portability).
--
-- Patient principal (`app.current_patient_id`): SELECT own rows only.
-- No INSERT / UPDATE / DELETE patient policies — all writes flow through
-- `sharingRouter.requestExport` (resolver) and the
-- `services/llm` `generate-export` consumer (worker), both of which
-- run with service-role credentials and bypass RLS.
--
-- No doctor-principal access — exports are strictly patient-only.
--
-- The `custom_` prefix keeps drizzle-kit check from dropping this policy.

ALTER TABLE "exports" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "exports_select_own" ON "exports";
CREATE POLICY "exports_select_own" ON "exports"
  FOR SELECT
  USING (
    patient_id::text = current_setting('app.current_patient_id', true)
  );
