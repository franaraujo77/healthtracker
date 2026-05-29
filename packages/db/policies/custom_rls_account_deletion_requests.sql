-- custom_rls_account_deletion_requests.sql
-- Story 5.6 — RLS for the `account_deletion_requests` table (LGPD Art. 18
-- right-to-erasure) + `pseudonymize_patient_id` SQL helper used by the
-- worker's audit_log pseudonymization step (AR20 — pseudonymize, never
-- delete).
--
-- Patient principal (`app.current_patient_id`): SELECT own pre-deletion
-- row only (the polling endpoint). After the worker cascade-DELETEs the
-- `users` row, the patient cannot re-authenticate and cannot SELECT
-- anything; the ledger row survives as service-role-only.
--
-- No INSERT / UPDATE / DELETE patient policies — all writes flow through
-- `accountRouter.requestDeletion` (resolver) and the
-- `services/llm` `generate-account-deletion` consumer (worker), both of
-- which run with service-role credentials and bypass RLS.
--
-- The `pseudonymize_patient_id(uuid, text) RETURNS text` function is
-- located in this file so the testcontainer integration setup picks it
-- up via the `custom_rls_*.sql` glob (see
-- packages/db/__tests__/integration/setup.ts). The function is
-- `CREATE OR REPLACE` so a repeated boot is idempotent. Output shape:
-- `'pseudonymized-' || encode(sha256(...), 'hex')` — 64 hex chars +
-- the 14-char prefix. Deterministic for `(patient_id, salt)`.

ALTER TABLE "account_deletion_requests" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "account_deletion_requests_select_own"
  ON "account_deletion_requests";
CREATE POLICY "account_deletion_requests_select_own"
  ON "account_deletion_requests"
  FOR SELECT
  USING (
    patient_id::text = current_setting('app.current_patient_id', true)
  );

-- pgcrypto is required for `digest(..., 'sha256')`. Supabase enables it
-- by default; the testcontainer needs an explicit enable. Idempotent.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE OR REPLACE FUNCTION pseudonymize_patient_id(
  patient_id uuid,
  salt text
) RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT 'pseudonymized-' || encode(
    digest(patient_id::text || salt, 'sha256'),
    'hex'
  )
$$;
