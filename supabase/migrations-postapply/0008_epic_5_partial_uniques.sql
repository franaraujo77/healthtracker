-- =============================================================================
-- 0008_epic_5_partial_uniques.sql
-- =============================================================================
--
-- Story 6.6 retro addendum — CONCURRENTLY-split partial unique indexes
-- for the Epic 5 sharing + exports + account-deletion surfaces. Created
-- alongside the Epic 5 baseline migration `0005_epic_5_sharing_baseline.sql`
-- so a fresh-DB apply chain (CI / new staging / prod recovery) replays
-- cleanly.
--
-- Indexes shipped here:
--   * `share_tokens_invite_active_uq`           (Story 5.1 Patch #4)
--   * `share_tokens_patient_invite_active_uq`   (Story 5.2 Patch #3 — TOCTOU)
--   * `exports_active_uq`                        (Story 5.5 Decision A)
--   * `account_deletion_requests_active_uq`      (Story 5.6 idempotency-shield)
--
-- All four are on patient-data write paths where a concurrent
-- double-tap (mobile↔web, tab refresh) could race the SELECT-then-INSERT
-- short-circuit in the resolver. The partial-unique index is the DB-level
-- backstop; the resolver narrow-catches SQLSTATE 23505 and re-SELECTs.
--
-- ## Why CONCURRENTLY split (vs. inline in 0005)
--
-- Supabase CLI wraps every migration file in an implicit per-file
-- transaction. `CREATE … CONCURRENTLY` cannot run inside a transaction
-- — it fails with SQLSTATE 25001. The companion-file convention
-- (mirrors `0004_epic_4_audit_index_letter_queued.sql` and the Epic 6
-- `0007_epic_6_patient_invites_active_uq.sql` precedent) keeps the
-- index build outside that transaction.
--
-- ## Sequencing
--
-- File ordinal `0008` lands AFTER the Epic 6 post-apply file `0007`
-- so the Epic 6 ordinal does not shift. Post-apply files apply in
-- lexicographic order; `0007` → `0008`. Neither index references the
-- other's table; the ordering is purely operational.
--
-- The parent tables (`share_tokens`, `exports`,
-- `account_deletion_requests`) are created by
-- `supabase/migrations/0005_epic_5_sharing_baseline.sql`, which the
-- Supabase CLI applies first via `supabase db push` before the GHA
-- `psql` loop reaches this file.
--
-- ## Idempotency
--
-- `CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS` is idempotent
-- against:
--   - Fresh DBs (CREATE wins).
--   - DBs primed via `pnpm db:push` (Drizzle ships these as
--     non-CONCURRENTLY; the `IF NOT EXISTS` guard skips re-create).
--   - Partial post-apply failure re-runs.
--
-- The file is BARE DDL (no `BEGIN`/`COMMIT`); the supabase-deploy
-- workflow's `psql` runs it in autocommit mode.

CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS
    share_tokens_invite_active_uq
    ON public.share_tokens USING btree (invite_id)
    WHERE (revoked_at IS NULL);

CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS
    share_tokens_patient_invite_active_uq
    ON public.share_tokens USING btree (patient_id, invite_id)
    WHERE (revoked_at IS NULL);

CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS
    exports_active_uq
    ON public.exports USING btree (patient_id)
    WHERE (status IN ('queued'::public.export_status_enum, 'generating'::public.export_status_enum));

CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS
    account_deletion_requests_active_uq
    ON public.account_deletion_requests USING btree (patient_id)
    WHERE (status IN ('queued'::public.account_deletion_status_enum, 'processing'::public.account_deletion_status_enum));
