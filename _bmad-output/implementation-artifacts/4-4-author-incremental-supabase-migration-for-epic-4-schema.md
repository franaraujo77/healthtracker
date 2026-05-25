# Story 4.4: Author incremental Supabase migration for Epic 4 schema

Status: ready-for-dev

> **Operational story — no patient-facing surface.** Captures every net-new Drizzle schema object Epic 4 (Stories 4.1 + 4.2 + 4.3) introduced as Supabase migration SQL files under `supabase/migrations/`, so production picks them up via the `supabase-deploy` workflow instead of `pnpm db:push`. Stacks on PR #54 — the Drizzle source-of-truth changes already landed there. **Production deploy gate is NOT this story** — this story produces the files; the operator runs `supabase-deploy` later.

## Story

**As a** platform engineer,
**I want** a versioned Supabase migration file (or files) capturing every net-new table, enum, index, and RLS policy introduced by Epic 4 (Letter narratives + biomarker suggestions),
**so that** Letter persistence reaches production through the `supabase-deploy` workflow and is not applied via ad-hoc `pnpm db:push`.

## Acceptance Criteria

1. **AC1 — Drizzle schema fully covered.** Given Story 3.5 baseline `0001_baseline_epics_0_to_3.sql` is `done` and Epic 4 Drizzle schema for Letters has landed on PR #54, when the operator runs `supabase db diff --use-migra --linked` against the linked project after applying the new migration files, then **zero** pending changes are reported. Every Drizzle table/enum/index/policy/column in `packages/db/src/schema/letters.ts` + the `audit_log` WHERE-clause edit appears in exactly one of the new SQL files.

2. **AC2 — Files committed under `supabase/migrations/` with sequential prefixes.** The two new files are named `0003_epic_4_letters_schema.sql` (forward-only DDL inside a transaction) and `0004_epic_4_audit_index_letter_queued.sql` (CONCURRENTLY-shaped index swap, no-transaction). Numeric prefixes follow `0002_drop_post_artifact.sql` (the most recent migration on `main`).

3. **AC3 — `letters` table.** `0003_*.sql` creates `letter_status_enum` (values: `queued`, `generating`, `complete`, `failed`) and `letters` (columns: `id uuid PK default gen_random_uuid()`, `patient_id uuid NOT NULL`, `upload_id uuid NOT NULL`, `status letter_status_enum NOT NULL default 'queued'`, `body text`, `model text`, `tokens_used integer`, `failure_reason text`, `generated_at timestamptz`, `created_at timestamptz default now() NOT NULL`, `expires_at timestamptz`). Matches `packages/db/src/schema/letters.ts` byte-for-byte (Drizzle's snake_case casing + `defaultRandom()` → `gen_random_uuid()`).

4. **AC4 — `letters_patient_created_idx`.** Created inside `0003_*.sql` as `(patient_id, created_at)` — anticipated read path for Story 4.2's `getLetterForDraw` (which actually filters by `created_at DESC` but the index works equally in both directions).

5. **AC5 — `letters` RLS policy.** `letters_select_own` allows patients to read their own letters: `USING ((patient_id)::text = current_setting('app.current_patient_id', true))`. Service-role connections (the `services/llm` worker, the API's `generateBiomarkerSuggestion` audit write) bypass RLS via Supabase's standard service-role policy. NO patient-facing `INSERT` / `UPDATE` / `DELETE` policy — writes come exclusively through service-role. Mirrors the Story 2.3 `observations` table pattern (`observations_select_own` only).

6. **AC6 — `audit_log_notification_event_unique` WHERE-clause widened.** `0004_*.sql` drops + recreates the partial unique index with the new WHERE clause `event IN ('notification.upload_complete', 'notification.upload_pending_review', 'notification.upload_failed', 'letter.queued')`. Per CLAUDE.md ops note, this DDL uses `CREATE UNIQUE INDEX CONCURRENTLY` + `DROP INDEX CONCURRENTLY`, NOT a single `ALTER INDEX` (Postgres has no such command for partial-index `WHERE` clauses anyway). The file MUST disable the wrapping transaction Supabase normally applies — directive: `-- supabase: no-transaction` at the top.

7. **AC7 — Index swap is order-safe.** `0004_*.sql` creates a new index (e.g. `audit_log_notification_event_unique_v2`) FIRST, then drops the old one. The application code reads the constraint by name in `services/extraction/src/notifications/emit.ts` (`ON CONFLICT ON CONSTRAINT audit_log_notification_event_unique`) — so the FINAL step renames `_v2` → `audit_log_notification_event_unique` to preserve the symbol. Sequence: `CREATE _v2 CONCURRENTLY`, `DROP _orig CONCURRENTLY`, `ALTER INDEX _v2 RENAME TO audit_log_notification_event_unique`.

8. **AC8 — No partial-rollback footguns.** Each statement in `0004_*.sql` is independently safe to retry. A failed `CREATE INDEX CONCURRENTLY` leaves an `INVALID` index that the operator must drop before retrying; the migration script does not auto-clean. This is acceptable (Supabase migrations are operator-supervised, not automated rollback territory).

9. **AC9 — Test: integration testcontainer applies both migrations cleanly.** A new `packages/db/__tests__/integration/migrations.integration.test.ts` (extend the existing testcontainer fixture from Story 3.5 if it exists, otherwise create) boots Postgres 16, applies `0001_*.sql` + `0002_*.sql` + the two new files **in order**, then runs `drizzle-kit push --force` against the resulting database and asserts the push reports **zero pending statements**. This is the AC1 check, automated.

10. **AC10 — No production deploy in this story.** This story commits the SQL files and the test. The `supabase-deploy` workflow run is operator-supervised work AFTER PR #54 merges. Story 4.4 explicitly does NOT push to production.

## Tasks / Subtasks

- [ ] **T1. `0003_epic_4_letters_schema.sql` — letters table + RLS.** (AC: 1, 3, 4, 5)
  - [ ] T1.1 Create the `letter_status_enum` pgEnum.
  - [ ] T1.2 Create the `letters` table with all columns and defaults matching `packages/db/src/schema/letters.ts`.
  - [ ] T1.3 Create `letters_patient_created_idx` on `(patient_id, created_at)`.
  - [ ] T1.4 `ALTER TABLE public.letters ENABLE ROW LEVEL SECURITY;` + `CREATE POLICY letters_select_own ... FOR SELECT USING (...)`.
  - [ ] T1.5 No FK declarations on `patient_id` / `upload_id` (the baseline doesn't ship FKs either — RLS + application discipline handle integrity; matches Drizzle source).

- [ ] **T2. `0004_epic_4_audit_index_letter_queued.sql` — audit-log partial-index swap.** (AC: 2, 6, 7, 8)
  - [ ] T2.1 First line: `-- supabase: no-transaction` (disables Supabase CLI's auto-wrapping).
  - [ ] T2.2 `CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS audit_log_notification_event_unique_v2 ON public.audit_log (resource_id, event) WHERE event IN (...4 values incl. 'letter.queued');`
  - [ ] T2.3 `DROP INDEX CONCURRENTLY IF EXISTS public.audit_log_notification_event_unique;`
  - [ ] T2.4 `ALTER INDEX public.audit_log_notification_event_unique_v2 RENAME TO audit_log_notification_event_unique;`
  - [ ] T2.5 Documentation comment block at top citing CLAUDE.md ops note + Story 4.1 R2-P172 lineage.

- [ ] **T3. Integration test.** (AC: 9)
  - [ ] T3.1 Add or extend `packages/db/__tests__/integration/migrations.integration.test.ts` to: (a) start Postgres 16 testcontainer, (b) apply all `supabase/migrations/*.sql` files in numeric order, (c) run `drizzle-kit push --force --dialect postgresql ...` against the resulting DB, (d) assert `0` pending statements.
  - [ ] T3.2 The test must run under `pnpm --filter @healthtracker/db test:integration` (existing script per CLAUDE.md).

- [ ] **T4. Dev-env verification (manual).** Run `pnpm db:push` against the local dev Supabase project (`jhklzsdxlrvyprysfeku` per the Story 3.5 dev record). Confirm it reports zero pending changes after applying the new migrations. Document the result in the dev record.

## Dev Notes

### Architecture references

- `_bmad-output/planning-artifacts/epics.md` §"Story 4.4" lines 1181–1201 — verbatim ACs.
- `_bmad-output/planning-artifacts/architecture.md` §15 (Gap 1 resolution) — `letters` schema.
- `CLAUDE.md` "Ops note (Epic 2 retro / Story 2.7 R2-P213)" — partial-index WHERE-clause changes in prod require `CONCURRENTLY` + maintenance window.
- `packages/db/src/schema/letters.ts` — the Drizzle source-of-truth for the new table.
- `packages/db/src/schema/audit.ts` lines 35–54 — the partial-unique-index source.
- `supabase/migrations/0001_baseline_epics_0_to_3.sql` line 923 — the existing index WHERE clause to be swapped.

### Patterns to copy (don't reinvent)

- **RLS policy shape** — `0001_*.sql` line 1079 `observations_select_own` is the closest analog (read-only-by-patient, service-role-write).
- **CONCURRENTLY index swap** — Postgres docs + the Story 2.5 R2-P172 retrospective. Specifically: create with a new name FIRST, then drop the old, then rename — to preserve any `ON CONFLICT ON CONSTRAINT <name>` references at the application layer.
- **Migration prefixing** — sequential numeric prefix; `0001` and `0002` are taken.

### Anti-patterns explicitly forbidden in 4.4

- Do **not** combine the table-creation DDL and the CONCURRENTLY index swap in one file. CONCURRENTLY cannot run inside the implicit transaction Supabase wraps around migration files; the table creation can.
- Do **not** ship the migration without the integration test. The `migra` diff against Drizzle is the AC1 truth source; an automated version of that diff is the only way to keep a future schema change in sync.
- Do **not** add FK constraints on `patient_id` / `upload_id` — the baseline schema deliberately doesn't carry them (Drizzle source-of-truth doesn't either; the audit_log + RLS model is the integrity surface).
- Do **not** add a patient-facing INSERT/UPDATE/DELETE policy on `letters`. All writes go through service-role (the `services/llm` consumer writes `body`, `status='complete'`, the `generateBiomarkerSuggestion` API procedure writes nothing — it only writes `audit_log` rows).
- Do **not** include the biomarker-suggestion path in the migration — it adds no schema. The `biomarker_suggestion.generated` audit kind is just a new `event` string value on the existing `audit_log` table; no enum to migrate.

### Previous-story intelligence

- **Story 3.5 (baseline migration)** — successful pattern: `supabase db diff --use-migra --linked -f baseline_epics_0_to_3` produced `0001_*.sql`. The same `--use-migra` flow should reproduce 4.4 if the linked project is on `main` (pre-4.1).
- **Story 4.1 code-review findings F1–F5** — none directly affect the migration; the dedup-index-broken finding (F1) is at the application layer, not the index definition.
- **Story 4.3 LOW follow-ups** — none affect the schema.

### Project Structure Notes

- All files land under `supabase/migrations/` — established directory for migration files.
- The integration test extends an existing fixture if present; otherwise lives at `packages/db/__tests__/integration/migrations.integration.test.ts`.
- No source-code changes outside of these locations.

### Testing standards summary

- Integration (testcontainers + drizzle-kit diff) is the AC1 enforcement.
- No unit tests applicable (SQL files don't have a unit-testable surface).

## References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 4.4 lines 1181–1201]
- [Source: CLAUDE.md ops note on partial-index WHERE changes]
- [Source: supabase/migrations/0001_baseline_epics_0_to_3.sql]
- [Source: packages/db/src/schema/letters.ts]
- [Source: packages/db/src/schema/audit.ts (partial unique index)]

## Dev Agent Record

### Agent Model Used

_To be filled by dev agent._

### Debug Log References

### Completion Notes List

### File List

### Known infra blockers

None new for 4.4. After PR #54 merges, the operator runs `supabase-deploy` against the linked project (Anthropic DPA + Railway provisioning still gate any actual Letter generation in prod, but the schema can ship ahead of those — letters just never get inserted).
