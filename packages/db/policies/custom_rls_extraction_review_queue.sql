-- custom_rls_extraction_review_queue.sql
-- Story 2.3 / 2.4 — RLS for the `extraction_review_queue` table.
--
-- Patient layer (Story 2.4):
--   - SELECT own `low_confidence` rows.
--   - UPDATE own `low_confidence` rows — limited to the three
--     resolution columns (`resolved_at`, `resolved_by_patient_id`,
--     `correction_metadata`). Column-level GRANT below enforces this
--     in addition to the policy (defense-in-depth).
--   - NO INSERT, NO DELETE at the patient layer — the worker writes,
--     nobody deletes.
--
-- `loinc_unresolved` rows remain INVISIBLE to patients (the patient
-- policy predicate filters them out).
--
-- Operator layer (Story 8.1):
--   - SELECT `loinc_unresolved` rows ONLY, gated on the
--     `app.current_user_role = 'operator'` GUC bound by
--     `operatorProcedure`. NOTHING else — no UPDATE/INSERT/DELETE
--     (the confirm/reject write policy lands in Story 8.2).
--   - The operator NEVER gets a policy on `users` or `uploads`; the
--     review queue is anonymised because the operator can only read
--     this table, and this table carries no name/email/contact data
--     (`lab_name` is denormalised here precisely so no `uploads` join
--     — and thus no `uploads.original_filename` PII leak — is needed).
--     The anonymisation boundary is RLS, not an app-layer column list
--     (AR5 / NFR-S7). Locked by
--     `extraction-review-queue-operator.rls.test.ts`.
--
-- Service-role bypasses RLS — that's what the worker uses.
--
-- Apply: `psql -f packages/db/policies/custom_rls_extraction_review_queue.sql`.

ALTER TABLE "extraction_review_queue" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "extraction_review_queue_select_own_low_confidence"
  ON "extraction_review_queue";
CREATE POLICY "extraction_review_queue_select_own_low_confidence"
  ON "extraction_review_queue"
  FOR SELECT
  USING (
    patient_id::text = current_setting('app.current_patient_id', true)
    AND reason = 'low_confidence'
  );

DROP POLICY IF EXISTS "extraction_review_queue_update_own_low_confidence"
  ON "extraction_review_queue";
CREATE POLICY "extraction_review_queue_update_own_low_confidence"
  ON "extraction_review_queue"
  FOR UPDATE
  USING (
    patient_id::text = current_setting('app.current_patient_id', true)
    AND reason = 'low_confidence'
  )
  WITH CHECK (
    patient_id::text = current_setting('app.current_patient_id', true)
    AND reason = 'low_confidence'
  );

-- Story 8.1 — operator SELECT policy. RLS policies are OR-combined, so
-- this widens read to the operator role for `loinc_unresolved` rows
-- WITHOUT touching the patient's `low_confidence`-only scope above.
-- The operator connects as the `authenticated` Postgres role (the
-- table-level GRANT SELECT below already covers it); the GUC predicate
-- is what restricts the rows.
DROP POLICY IF EXISTS "extraction_review_queue_select_operator"
  ON "extraction_review_queue";
CREATE POLICY "extraction_review_queue_select_operator"
  ON "extraction_review_queue"
  FOR SELECT
  USING (
    current_setting('app.current_user_role', true) = 'operator'
    AND reason = 'loinc_unresolved'
  );

-- Column-level GRANT: the `authenticated` role (patient-facing) can
-- only mutate the three resolution columns. Even if a future policy
-- broadened the row scope, an UPDATE that touches any other column
-- would be rejected at the GRANT layer.
--
-- P134 — also strip `anon` and `PUBLIC` grants. The default search-path
-- inheritance from prior migrations can grant a row's access to
-- `PUBLIC`; a hostile unauthenticated PostgREST request would otherwise
-- inherit table-level read where the policy's `current_setting()`
-- predicate is forgiving.
REVOKE ALL ON "extraction_review_queue" FROM PUBLIC;
REVOKE ALL ON "extraction_review_queue" FROM "anon";
REVOKE ALL ON "extraction_review_queue" FROM "authenticated";
GRANT SELECT ON "extraction_review_queue" TO "authenticated";
GRANT UPDATE (
  "resolved_at",
  "resolved_by_patient_id",
  "correction_metadata"
) ON "extraction_review_queue" TO "authenticated";
