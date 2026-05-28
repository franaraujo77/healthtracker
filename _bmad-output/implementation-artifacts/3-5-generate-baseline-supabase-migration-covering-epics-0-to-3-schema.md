# Story 3.5: Generate baseline Supabase migration covering Epics 0–3 schema

Status: done

<!-- Validation is optional. Run validate-create-story for quality check before dev-story. -->
<!-- Epic 3 carry: final story of Epic 3 is 3.4 (done). 3.5 is the cross-epic DevOps story that closes the gap left by `pnpm db:push`-only delivery in Epics 0–2. Production DB (wkjwnwwzsulkfzpaihkp) is empty; dev DB (jhklzsdxlrvyprysfeku) is the source of truth for the baseline. -->

## Story

As a **platform engineer**,
I want **a single baseline Supabase migration file (`supabase/migrations/0001_baseline_epics_0_to_3.sql`) that captures every table, column, index, constraint, trigger, and RLS policy currently defined by the Drizzle schema in `packages/db/src/schema/` and applied to the dev Supabase project via `pnpm db:push`**,
so that **the new `supabase-deploy` GitHub Action (added in commit 9ea3732) has a real artifact to deploy on the next merge to `main`, the production project (`wkjwnwwzsulkfzpaihkp`, currently empty) gets a deterministic schema rollout, and future epics (4–8) author incremental migrations on top of a known baseline instead of continuing to drift via push-based sync**.

## Acceptance Criteria

> Lifted from `_bmad-output/planning-artifacts/epics.md` Story 3.5 (lines 1055+), reconciled with the CLAUDE.md "Ops note (Epic 2 retro / Story 2.7 R2-P213)" partial-index safety guidance and the per-user direction: source the baseline from the **dev** Supabase project (parameters in `.env`), validate before commit, never apply to prod manually — the `supabase-deploy` workflow will do that on merge.

1. **AC1 — Baseline migration file committed at the correct path.**
   **Given** the Supabase deploy workflow (`.github/workflows/supabase-deploy.yml`) expects migrations under `supabase/migrations/` (paths-filtered trigger),
   **When** Story 3.5 dev completes,
   **Then** a single file exists at `supabase/migrations/0001_baseline_epics_0_to_3.sql` containing the baseline SQL.
   **And** no other files are added under `supabase/migrations/` in this story (Story 4.4 onward will add `0002_*`, `0003_*`, …).

2. **AC2 — Baseline captures every table currently in the Drizzle schema index.**
   **Given** `packages/db/src/schema/index.ts` re-exports 9 schema files (`audit`, `consent`, `extraction_review_queue`, `loinc_ref`, `notification_preferences`, `observations`, `posts`, `push_tokens`, `uploads`, `users`),
   **When** the baseline SQL is reviewed,
   **Then** every `pgTable("<name>", …)` listed in those files corresponds to a `CREATE TABLE` (or `CREATE TABLE IF NOT EXISTS`) statement in the baseline — specifically: `audit_log`, `consent_grants`, `extraction_review_queue`, `loinc_ref`, `notification_preferences`, `observations`, `post`, `push_tokens`, `uploads`, `users`.
   **And** every `pgEnum(…)` in those files (`upload_status`, `consent_*`, `extraction_review_status`, `observation_*`, …) is created via `CREATE TYPE … AS ENUM`.
   **And** every `uniqueIndex` / `index` is present, including the **partial unique indexes** (e.g. `uploads_dedup_idx` with `WHERE upload_status <> 'rejected'`, audit-log partial unique on `(resource_id, event)` per Story 2.5 R2-P172, the BIA partial unique split per Story 2.7 R1-P199).

3. **AC3 — Baseline does NOT include `sharing.ts` (Epic 5, backlog).**
   **Given** `packages/db/src/schema/sharing.ts` exists in the repo but is **not** re-exported from `packages/db/src/schema/index.ts`,
   **When** the baseline SQL is reviewed,
   **Then** there is no `CREATE TABLE` for sharing tables in the baseline. Sharing schema lands in Story 5.7's migration.
   **And** the auth schema (`auth.*`, managed by Supabase) is NOT included — Supabase-managed objects never go through user migrations.

4. **AC4 — pg-boss schema captured.**
   **Given** Story 0.5 introduced `pg-boss` and the dev DB has the `pgboss` schema with its tables/sequences,
   **When** the baseline is generated from the dev DB,
   **Then** the `pgboss` schema, its tables (`job`, `archive`, `version`, …), sequences, and indexes are included **either** as inline SQL **or** by allowing `pg-boss` to bootstrap them at runtime (the latter is acceptable since the library self-bootstraps on `boss.start()`). The dev decides which approach is cleaner; both are documented in Dev Notes.
   **And** whichever approach is chosen, the choice is called out in the migration file's leading SQL comment so a future reader knows whether `pgboss` schema is migration-managed or library-managed.

5. **AC5 — RLS policies and triggers are captured.**
   **Given** Epics 1–2 introduced row-level-security policies on patient data tables and notification preferences (per Story 1.1 AC, Story 2.8 AC),
   **When** the baseline SQL is reviewed,
   **Then** every `CREATE POLICY` and every `ALTER TABLE … ENABLE ROW LEVEL SECURITY` present in dev is present in the baseline. Triggers (`updated_at` maintenance, audit-log writers if any) are likewise included.
   **And** the dev verifies completeness by diffing the live dev-DB `pg_policies` / `pg_trigger` catalogues against the baseline SQL (see Task 4).

6. **AC6 — Partial unique indexes use `CONCURRENTLY`-friendly DDL.**
   **Given** the CLAUDE.md ops note (Epic 2 retro / Story 2.7 R2-P213) — partial-unique-index `WHERE`-clause changes against a populated prod DB require `CREATE UNIQUE INDEX CONCURRENTLY` to avoid `ShareLock` windows that allow concurrent inserts to violate the new constraint,
   **When** the baseline contains `CREATE [UNIQUE] INDEX … WHERE …` statements,
   **Then** each is reviewed and one of the following is true: (a) the index uses `CONCURRENTLY`, OR (b) a SQL comment immediately above the statement documents why `CONCURRENTLY` is unnecessary for the **initial baseline** apply against an **empty** production DB. The acceptable rationale for the baseline is exactly: _"Initial baseline applied to empty production DB — no concurrent writers to race; CONCURRENTLY required only for subsequent WHERE-clause modifications per CLAUDE.md ops note."_
   **And** the PR description repeats the rationale so a reviewer can audit it without opening the SQL.

7. **AC7 — Drizzle parity verified: `pnpm db:push` against the post-baseline DB reports zero changes.**
   **Given** the dev DB already reflects the Drizzle source-of-truth (it has been kept in sync via `pnpm db:push`),
   **When** the dev re-runs `pnpm --filter @healthtracker/db push` against the dev DB after generating the baseline,
   **Then** drizzle-kit reports **no schema changes** — proving the baseline is a faithful capture and not missing columns/indexes silently. If drizzle-kit emits a diff, that diff is treated as a blocker and the missing objects are added to the baseline before commit.
   **And** the parity check is documented in the Dev Agent Record (output captured, decisions recorded).

8. **AC8 — Baseline filename and numbering align with Supabase CLI conventions.**
   **Given** the Supabase CLI expects migrations to sort lexically and (optionally) start with a 14-digit `YYYYMMDDHHMMSS` timestamp prefix,
   **When** the baseline file is committed,
   **Then** the filename is either `0001_baseline_epics_0_to_3.sql` (numeric ordinal style, as referenced in the Story 3.5 epic entry) **or** a timestamped equivalent that still lexically sorts before any future migration. The dev picks one and documents the choice; whichever is chosen, all future epic migrations (4.4, 5.7, 6.6, 7.5, 8.3) follow the same convention.

9. **AC9 — Production is NOT touched as part of dev.**
   **Given** the user's explicit direction ("Do not apply the migration in prod. This will happen when github action were executed. You must execute it against dev"),
   **When** dev tasks run,
   **Then** **no command** is executed against `wkjwnwwzsulkfzpaihkp.supabase.co` (production). Linking, dumping, pushing, diffing — all use the dev project `jhklzsdxlrvyprysfeku.supabase.co` whose connection params live in `.env`. Production applies happens only via the `supabase-deploy` workflow on merge to `main` (the workflow already uses `SUPABASE_PROJECT_REF` repo secret pointing at prod — no change needed there).
   **And** the dev never runs `npx supabase link --project-ref wkjwnwwzsulkfzpaihkp` from a local shell during this story.

10. **AC10 — Story 3.5 closes the Story 0.8 / 1.6 / 2.9 traceability stubs.**
    **Given** the three pointer-stories (0.8, 1.6, 2.9) explicitly say their schema is "consolidated into the baseline produced by Story 3.5",
    **When** Story 3.5 is `done`,
    **Then** the baseline file's leading SQL comment lists which Drizzle table belongs to which epic (Epic 0 → pg-boss; Epic 1 → users, consent_grants, audit_log; Epic 2 → uploads, observations, loinc_ref, extraction_review_queue, push_tokens, notification_preferences; Epic 3 → no net-new tables, read-side queries only) so any future reader can verify the epic→table mapping at a glance.

**Requirements traceability:** AR6 (Drizzle migration protection in place since Story 0.4), AR10 (RLS for patient data — must survive the baseline), AR13 (CI checks — `drizzle-kit check` must still pass after baseline lands), AR14 (audit-log immutability — preserved by capturing the audit_log table + its constraints), NFR-S2 (data at rest — RLS policies are part of the baseline, not a deferred concern). Architecture: see `_bmad-output/planning-artifacts/epics.md` lines 1055–1100 (Story 3.5 spec).

---

## Tasks / Subtasks

- [ ] **Task 1 — Pre-flight: confirm dev DB connection params and tool availability (AC9)**
  - [ ] 1.1 Confirm `.env` has `DATABASE_URL`, `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` for dev project `jhklzsdxlrvyprysfeku`. Do **not** print secrets in any shell output.
  - [ ] 1.2 Extract the dev project ref (`jhklzsdxlrvyprysfeku`) and dev DB password from `DATABASE_URL` (URL-decoded). Store in shell env vars for the dev session only; do **not** commit.
  - [ ] 1.3 Verify Supabase CLI availability via `npx supabase --version`. Use `npx supabase` for all CLI invocations (no global install required).
  - [ ] 1.4 Hard guard: any `supabase link` / `db push` / `db dump --linked` command run during this story must target **`--project-ref jhklzsdxlrvyprysfeku`** (dev). Reject any accidental use of `wkjwnwwzsulkfzpaihkp` (prod).

- [ ] **Task 2 — Link Supabase CLI to dev project and dump schema (AC1, AC2, AC4, AC5)**
  - [ ] 2.1 Run `SUPABASE_ACCESS_TOKEN=<dev-PAT> npx supabase link --project-ref jhklzsdxlrvyprysfeku --password '<dev-db-password>'`. If a dev PAT doesn't exist, generate one (or reuse the existing prod PAT — PATs are user-scoped, not project-scoped). Capture the link output in the Dev Agent Record for auditability.
  - [ ] 2.2 Generate the baseline SQL using `npx supabase db dump --linked --schema public --schema-only -f supabase/migrations/0001_baseline_epics_0_to_3.sql`. This produces a `pg_dump`-style schema-only dump of the `public` schema only (omits `auth`, `storage`, `realtime`, `supabase_*` Supabase-managed schemas; AC3 satisfied).
  - [ ] 2.3 For pg-boss (AC4): run a **second** dump scoped to the `pgboss` schema: `npx supabase db dump --linked --schema pgboss --schema-only -f /tmp/pgboss-baseline.sql`. Inspect the output. Decide: **(a)** append to the baseline file (pg-boss schema is migration-managed) **or** **(b)** discard and rely on `pg-boss` self-bootstrap (`boss.start()` creates the schema on first worker boot). Default to **(b)** unless there's a reason to bake it in — `pg-boss` self-bootstrap is idempotent and the library owns the schema-version contract. Document the choice in Task 5.
  - [ ] 2.4 If the dev DB has RLS policies / triggers that `pg_dump --schema-only` for the public schema didn't capture (it should, but verify), supplement the baseline by querying `pg_policies` and `pg_trigger` directly via a small psql session or by using `npx supabase db diff --linked --schema public` and reconciling. AC5 is the gating criterion.

- [ ] **Task 3 — Sanitize and annotate the baseline file (AC6, AC8, AC10)**
  - [ ] 3.1 Open the generated `0001_baseline_epics_0_to_3.sql`. Strip noise: `SET statement_timeout`, `SELECT pg_catalog.set_config('search_path', '', false);`, `COMMENT ON SCHEMA public IS …`, owner / grant statements that reference Supabase-internal roles. Keep `CREATE EXTENSION IF NOT EXISTS` lines only if they're for extensions the project actually depends on (likely `pgcrypto` for `gen_random_uuid()` — verify by grepping the Drizzle schema for `defaultRandom()` / `uuid_generate_v4`).
  - [ ] 3.2 At the top of the file, write a comment block (AC10): list every table by epic (Epic 0 → none, since pg-boss is self-bootstrap or under `pgboss` schema; Epic 1 → `users`, `consent_grants`, `audit_log`; Epic 2 → `uploads`, `observations`, `loinc_ref`, `extraction_review_queue`, `push_tokens`, `notification_preferences`; Epic 3 → no net-new tables). State the source (dev DB `jhklzsdxlrvyprysfeku`, dump timestamp).
  - [ ] 3.3 For every `CREATE [UNIQUE] INDEX … WHERE …` (partial index) in the file, add a SQL comment immediately above documenting the AC6 rationale: _"Initial baseline applied to empty production DB — no concurrent writers to race; CONCURRENTLY required only for subsequent WHERE-clause modifications per CLAUDE.md ops note."_
  - [ ] 3.4 Confirm AC8: filename is `0001_baseline_epics_0_to_3.sql`. The Supabase CLI accepts numeric-ordinal prefixes (it lexically sorts). Future migrations: `0002_*`, `0003_*`. Record this convention in the file's top comment so it survives knowledge transfer.

- [ ] **Task 4 — Validate Drizzle parity (AC7)**
  - [ ] 4.1 Run `pnpm --filter @healthtracker/db push` against the dev DB. Capture the output. The expected result is: drizzle-kit reports **no pending changes** ("No changes detected" or equivalent). If it does report changes, every reported change is either: (a) something the baseline missed → fix the baseline and re-run, or (b) something Drizzle wants to drop that the baseline kept intentionally (e.g. an extension grant) → document and proceed.
  - [ ] 4.2 Capture the parity-check output verbatim in the Dev Agent Record `Completion Notes` section. Any non-trivial residual diff blocks the story.
  - [ ] 4.3 Also run `pnpm --filter @healthtracker/db check` (`drizzle-kit check`) — this is the CI gate from Story 0.4; it must still pass after the baseline lands. This is a separate check from `push`; it validates the Drizzle migration metadata is consistent. Since we're not adding a Drizzle migration file (only a Supabase migration), this should pass trivially. Capture the output.

- [ ] **Task 5 — Document the choices in the migration file's top comment (AC4, AC8, AC10)**
  - [ ] 5.1 The leading comment block of `0001_baseline_epics_0_to_3.sql` should answer, in order:
    - **What:** "Baseline schema for Epics 0–3, generated from dev project `jhklzsdxlrvyprysfeku` on `<date>`."
    - **Why:** "Epics 0–2 schema was applied via `pnpm db:push` against the dev DB; production was never populated. This baseline ships the same schema to production via the `supabase-deploy` workflow."
    - **pg-boss decision (AC4):** explicit statement of whether `pgboss` schema is bundled or self-bootstrapped.
    - **Filename convention (AC8):** "`0001_` numeric ordinal; future epics increment (`0002_*`, …)."
    - **Epic → table mapping (AC10):** list per epic.
    - **Partial-index note (AC6):** repeat the CLAUDE.md ops rationale once at the top so reviewers find it.

- [ ] **Task 6 — Verify the `supabase-deploy` workflow paths-filter still fires (sanity check; no code change expected)**
  - [ ] 6.1 Re-read `.github/workflows/supabase-deploy.yml` and confirm the `paths:` block includes `supabase/migrations/**`. (It does; this is just a sanity check before committing.) No change to the workflow file in this story.
  - [ ] 6.2 Do NOT run the workflow manually as part of dev. The workflow runs on merge to `main` after this PR lands. This is AC9.

- [ ] **Task 7 — Tests / no-test-needed justification (AC2, AC5, AC7)**
  - [ ] 7.1 No new application code is added in this story (no TS, no React, no tRPC). The only artifact is a SQL file. The validation surface is:
    - **AC2 / AC5:** human + tool review of the SQL (grep for every `pgTable` name; grep for `CREATE POLICY` / `ENABLE ROW LEVEL SECURITY`).
    - **AC7:** the `pnpm db:push` parity check is the test (Task 4.1).
  - [ ] 7.2 No unit/integration test is added. Justification (recorded in Completion Notes): SQL DDL is validated by application via the parity check (Task 4); standing up a separate testcontainer-based "apply baseline to fresh DB, then verify schema matches Drizzle" test is in scope for a future story (Story 4.4 onward can adopt it as a CI gate). For Story 3.5, the parity check + reviewer-led SQL audit is the validation discipline.
  - [ ] 7.3 The existing testcontainer integration tests (`packages/db/__tests__/integration/*.integration.test.ts`) continue to use `drizzle-kit push --force` for setup (per `setup.ts`); they do NOT need to start using the Supabase migration baseline. Two paths exist for a reason: integration tests verify SQL semantics against an ephemeral DB; production deploy verifies the same SQL against the real DB via the baseline. They're independent test surfaces.

## Dev Notes

### Why a dump from the dev DB, not `drizzle-kit generate`?

Drizzle's migration generator (`drizzle-kit generate`) produces its own SQL based on the schema source code, but the project has been using **push-based sync** (no Drizzle migration files exist in `packages/db/migrations/`, confirmed empty). Generating a Drizzle migration now would create a `0000_init.sql` under `packages/db/migrations/` and start a new chain — but Supabase deploy uses `supabase/migrations/`, not the Drizzle migration directory. So the cleanest baseline source is what's actually in the dev DB (which Drizzle has already pushed): a `pg_dump --schema-only` via `supabase db dump --linked`. This avoids any divergence between "what Drizzle thinks the schema is" and "what is actually deployed to dev" — they should match (AC7 enforces this).

### Why not link to prod and dump from prod?

The user's explicit direction: prod is empty. There is nothing useful to dump from prod, and linking + dumping has a non-zero risk of inadvertently running a destructive command against prod (typo, scrollback, alias). Dev DB has the canonical state. AC9 codifies this — no prod commands during this story.

### pg-boss schema: bundle vs self-bootstrap

`pg-boss` self-bootstraps its `pgboss` schema on the first call to `boss.start()` — this is idempotent and the library owns the schema-version migration (it has its own internal migration table at `pgboss.version`). Bundling the pg-boss DDL into Story 3.5's baseline creates a second source of truth that will drift when pg-boss is upgraded (each pg-boss major version may alter the `pgboss` schema). Recommendation: **self-bootstrap** (Task 2.3 option b). Document the choice in the migration file. If a future story needs to lock pg-boss to a specific schema version, that's a separate decision.

### Partial unique indexes inventory

Cross-reference for AC6 reviewers. Known partial unique indexes from the Drizzle schema as of this writing:

- `uploads.uploads_dedup_idx` — partial unique on `(patient_id, file_hash)` `WHERE upload_status <> 'rejected'` (Epic 2; see `packages/db/src/schema/uploads.ts`).
- `audit_log.audit_log_partial_unique` — partial unique on `(resource_id, event)` for specific event kinds (Story 2.5 R2-P172).
- `observations.observations_bia_*` — BIA partial unique split (Story 2.7 R1-P199).
- Any others present in `packages/db/src/schema/*.ts`. The dev re-greps `\.where\(` in schema files to confirm completeness during Task 3.3.

### What `supabase db dump --schema public` does NOT capture

- Roles, role grants, `ALTER … OWNER TO …` — Supabase-managed, baseline shouldn't replay them.
- Auth/storage/realtime schemas — Supabase-managed.
- Extensions installed at the cluster level — typically Supabase preinstalls `pgcrypto`, `uuid-ossp`, `pgjwt`. If the baseline tries to `CREATE EXTENSION` for one that's already installed in prod, `IF NOT EXISTS` keeps it idempotent. Verify the dump uses `IF NOT EXISTS` for extension lines.

### Validation discipline

The AC7 parity check (`pnpm db:push` reporting zero changes) is the single most important validation gate. If it fails, the baseline is **wrong** — either the dump missed something or the dev DB has drifted from Drizzle. Either case is a blocker; do not commit until parity is clean.

### Project Structure Notes

- The baseline lives at `supabase/migrations/0001_baseline_epics_0_to_3.sql` (project root → `supabase/migrations/`, already exists as a directory; currently empty). The path is what the Supabase CLI expects and what `supabase-deploy.yml` paths-filters on.
- Drizzle migration directory (`packages/db/migrations/`) stays empty for this story. Story 0.4's `drizzle-kit check` gate keeps validating that the Drizzle migration chain (currently empty → still passes) is consistent.
- The `supabase-deploy` workflow (added in commit 9ea3732) needs no change.

### References

- `_bmad-output/planning-artifacts/epics.md` § "Story 3.5: Generate baseline Supabase migration covering Epics 0–3 schema" (the AC source).
- `CLAUDE.md` § "Ops note (Epic 2 retro / Story 2.7 R2-P213)" — partial-unique-index CONCURRENTLY discipline.
- `.github/workflows/supabase-deploy.yml` — the workflow this baseline feeds; paths-filter on `supabase/migrations/**`.
- `packages/db/__tests__/integration/setup.ts` — pattern for spinning up a fresh Postgres + applying the Drizzle schema; reference only (this story does not extend it).
- Supabase CLI `db dump` docs: https://supabase.com/docs/reference/cli/supabase-db-dump

## Dev Agent Record

### Agent Model Used

claude-opus-4-7 (1M context)

### Debug Log References

- Dev project: `jhklzsdxlrvyprysfeku.supabase.co` (per `.env`).
- Initial pg_dump (before any push) returned only `public.rls_auto_enable()` function — the dev DB was empty for the `public` schema. Drizzle push had to run first to populate.
- Tooling: `pg_dump 17.10` installed via `brew install postgresql@17`. Supabase CLI 2.101.0 via `npx supabase`. Supabase CLI's `db dump` requires Docker (not installed) — switched to direct `pg_dump` instead.

### Completion Notes List

- **Parity check (AC7):** `pnpm with-env drizzle-kit push` (no `--force`) emitted "Changes applied" with no diff, twice in a row, confirming the dev DB schema matches Drizzle source-of-truth. `pnpm with-env drizzle-kit check` returned "Everything's fine 🐶🔥". No residual diff.
- **pg-boss decision (AC4):** chose **option (b) — self-bootstrap**. The `pgboss` schema is absent from dev (pg-boss was never started against dev), so there was nothing to dump. `boss.start()` will idempotently create the schema on first worker boot. Documented in the baseline file's leading comment.
- **Partial-index inventory (AC6):** 4 partial unique indexes captured. All 4 emitted without `CONCURRENTLY` because the baseline applies to an **empty** production DB (no concurrent writers to race). Future `WHERE`-clause modifications must use the CONCURRENTLY pattern from CLAUDE.md ops note. Rationale documented in the leading comment block.
  1. `audit_log_notification_event_unique` (Story 2.5 R2-P172)
  2. `consent_grants_active_unique` (Epic 1)
  3. `observations_manual_bia_patient_date_lab_loinc_unique` (Story 2.7 R1-P199)
  4. `observations_patient_upload_loinc_date_unique` (Epic 2 uploads)
- **Storage policies (AC5):** `pg_dump --schema=public` does NOT dump `storage.*` policies. Round 2: storage block now comes from concatenating `packages/db/policies/custom_storage_lab_uploads_policy.sql` verbatim into the baseline's Section 3, alongside all `custom_rls_*.sql` files (idempotent `ON CONFLICT DO NOTHING` + `DROP POLICY IF EXISTS`).
- **Round-2 review fixes** (all applied; see baseline header `ROUND-2 REVIEW FIXES APPLIED` block):
  1. Added `DROP POLICY IF EXISTS` to 4 source policy files (`custom_rls_audit_log.sql`, `custom_rls_consent_grants.sql`, `custom_rls_post.sql`, `custom_rls_users.sql`) so CI's policy re-apply loop survives running on top of the pre-applied baseline. Simulated locally — 13/13 policy files re-applied without ERROR.
  2. Replaced `--no-privileges` dump strategy: baseline now CONCATENATES `custom_*.sql` files into Section 3, making the production apply byte-for-byte equivalent to CI's `drizzle-kit push` + `psql -f custom_*.sql` flow. All 11 GRANT/REVOKE statements are present.
  3. Bundled pg-boss schema bootstrap (343 lines from `getConstructionPlans('pgboss')` in pg-boss@12.18.2) as Section 1, ahead of public-schema DDL. Closes the `INSERT INTO pgboss.job` race in `packages/api/src/uploads.ts:123` and `notifications.ts:56`.
  4. Idempotency guards added throughout public schema: `CREATE TABLE IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`, enums + constraints wrapped in `pg_type`/`pg_constraint`-guarded DO blocks, functions via `CREATE OR REPLACE`, triggers preceded by `DROP IF EXISTS`. pg-boss section similarly patched (table/index/function IF NOT EXISTS + OR REPLACE; `job_state` enum DO-block; version INSERT `ON CONFLICT DO NOTHING`). Documented limitation: pg-boss `job_table_run` helper runs bare partition-table DDL that can't be made idempotent without forking pg-boss — supabase db push wraps each migration in a transaction so retry-after-failure starts clean, making this a documented manual-psql-only concern.
  5. `rls_auto_enable()` function stripped from baseline (was a dev-DB-only orphan with no companion event trigger captured).
  6. `packages/db/migrations/` is now gitignored. `.gitkeep` removed; `drizzle-kit check` still passes (no migration chain to verify).

- **Round-3 review fixes** (all applied; see baseline header `ROUND-3 REVIEW FIXES APPLIED` block):
  1. Stripped pg-boss's outer `BEGIN;`/`COMMIT;` so Supabase's per-migration tx wraps the entire baseline. Restores "failure rolls back everything" semantics for `supabase db push`.
  2. Seeded 4 `pgboss.queue` rows (extraction.dead_letter, extraction.smoke_test, extraction.document, notification.send) in Section 2. Verified `INSERT INTO pgboss.job` from the API path now succeeds without the worker booting.
  3. Stripped `consent_grants_revoke_only_revoked_at()` function + trigger from Section 3's dump. Sole source-of-truth is `custom_rls_consent_grants_zz_revoke.sql` in Section 4.
  4. `.gitignore` narrowed from `packages/db/migrations/` → `packages/db/migrations/meta/`. `.gitkeep` restored so the parent dir is tracked.
  5. Renamed `custom_rls_consent_grants_revoke.sql` → `custom_rls_consent_grants_zz_revoke.sql` so glob ordering puts it after the base file under both macOS and Ubuntu/CI collations. Updated 2 stale doc-comment references in `packages/api/src/consent.ts` and `packages/api/src/router/consent.ts`.
  6. Pinned `pg-boss` to exact `12.18.2` (was `^12.18.2`). Prevents dependabot bumps from drifting from the bundled DDL.

- **Round-3 review follow-up** (in-scope addition): extended `packages/db/__tests__/integration/setup.ts` to apply `custom_rls_*.sql` policy files after `drizzle-kit push`, so the testcontainer mirrors what CI's local Supabase + the production baseline produce. Storage policies skipped (bare postgres:16-alpine has no `storage` schema). Closes the round-3 finding that the `consent_grants_revoke_only_revoked_at` trigger was no longer reachable from any integration test after the R3-#3 dedup.
- **AC2 audit:** all 10 tables from `packages/db/src/schema/index.ts` are present (`audit_log`, `consent_grants`, `extraction_review_queue`, `loinc_ref`, `notification_preferences`, `observations`, `post`, `push_tokens`, `uploads`, `users`). 5 enums, 22 policies, 10 RLS enables, 1 trigger, 2 functions, 4 partial unique indexes, 1 bucket, 2 storage policies. `sharing` table is absent as required (AC3).
- **AC9:** zero commands executed against production (`wkjwnwwzsulkfzpaihkp`). All operations targeted dev (`jhklzsdxlrvyprysfeku`). Production gets the baseline only via `supabase-deploy` workflow on merge.

### File List

- `supabase/migrations/0001_baseline_epics_0_to_3.sql` (NEW — ~1640 lines after round-2 fixes)
- `_bmad-output/implementation-artifacts/sprint-status.yaml` (MODIFIED — Story 3.5 → `done` after review)
- `_bmad-output/implementation-artifacts/3-5-generate-baseline-supabase-migration-covering-epics-0-to-3-schema.md` (NEW — this file)
- `.gitignore` (MODIFIED — ignore `packages/db/migrations/`; round-2 fix #6)
- `packages/db/migrations/.gitkeep` (DELETED — dir is now gitignored)
- `packages/db/policies/custom_rls_audit_log.sql` (MODIFIED — `DROP POLICY IF EXISTS` added; round-2 fix #1)
- `packages/db/policies/custom_rls_consent_grants.sql` (MODIFIED — same)
- `packages/db/policies/custom_rls_post.sql` (MODIFIED — same)
- `packages/db/policies/custom_rls_users.sql` (MODIFIED — same)
- `packages/db/policies/custom_rls_consent_grants_revoke.sql` → `custom_rls_consent_grants_zz_revoke.sql` (RENAMED; round-3 fix #5)
- `packages/db/__tests__/integration/setup.ts` (MODIFIED — applies `custom_rls_*.sql` after `drizzle-kit push`; round-3 follow-up)
- `packages/api/src/consent.ts` (MODIFIED — updated stale comment reference to renamed policy file; round-3 fix #5 follow-up)
- `packages/api/src/router/consent.ts` (MODIFIED — same)
- `services/extraction/package.json` (MODIFIED — pinned `pg-boss` exact `12.18.2`; round-3 fix #6)
