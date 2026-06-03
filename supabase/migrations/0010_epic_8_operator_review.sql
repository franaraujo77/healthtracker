--
-- Story 8.3 — Epic 8 consolidated migration: operator extraction-quality
-- review (operator role for the anonymised manual review queue).
--
-- Captures the net-new schema introduced by:
--   * Story 8.1 — operator views the anonymised manual review queue:
--     + `ALTER TABLE extraction_review_queue ADD COLUMN lab_name text`
--       (denormalised lab name so the operator review queue renders the
--       lab WITHOUT joining `uploads` — whose `original_filename` can
--       carry patient PII. The operator RLS principal has ZERO read
--       access to `uploads`/`users`; this column keeps the
--       anonymisation boundary at the RLS layer per AR5 / NFR-S7.
--       Additive, nullable, no default — NULL for pre-8.1 rows.)
--     + RLS policy `extraction_review_queue_select_operator` — SELECT
--       `loinc_unresolved` rows ONLY, gated on the
--       `app.current_user_role = 'operator'` GUC bound by
--       `operatorProcedure`. OR-combined with the baseline patient
--       `select_own_low_confidence` policy; neither widens the other.
--       Verbatim mirror of
--       packages/db/policies/custom_rls_extraction_review_queue.sql.
--   * Story 8.2 — operator confirms/rejects individual field values:
--     + `rejection_reason_enum` (`decimal_separator`, `illegible`,
--       `wrong_unit`) — closed set of operator rejection reasons; pt-BR
--       labels live in packages/validators/src/operator.ts.
--     + `ALTER TABLE extraction_review_queue ADD COLUMN rejection_reason`
--       (nullable; `rejection_reason IS NOT NULL` is the discriminator
--       for a rejected row).
--     + `ALTER TABLE extraction_review_queue ADD COLUMN
--       resolved_by_operator_id uuid` (nullable, **NO FK** — mirrors the
--       bare-uuid `resolved_by_patient_id`; the operator's account
--       deletion must NOT cascade-delete the patient's review row, and a
--       bare uuid sidesteps the FK-cascade rule entirely).
--     + `ALTER TYPE observation_source_enum ADD VALUE
--       'operator_confirmed'` — provenance for operator-confirmed
--       observations (confirm publishes the value with `loinc_code = NULL`,
--       confidence 1.0). A strict-superset enum WIDENING.
--
-- Mirrors the Drizzle schema files byte-for-byte:
--   * packages/db/src/schema/extraction_review_queue.ts
--     (lab_name, rejection_reason_enum, rejection_reason,
--     resolved_by_operator_id)
--   * packages/db/src/schema/observations.ts
--     (observation_source_enum += operator_confirmed)
--
-- **No role table/enum.** The operator is provisioned via the
-- `OPERATOR_USER_IDS` env allowlist parsed in `operatorProcedure`
-- (fail-closed), NOT an `operators` table or a `users.role` column. The
-- operator connects as the existing `authenticated` Postgres role; the
-- `app.current_user_role` GUC predicate is what restricts the rows. The
-- only operator-related DDL here is the anonymising SELECT policy.
--
-- **No operator WRITE policy.** Operator confirm/reject (Story 8.2)
-- escalates to `SET LOCAL ROLE postgres` inside the `operatorProcedure`
-- transaction (paired with `SET LOCAL ROLE NONE` in a `finally`) — see
-- packages/api/src/operator-resolve.ts. So there is NO operator
-- INSERT/UPDATE/DELETE policy on `extraction_review_queue`,
-- `observations`, or `uploads`. RLS stays read-only for the operator;
-- the `OPERATOR_USER_IDS` allowlist gate is the trust boundary.
--
-- **No GRANT/REVOKE churn.** The operator reads as `authenticated`,
-- which the baseline (0001) already `GRANT SELECT`s on
-- `extraction_review_queue`. The baseline patient policies and the
-- REVOKE/GRANT block are NOT re-created here — only the net-new operator
-- SELECT policy is added. RLS is left ENABLED by the baseline (not
-- re-asserted) to keep this file strictly net-new.
--
-- **CONCURRENTLY discipline.** Epic 8 ships ZERO new indexes and ZERO
-- partial-unique changes. All DDL fits the standard `supabase db push`
-- path; no `supabase/migrations-postapply/` companion file is needed
-- (the SQLSTATE 25001 carve-out documented in CLAUDE.md fires only for
-- `CREATE INDEX CONCURRENTLY` inside Supabase's implicit per-migration
-- transaction). Identical posture to Epic 7 (0009).
--
-- **`ALTER TYPE … ADD VALUE` in a transaction.** Supabase wraps each
-- migration file in an implicit transaction. PostgreSQL >= 12 permits
-- `ALTER TYPE … ADD VALUE` inside a transaction provided the new value
-- is not REFERENCED in the same transaction — it isn't here (no row uses
-- it), so this is safe. `ADD VALUE IF NOT EXISTS` keeps it re-run safe.
--
-- **Authored from schema source, not `db diff`.** The worktree has no
-- linked Supabase project / DATABASE_URL, so this file is hand-authored
-- to mirror the Drizzle schema + policy source of truth (identical to
-- the Story 7.6 / 0009 delivery). The `supabase db push` apply + the
-- `pnpm db:push` zero-drift check run at deploy time via the
-- supabase-deploy workflow.
--
-- Apply: standard `supabase db push` via the supabase-deploy GHA workflow.
--

-- ============================================================================
-- SECTION 1: Enums
-- ============================================================================

-- Story 8.2 — closed set of operator rejection reasons.
-- Guard is namespace-qualified (matches the baseline 0001 pg_dump form,
-- the stricter of the two in-repo idempotency conventions) so a
-- same-named type in another schema can't short-circuit the create and
-- leave `public.rejection_reason_enum` missing for the column ADD below.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'public' AND t.typname = 'rejection_reason_enum'
  ) THEN
    CREATE TYPE public.rejection_reason_enum AS ENUM (
      'decimal_separator',
      'illegible',
      'wrong_unit'
    );
  END IF;
END $$;

-- ============================================================================
-- SECTION 2: Enum value widening
-- ============================================================================

-- Story 8.2 — operator-confirmed observation provenance. Strict-superset
-- WIDENING (baseline values: extracted / manual_bia / patient_corrected).
-- Safe non-CONCURRENTLY; the new value is not referenced in this tx.
ALTER TYPE public.observation_source_enum ADD VALUE IF NOT EXISTS 'operator_confirmed';

-- ============================================================================
-- SECTION 3: Column ADDs on extraction_review_queue
-- ============================================================================

-- Story 8.1 — denormalised lab name so the operator queue never joins
-- `uploads` (PII boundary stays at the RLS layer). Nullable, no default.
ALTER TABLE public.extraction_review_queue
  ADD COLUMN IF NOT EXISTS lab_name text;

-- Story 8.2 — set when an OPERATOR rejects the field. `rejection_reason
-- IS NOT NULL` is the discriminator for a rejected row; a resolved row
-- with `rejection_reason IS NULL` + `resolved_by_operator_id IS NOT NULL`
-- is operator-confirmed.
ALTER TABLE public.extraction_review_queue
  ADD COLUMN IF NOT EXISTS rejection_reason public.rejection_reason_enum;

-- Story 8.2 — operator who resolved the row (confirm OR reject). Bare
-- uuid, NO FK (mirrors `resolved_by_patient_id`): the operator's account
-- deletion must not cascade-delete the patient's review row.
ALTER TABLE public.extraction_review_queue
  ADD COLUMN IF NOT EXISTS resolved_by_operator_id uuid;

-- ============================================================================
-- SECTION 4: RLS — operator anonymising SELECT policy (Story 8.1)
-- ============================================================================
-- RLS is already ENABLED on extraction_review_queue by the baseline
-- (0001); not re-asserted here. Only the net-new operator SELECT policy
-- is added. RLS policies are OR-combined, so this widens read to the
-- operator role for `loinc_unresolved` rows WITHOUT touching the
-- patient's baseline `low_confidence`-only scope. The operator connects
-- as the `authenticated` role (already `GRANT SELECT` by 0001); the GUC
-- predicate restricts the rows. Byte-for-byte mirror of
-- packages/db/policies/custom_rls_extraction_review_queue.sql.

DROP POLICY IF EXISTS "extraction_review_queue_select_operator"
  ON "extraction_review_queue";
CREATE POLICY "extraction_review_queue_select_operator"
  ON "extraction_review_queue"
  FOR SELECT
  USING (
    current_setting('app.current_user_role', true) = 'operator'
    AND reason = 'loinc_unresolved'
  );
