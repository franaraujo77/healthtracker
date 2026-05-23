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
-- `loinc_unresolved` rows remain INVISIBLE to patients (the policy
-- predicate filters them out). Story 8.1 will add the operator-role
-- SELECT policy against an anonymized view (architecture.md L29).
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
