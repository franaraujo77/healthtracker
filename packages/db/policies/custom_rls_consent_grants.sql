-- custom_rls_consent_grants.sql
-- RLS for the append-only `consent_grants` table (Story 1.2). Token-principal
-- model (AR5): access is granted only to the patient whose id matches the
-- SET LOCAL claim app.current_patient_id, set by protectedProcedure.
--
-- Append-only at the DB layer: revocation is a new row with `revoked_at`
-- set, never an UPDATE. The absence of UPDATE / DELETE policies denies
-- both operations (same NFR-S4 pattern Story 1.1's audit_log uses).
--
-- The `custom_` prefix keeps drizzle-kit check from dropping this policy.

ALTER TABLE "consent_grants" ENABLE ROW LEVEL SECURITY;

-- A patient may read only their own consent rows.
DROP POLICY IF EXISTS "consent_grants_select_own" ON "consent_grants";
CREATE POLICY "consent_grants_select_own" ON "consent_grants"
  FOR SELECT
  USING (
    patient_id::text = current_setting('app.current_patient_id', true)
  );

-- A patient may insert only their own consent rows. The WITH CHECK is the
-- enforcement seam for AC2 / AC3's "scope cannot be forged".
DROP POLICY IF EXISTS "consent_grants_insert_own" ON "consent_grants";
CREATE POLICY "consent_grants_insert_own" ON "consent_grants"
  FOR INSERT
  WITH CHECK (
    patient_id::text = current_setting('app.current_patient_id', true)
  );

-- No UPDATE or DELETE policy: append-only at the DB layer. Revocation goes
-- through a fresh INSERT with `revoked_at` populated.
