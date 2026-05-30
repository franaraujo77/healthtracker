# Story 6.6 — Code Review (Round 1)

**Reviewed commit:** `d066b9f` on `worktree-story-6-2` (PR #57)
**Scope:** Files added by commit d066b9f only — `0005_epic_6_doctor_accounts.sql`, `0006_epic_6_patient_invites_active_uq.sql`, CLAUDE.md stanza, sprint-status.yaml, spec file.
**Reviewer:** Code review workflow (Blind Hunter / Edge Case Hunter / Acceptance Auditor — collapsed since pure SQL surface).

## Severity counts

| Severity | Count |
| -------- | ----- |
| CRITICAL | 0     |
| HIGH     | 1     |
| MEDIUM   | 2     |
| LOW      | 2     |

---

## HIGH

### H1 — `supabase-deploy.yml` will fail at production deploy: 0006 CONCURRENTLY inside implicit tx (SQLSTATE 25001)

**Evidence.** `.github/workflows/supabase-deploy.yml` (the entire deploy job is just `supabase link` + `supabase db push`). There is NO `psql` apply step. Yet `supabase/migrations/0006_epic_6_patient_invites_active_uq.sql` runs `CREATE UNIQUE INDEX CONCURRENTLY`, which fails with `SQLSTATE 25001` when wrapped in Supabase CLI's implicit per-file transaction (the rule documented in CLAUDE.md lines 114-124 and re-stated by Story 6.6 spec AC8).

The 0006 file's own header acknowledges the gap:

> "The supabase-deploy GitHub Actions workflow already implements this split-apply path for `0004_*.sql`; if it does not auto-pick `0006_*.sql` via a glob pattern, the workflow needs a minor follow-up extension (out of Story 6.6 scope — coordinate with Francis)."

It does NOT implement that split-apply path — `0004_*.sql` does not use `CONCURRENTLY` (it relies on the strict-superset-widening guarantee, see CLAUDE.md "Ops note (Epic 4 retro / Story 4.4)"). 0006 is the **first** file in the repo that will require psql-based apply via the deploy workflow.

The story spec AC8 instructs: "the supabase-deploy GHA already handles this split — confirm with Francis before extending it." The dev did not confirm and did not extend.

**Impact.** First `main` merge that triggers `supabase-deploy` will fail at the `supabase db push` step on 0006. Production deploy is blocked.

**Why not patched.** Extending the workflow needs a design choice (where does 0006 live relative to `supabase db push`? rename suffix? move to a sibling dir? probe migration files for `CONCURRENTLY`?). I do not have authority to redesign the deploy contract — Francis decides.

**Recommended remediation (any one):**

- (a) Add a post-`db push` step that loops `psql -f` over a `supabase/post-migrations/` dir (and move 0006 there).
- (b) Add a pre-`db push` step that strips `CONCURRENTLY`-containing files from `supabase/migrations/`, applies them via psql, then runs `db push`.
- (c) Manually apply 0006 once via `psql` against prod before merging this PR, and document it as a one-off (then 0006 stays as docs-only ordinal).

---

## MEDIUM

### M1 — Fresh-DB apply of 0005 will fail: `pending_invites` table does not exist in any migration

**Evidence.** Line 138 of 0005 does `ALTER TABLE ONLY public.pending_invites ADD CONSTRAINT pending_invites_resolved_user_id_users_id_fk ...`. `grep -r "CREATE TABLE.*pending_invites" supabase/migrations/` returns zero hits — the table is not created by 0001, 0002, 0003, 0004, or 0005. The Epic 5 migration file gap is documented as pre-existing (story spec, dev commit message).

**Impact.** On any fresh DB (CI shadow-DB, new staging, prod recovery from baseline), `supabase db push` will fail at 0005 with `relation "pending_invites" does not exist`. Production is unaffected today because dev applied via `pnpm db:push` directly during Stories 5.x/6.x, but the migration chain is broken for any clean re-apply.

**Why not patched.** Pre-existing Epic 5 deferred-work item, acknowledged by dev and out of Story 6.6 scope. Patching it would require authoring the missing Epic 5 migration file (`pending_invites`, `share_tokens`, `share_token_biomarkers`, all their RLS policies, the FK additions from Story 5.6) — that is a separate story.

**Recommendation.** Open a follow-up story to author the missing Epic 5 baseline migration. Until then, document in `deferred-work.md` that fresh-DB rehydration is broken and prod-deploy survives only because of the `pnpm db:push` priming history.

### M2 — Drizzle ↔ migration constraint-name truncation drift on staleness_thresholds FK

**Evidence.** Line 329 of 0005 declares constraint `staleness_thresholds_professional_user_id_professionals_user_id_fk` (67 chars). PostgreSQL's NAMEDATALEN=63 truncates this to `staleness_thresholds_professional_user_id_professionals_user_i`. The `IF NOT EXISTS` guard on line 327 checks the FULL 67-char name, which `pg_constraint.conname` will never contain after a real INSERT — so the guard ALWAYS reports "not exists" and the `ADD CONSTRAINT` always re-runs.

On a fresh DB the ADD succeeds (the truncated name is what gets stored). On a re-apply against a `pnpm db:push`'d DB, the guard reports "not exists" → tries to ADD → fails with "constraint already exists" (the truncated name conflict).

**Impact.** Breaks AC5 / AC11 idempotency for the staleness FK. Manual re-apply against a `pnpm db:push`'d database will fail at line 332.

**Why not patched.** Want Francis to decide whether to (a) shorten the constraint name in the Drizzle schema (`packages/db/src/schema/staleness_thresholds.ts`) and re-emit, or (b) just truncate the name in the migration's `conname` predicate and `ADD CONSTRAINT` clause to match what Postgres actually stores. Option (b) is a 1-line fix in 0005; option (a) ripples to drizzle-kit output and tests. Sprint-status comment block already names this as "known pre-existing Drizzle churn," so dev was aware.

---

## LOW

### L1 — CLAUDE.md blockquote formatting break (PATCHED)

**Evidence.** Line 148 (`staleness_thresholds}.rls.test.ts...`) was missing the leading `> ` blockquote marker, breaking the rendered appendix.

**Patched.** Added the missing `> ` prefix.

### L2 — 0006 header makes a false claim about the deploy workflow

**Evidence.** 0006 lines 38-42 say the supabase-deploy GHA "already implements this split-apply path for `0004_*.sql`." It does not — 0004 ships without CONCURRENTLY and rides the normal `supabase db push` path. Tied to H1.

**Why not patched.** Once H1 is resolved (deploy workflow extended OR 0006 relocated), this comment needs an update reflecting the actual chosen pattern. Patch alongside H1.

---

## Hot-spot verifications (passed)

- **AC1 idempotency guards** — every `CREATE TYPE` / `CREATE TABLE` / `CREATE INDEX` / `ADD CONSTRAINT` / `CREATE POLICY` is properly `IF NOT EXISTS`-guarded (or `DROP POLICY IF EXISTS` + `CREATE POLICY` for policies). Verified line-by-line. EXCEPT M2.
- **AC3 CONCURRENTLY split** — `patient_invites_professional_identifier_active_uq` is in 0006 with `CREATE UNIQUE INDEX CONCURRENTLY`, NOT inside a `BEGIN; … COMMIT;`. File is bare DDL. Correct.
- **Migration ordinals** — `0005_*` and `0006_*` are next in sequence; no conflicts.
- **RLS policy bodies** — verified byte-equivalent (modulo formatting whitespace) against `packages/db/policies/custom_rls_{professionals,patient_invites,staleness_thresholds}.sql`. All 11 policies match (3 + 4 + 4).
- **FK ON DELETE semantics** — match Drizzle:
  - `professionals.user_id → users.id` CASCADE ✓
  - `pending_invites.resolved_user_id → users.id` SET NULL ✓ (Story 6.3 documented exception)
  - `patient_invites.professional_user_id → professionals.user_id` CASCADE ✓
  - `patient_invites.resolved_user_id → users.id` SET NULL ✓ (Story 6.4 documented exception)
  - `staleness_thresholds.professional_user_id → professionals.user_id` CASCADE ✓
- **Enum values** — `professional_category_enum` and `patient_invite_status_enum` match Drizzle source.
- **CHECK constraints** — `staleness_thresholds_days_range_check (1..3650)` and `patient_invites_identifier_kind_check (email|phone)` match Drizzle.
- **Doctor-data-isolation RLS proof (AC9)** — `professionals_select_own`, `patient_invites_select_own`, `staleness_thresholds_select_own` all gate on `professional_user_id::text = current_setting('app.current_doctor_user_id', true)`. No cross-tenant predicate exists. The `patient_invites_update_own_or_resolving_patient` second branch correctly scopes to `status = 'pending' AND revoked_at IS NULL AND expires_at > now()` in USING, and to `status = 'resolved' AND resolved_user_id::text = current_setting('app.current_patient_id', true)` in WITH CHECK — the resolving patient can ONLY flip their own row, cannot enumerate invites for other patients (no patient SELECT policy).
- **`staleness_thresholds` NO DELETE policy** — confirmed intentionally omitted (Story 6.5 AC4); the inline comment in 0005 (lines 456-461) correctly explains why a defensive `FOR DELETE USING (false)` would be wrong.
- **RLS test surface (AC9 runtime guarantee)** — verified: `packages/db/__tests__/rls/professionals.rls.test.ts`, `patient_invites.rls.test.ts`, `staleness_thresholds.rls.test.ts`, `patient_invites_resolved_user_id_fk.rls.test.ts` all exist.
- **Sprint-status comment block** — preserves all prior comments, no leaked secrets, accurately summarizes the implementation.
- **CLAUDE.md stanza** — accurate content, consistent voice with prior epic stanzas, points reviewers at the right test files. Formatting break patched as L1.

---

## What was patched vs left for Francis

**Patched:**

- L1 — CLAUDE.md blockquote formatting on line 148.

**Left for Francis (need design call):**

- H1 — deploy workflow extension for CONCURRENTLY-bearing files. Production deploy will fail on first merge until resolved.
- M1 — missing Epic 5 baseline migration file. Pre-existing, out-of-scope, ack'd in deferred-work.
- M2 — staleness FK constraint-name truncation idempotency break. 1-line fix in 0005 once Francis picks (truncate vs. shorten upstream).
- L2 — 0006 header comment correction (patch alongside H1).

---

## Quality-gate output

- `pnpm -w typecheck` → ✅ 17/17 successful (all cached, no errors).
- `pnpm -w lint` → ✅ 15/15 successful (all cached, no errors).
- `pnpm test:integration` → ⏭️ SKIPPED. Rancher Desktop docker.sock bind-mount unsupported on this host (story ships zero runtime code; RLS suites 6.3/6.4/6.5 already lock the invariant).

---

## Commit / push

- Patch commit: see SHA below (CLAUDE.md formatting fix).
- Branch: `worktree-story-6-2` (PR #57, stacked stories).
- Sprint-status: left at `review` per workflow instructions; Francis flips.

---

## Addendum — Round-1 follow-up patches (2026-05-30)

Francis approved the full set (H1 + M1 + M2 + L2). Three landed inline; M1 was split into a follow-up story (see deferred-work entry).

### H1 (patched inline) — deploy workflow extended for CONCURRENTLY companion files

**Decision.** Introduce a sibling `supabase/migrations-postapply/` directory. The Supabase CLI scans only `supabase/migrations/`; companion files go in the post-apply dir so `supabase db push` never tries to apply them inside its implicit per-file tx (the SQLSTATE 25001 root cause). The deploy workflow gained a second step that, after `supabase db push`, iterates every `supabase/migrations-postapply/*.sql` file in lex order and applies it via `psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f <file>` (autocommit; NO `-1` flag). Files ship as bare DDL with `IF NOT EXISTS` guards → safe re-runs.

**Files touched.**

- `.github/workflows/supabase-deploy.yml` — added `SUPABASE_DB_URL` env var consumption + new "Apply CONCURRENTLY companion files via psql" step + the `migrations-postapply/**` path trigger.
- `supabase/migrations/0006_epic_6_patient_invites_active_uq.sql` → moved (`git mv`) to `supabase/migrations-postapply/0006_epic_6_patient_invites_active_uq.sql`.
- `supabase/migrations-postapply/0006_*` header — rewrote the misleading "GHA already implements this" stanza (this is also the L2 fix; collapsed into the same edit).
- `supabase/migrations/0005_epic_6_doctor_accounts.sql` — updated two cross-references to point at the new `migrations-postapply/` path.
- `CLAUDE.md` — added a new "Ops note (Story 6.6 R1 H1)" stanza documenting the post-apply contract; updated the existing Story 6.6 stanza to reflect the new file location.

**Required GitHub Secret.** `SUPABASE_DB_URL` (full `postgresql://postgres:<pw>@db.<ref>.supabase.co:5432/postgres` URI; URL-encoded password). The existing `SUPABASE_DB_PASSWORD` + `SUPABASE_PROJECT_REF` pair was kept for `supabase db push`; the new step needs the assembled URI for psql. **Action item for Francis:** add `SUPABASE_DB_URL` to the `production` environment secrets before the next merge to main.

### M2 (patched inline) — staleness FK constraint name shortened

**Decision.** Picked `staleness_thresholds_user_id_fk` (30 chars).

**Files touched.**

- `packages/db/src/schema/staleness_thresholds.ts` — dropped the inline `.references()` on the `professionalUserId` column and replaced it with a table-builder `foreignKey({ name: "staleness_thresholds_user_id_fk", columns: [...], foreignColumns: [...] }).onDelete("cascade")`. Added explanatory docstring on the column. Imported `foreignKey` from `drizzle-orm/pg-core`.
- `supabase/migrations/0005_epic_6_doctor_accounts.sql` — split the existing FK section into TWO DO-blocks: (1) idempotent `ALTER TABLE … RENAME CONSTRAINT staleness_thresholds_professional_user_id_professionals_user_id TO staleness_thresholds_user_id_fk` guarded by `IF EXISTS` against the truncated 63-char name (only fires on DBs that received the pre-fix Drizzle name via `pnpm db:push`); (2) the existing `IF NOT EXISTS` + `ADD CONSTRAINT` block, now using the new short name. Fresh-DB applies skip the rename, then ADD under the new name. Re-applies converge.

**Verified truncation length.** Postgres NAMEDATALEN=63 truncates the 67-char Drizzle auto-name to `staleness_thresholds_professional_user_id_professionals_user_id` (63 chars exactly — the trailing `_fk` is dropped). Confirmed by the drift-check output (drizzle-kit reported `DROP CONSTRAINT staleness_thresholds_professional_user_id_professionals_user_id` as the existing stored name).

### L2 (patched inline) — 0006 header rewritten

Folded into the H1 edit (same file). New header text accurately describes the post-apply dir contract + the R1 H1 deploy-workflow patch; no more false claim about 0004.

### M1 (split into follow-up story) — Epic 5 baseline migration

Per the task instructions' "STOP if too large" branch. Inventory recorded in `_bmad-output/implementation-artifacts/deferred-work.md` (top entry under "Deferred from: code review of story-6.6 round 1"). Scope spans 4 enums + 6 tables + 5 indexes (3 of which are partial unique → post-apply CONCURRENTLY files) + 7 RLS policy files + Storage bucket setup, with notable design decisions across Stories 5.1–5.6 to preserve verbatim. Proposed name: "Story 5.7 — Epic 5 baseline migration" (or "Epic 5 retro addendum"). Fresh-DB rehydration remains broken until that story lands; production is unaffected.

### Quality gates (after all patches)

- `pnpm -w typecheck` — ✅ 17/17 successful (10 cached, 7 fresh).
- `pnpm -w lint` — ✅ 15/15 successful (8 cached, 7 fresh). 5 pre-existing warnings (unused eslint-disable directives in api package; not introduced by this patch).
- `pnpm --filter @healthtracker/api test:unit` — ✅ 38 test files / 334 tests passed.
- `pnpm test:integration` — ⏭️ SKIPPED (Rancher Desktop docker.sock bind-mount unsupported on this host; unchanged from R1).
- Drift-check via `pnpm exec drizzle-kit push --verbose --strict` against dev DB — output confirms (a) the staleness FK rename is the ONLY net-new schema effect of this patch round and (b) all other drift lines are pre-existing Drizzle re-emission noise (RLS DROP/CREATE, `desc` index re-emission, `now() + interval '…'` default re-emission across `patient_invites.expires_at` + `exports.expires_at`). No surprise drift.

### Commit / push

See git log + PR #57 for SHA + HEAD after this addendum.
