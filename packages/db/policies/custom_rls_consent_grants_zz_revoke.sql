-- custom_rls_consent_grants_revoke.sql
-- Story 1.4 — narrow UPDATE policy on `consent_grants` that enables
-- LGPD Art. 18 revocation while preserving the spirit of the append-only
-- stance from Story 1.2.
--
-- Resolves Story 1.2 F37: the partial unique index
-- `consent_grants_active_unique` matches on (patient_id, consent_type,
-- version) WHERE revoked_at IS NULL. A "revocation = new row with
-- revoked_at set" insert would still leave the original active row
-- satisfying the partial index, blocking any future re-grant for the
-- same type+version. By UPDATEing `revoked_at` on the existing active
-- row instead, the row drops out of the partial index and a fresh
-- `consent.grant` for the same type/version can succeed.
--
-- The policy is deliberately narrow:
--
--   - `USING` filter ensures only the row's owner can be targeted AND
--     the row must currently be active (`revoked_at IS NULL`) — patients
--     cannot un-revoke an already-revoked row or touch a foreign row.
--   - `WITH CHECK` ensures the post-update row still belongs to the
--     same patient AND that `revoked_at` is now set — patients cannot
--     reassign ownership or clear `revoked_at` back to NULL.
--   - A trigger (`consent_grants_revoke_only_revoked_at`) hard-rejects
--     UPDATEs to any column other than `revoked_at`. The trigger is
--     belt-and-suspenders against a future RLS policy widening: even
--     if `WITH CHECK` were relaxed, the trigger blocks tampering with
--     `version`, `consent_type`, `granted_at`, `metadata`, `patient_id`,
--     `id`, or `created_at`.
--
-- The `custom_` prefix keeps drizzle-kit check from dropping this policy.

-- Review P28 — idempotent re-application. The trigger below already uses
-- DROP IF EXISTS; mirror that here so a CI replay / drift recovery doesn't
-- fail with "policy already exists".
DROP POLICY IF EXISTS "consent_grants_update_revoke_own" ON "consent_grants";

CREATE POLICY "consent_grants_update_revoke_own" ON "consent_grants"
  FOR UPDATE
  USING (
    patient_id::text = current_setting('app.current_patient_id', true)
    AND revoked_at IS NULL
  )
  WITH CHECK (
    -- Review P29 — bound `revoked_at` to a ±1 minute window around the
    -- DB clock so a patient connecting directly with their session
    -- claim cannot backdate or future-date the revocation. The trigger
    -- below enforces this too as a defense-in-depth seam, so even a
    -- future policy widening inherits the time constraint.
    patient_id::text = current_setting('app.current_patient_id', true)
    AND revoked_at IS NOT NULL
    AND revoked_at >= NOW() - interval '1 minute'
    AND revoked_at <= NOW() + interval '1 minute'
  );

CREATE OR REPLACE FUNCTION consent_grants_revoke_only_revoked_at()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.patient_id IS DISTINCT FROM OLD.patient_id
     OR NEW.consent_type IS DISTINCT FROM OLD.consent_type
     OR NEW.version IS DISTINCT FROM OLD.version
     OR NEW.granted_at IS DISTINCT FROM OLD.granted_at
     OR NEW.metadata IS DISTINCT FROM OLD.metadata
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'consent_grants: only revoked_at may be UPDATEd'
      USING ERRCODE = '42501';
  END IF;
  -- Review round-2 P32 — reject "un-revoke" transitions even if a
  -- future RLS policy widening lets the UPDATE through. The append-only
  -- intent of `consent_grants` (architecture.md L1487) is that
  -- revocation moves the row out of the "active" partial index; we
  -- never allow the row back to active state via an UPDATE.
  IF OLD.revoked_at IS NOT NULL AND NEW.revoked_at IS NULL THEN
    RAISE EXCEPTION 'consent_grants: revoked_at cannot transition back to NULL'
      USING ERRCODE = '42501';
  END IF;
  -- Review P29 — bound `revoked_at` to a narrow window around the DB
  -- clock so the policy-only path (or a future direct-SQL caller) can't
  -- backdate / future-date the revocation. The RLS WITH CHECK above is
  -- the primary seam; this is the defense-in-depth seam that survives
  -- a policy widening.
  IF NEW.revoked_at IS NOT NULL
     AND (NEW.revoked_at < NOW() - interval '1 minute'
          OR NEW.revoked_at > NOW() + interval '1 minute') THEN
    RAISE EXCEPTION 'consent_grants: revoked_at must be set to approximately NOW()'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS consent_grants_revoke_only_revoked_at_trg
  ON "consent_grants";

CREATE TRIGGER consent_grants_revoke_only_revoked_at_trg
  BEFORE UPDATE ON "consent_grants"
  FOR EACH ROW
  EXECUTE FUNCTION consent_grants_revoke_only_revoked_at();
