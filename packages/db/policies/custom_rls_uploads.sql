-- custom_rls_uploads.sql
-- Story 1.5 — RLS for the `uploads` table.
--
-- Token-principal model (AR5): access is granted only to the patient
-- whose id matches the SET LOCAL claim `app.current_patient_id`, set by
-- `protectedProcedure` in `packages/api/src/trpc.ts`.
--
-- Append-only at the patient layer: SELECT own + INSERT own only. Epic 2
-- (Story 2.3) will add a narrow service-role UPDATE policy for the
-- state-machine transitions performed by `services/extraction`. There
-- is no DELETE policy — patient-initiated deletion is the Story 5.6
-- service-role path.
--
-- The `custom_` prefix keeps `drizzle-kit check` from dropping these
-- policies on schema sync.

ALTER TABLE "uploads" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "uploads_select_own" ON "uploads";
CREATE POLICY "uploads_select_own" ON "uploads"
  FOR SELECT
  USING (
    patient_id::text = current_setting('app.current_patient_id', true)
  );

DROP POLICY IF EXISTS "uploads_insert_own" ON "uploads";
CREATE POLICY "uploads_insert_own" ON "uploads"
  FOR INSERT
  WITH CHECK (
    patient_id::text = current_setting('app.current_patient_id', true)
  );

-- No UPDATE policy: a state-machine UPDATE happens only from the
-- extraction worker, which connects with the service role and bypasses
-- RLS. Patient UPDATEs are denied entirely at the policy layer.
--
-- No DELETE policy: patient-initiated deletion arrives with Story 5.6
-- and is a service-role-only operation.
