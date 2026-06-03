# Story 8.3: Author incremental Supabase migration for Epic 8 schema

Status: done

<!-- Third and FINAL story of Epic 8 (closes the epic). STACKS on Stories 8.1 + 8.2 — same worktree `worktree-story-8-1-operator-review-queue`, same PR branch (stacked-stories memory: do NOT open a new PR while 8.1/8.2 are unmerged). -->
<!-- This is a SQL-only delivery story: it captures the dev-only Drizzle schema deltas that 8.1 + 8.2 landed (and deliberately deferred their live `db:push` per the Epic 6/7 carry-forward) into ONE versioned migration so operator-side schema + the anonymising RLS policy reach production via `supabase-deploy`. -->
<!-- Mirrors the Epic 7 precedent exactly: `supabase/migrations/0009_epic_7_personal_context.sql` (hand-authored, byte-for-byte mirror of the Drizzle schema + policy files; `db diff --linked` is NOT runnable in this worktree — no linked project / no DATABASE_URL — so the file is authored from the schema source of truth, same as 7.6). -->

## Story

As a **platform engineer**,
I want **a single versioned Supabase migration that captures every net-new Epic 8 object — the denormalised `lab_name` column, the operator anonymising SELECT policy, the rejection-reason enum, the operator-resolution columns, and the widened observation-source enum — and nothing else**,
so that **operator-side schema and the strict anonymising RLS reach production cleanly through the `supabase-deploy` workflow, with zero pending `db:push` drift afterward**.

## Carried-forward context (read first)

- **Epic 8 is the operator role for extraction quality.** Stories 8.1 (read-only review queue) and 8.2 (confirm/reject write surface) are both `review` and STACKED on this PR branch. Their Drizzle schema changes were applied to `packages/db/src/schema/*` but the **live `db:push` was deferred** (Epic 6/7 carry-forward — no `DATABASE_URL` in the worktree). This story is where those deltas become a production migration file. No new application code.
- **The operator is NOT a DB role and NOT a table.** Provisioning is the `OPERATOR_USER_IDS` env allowlist parsed in `operatorProcedure` middleware (fail-closed). So there is **NO** `operators` table, **NO** `users.role` column, and **NO** role enum to migrate. The ONLY operator-related DDL is the anonymising SELECT policy on `extraction_review_queue` (the operator connects as the existing `authenticated` Postgres role; the GUC predicate restricts the rows).
- **The anonymisation boundary is RLS, never an app column list (NFR-S7 / AR5).** The operator gets a SELECT policy ONLY on `extraction_review_queue` and **no policy at all** on `users` / `uploads` → it reads zero rows of either (denial-by-RLS-absence). `lab_name` is denormalised onto `extraction_review_queue` precisely so no `uploads` join (and thus no `uploads.original_filename` PII leak) is ever needed. The migration must preserve this: it adds the operator SELECT policy and the `lab_name` column, and adds **no** operator policy to any other table.
- **8.2 operator writes do NOT get a write RLS policy** — they escalate to `SET LOCAL ROLE postgres` inside the `operatorProcedure` tx. So there is **NO** operator INSERT/UPDATE/DELETE policy to migrate on `extraction_review_queue` / `observations` / `uploads`. The migration is read-policy-only for the operator.

## Acceptance Criteria

> AC1–AC3 are lifted from `_bmad-output/planning-artifacts/epics.md` L1845–1861 (Story 8.3). AC4–AC8 are implementation-contract ACs locking the exact net-new object set and the Epic-7-precedent delivery shape.

1. **AC1 — One migration file, Epic 8 net-new objects only.**
   **Given** the Story 3.5 baseline (`0001_baseline_epics_0_to_3.sql`) is `done` and Epics 4–7 migrations (`0003`–`0009`) have landed,
   **When** the Epic 8 migration is authored,
   **Then** a single SQL file `supabase/migrations/0010_epic_8_operator_review.sql` is committed containing ONLY the Epic 8 net-new objects (enumerated in AC4), including the operator anonymising RLS policy that prevents the operator role from reading any `users` / `uploads` row (per Story 8.1 ACs). It contains **no** Epic 0–7 objects, **no** `DROP TABLE`, and **no** role table/enum.

2. **AC2 — Clean apply, zero drift.**
   **Given** the migration is merged to `main`,
   **When** `supabase-deploy` runs `supabase db push`,
   **Then** the migration applies cleanly and a subsequent `pnpm db:push` (Drizzle) against the linked project reports **zero pending changes** — i.e. the migration is a byte-for-byte mirror of the `packages/db/src/schema/*` deltas from 8.1 + 8.2. Re-running the migration is a no-op (every statement is `IF NOT EXISTS` / `ADD VALUE IF NOT EXISTS` / `DROP POLICY IF EXISTS … CREATE POLICY` idempotent).

3. **AC3 — CONCURRENTLY + rollout discipline.**
   **Given** the CLAUDE.md migration ops note,
   **When** the SQL is reviewed,
   **Then**: Epic 8 ships **zero new indexes and zero partial-unique changes**, so **no** `CREATE INDEX CONCURRENTLY` and **no** `supabase/migrations-postapply/` companion file is needed (identical to Epic 7 — the SQLSTATE 25001 carve-out only fires for `CONCURRENTLY` inside Supabase's implicit per-migration transaction). The PR documents this explicitly so a reviewer doesn't expect a post-apply file. The `ALTER TYPE … ADD VALUE` is a strict-superset enum WIDENING — safe non-`CONCURRENTLY` in a normal migration file per CLAUDE.md.

4. **AC4 — Exact net-new object set (the checklist, locked).**
   **Then** the migration contains EXACTLY these objects, each idempotent, in dependency order:
   - **(8.1)** `ALTER TABLE public.extraction_review_queue ADD COLUMN IF NOT EXISTS lab_name text;` (nullable, no default — NULL for pre-8.1 rows).
   - **(8.2)** `CREATE TYPE public.rejection_reason_enum AS ENUM ('decimal_separator','illegible','wrong_unit');` (guarded by the `pg_type` `IF NOT EXISTS` DO-block pattern from `0009`).
   - **(8.2)** `ALTER TABLE public.extraction_review_queue ADD COLUMN IF NOT EXISTS rejection_reason public.rejection_reason_enum;` (nullable; `IS NOT NULL` ⇒ rejected-row discriminator).
   - **(8.2)** `ALTER TABLE public.extraction_review_queue ADD COLUMN IF NOT EXISTS resolved_by_operator_id uuid;` (nullable, **NO FK** — mirrors the bare-uuid `resolved_by_patient_id`; sidesteps the FK-cascade rule, per 8.2 AC6).
   - **(8.2)** `ALTER TYPE public.observation_source_enum ADD VALUE IF NOT EXISTS 'operator_confirmed';` (widening; baseline enum is `extracted`/`manual_bia`/`patient_corrected`).
   - **(8.1)** `DROP POLICY IF EXISTS "extraction_review_queue_select_operator" … ; CREATE POLICY "extraction_review_queue_select_operator" … FOR SELECT USING (current_setting('app.current_user_role', true) = 'operator' AND reason = 'loinc_unresolved');` — byte-for-byte from `packages/db/policies/custom_rls_extraction_review_queue.sql`.

5. **AC5 — No GRANT/REVOKE churn, no patient-policy re-creation.**
   **Given** the operator connects as the existing `authenticated` role and the baseline already `GRANT SELECT … TO authenticated`,
   **Then** the migration adds **only** the new operator SELECT policy — it does **not** re-create the baseline patient `select_own_low_confidence` / `update_own_low_confidence` policies and does **not** re-issue the `REVOKE ALL … / GRANT SELECT / GRANT UPDATE(3 cols)` block (those are already in `0001`; the operator needs no new GRANT because `authenticated` already holds `SELECT`). Adding the operator SELECT policy is the entire RLS delta.

6. **AC6 — Anonymisation-boundary preservation (the security invariant).**
   **Given** NFR-S7 / AR5,
   **Then** the migration adds **no** operator policy to `users`, `uploads`, or `observations`, and adds **no** operator write policy anywhere. The operator's only grant of visibility is the single `extraction_review_queue` SELECT policy for `loinc_unresolved` rows. A reviewer can confirm by `grep`: the file's only `CREATE POLICY` is `extraction_review_queue_select_operator`.

7. **AC7 — File header documents provenance + rollout.**
   **Given** the Epic 7 precedent (`0009` header enumerates every story's contribution),
   **Then** `0010`'s header comment: (a) lists each object and its source story (8.1 vs 8.2); (b) names the mirrored Drizzle/policy source files; (c) states the `db diff --linked` deferral rationale (authored from schema source, same as 7.6); (d) states the no-post-apply-file / no-CONCURRENTLY decision and why; (e) notes the env-allowlist operator (no role table). Apply line: standard `supabase db push` via `supabase-deploy`.

8. **AC8 — Sprint + docs bookkeeping.**
   **Then**: `sprint-status.yaml` gains `8-3-…: ready-for-dev` (then `done` after review) and `epic-8` stays `in-progress` until the retro; the CLAUDE.md "Epic 8.3 migration checklist (deferred SQL)" stanza is updated to point at the shipped `0010_epic_8_operator_review.sql` (replacing the "deferred" framing); and the deferred-work doc's Epic-8 live-`db:push` item is marked resolved-by-`0010`.

**Requirements traceability:** AR6 (versioned migration delivery), AR10 (review-queue workflow schema), AR14 (audit trail schema — the `audit_log` is unchanged here; operator audit kinds are TEXT runtime values, no enum widening, like Epic 7), NFR-S7 (operator never reads PII — the anonymising SELECT policy + denial-by-RLS-absence reach prod through this file).

---

## Tasks / Subtasks

- [x] **Task 1 — Author the migration file (AC1, AC4, AC5, AC7)**
  - [x] 1.1 Create `supabase/migrations/0010_epic_8_operator_review.sql`. Open with the Epic-7-style header (AC7): provenance per story, mirrored source files, `db diff` deferral rationale, no-post-apply / no-CONCURRENTLY decision, env-allowlist note, `supabase db push` apply line.
  - [x] 1.2 **Section 1 — Enums.** `rejection_reason_enum` via the `DO $$ … IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname='rejection_reason_enum') … CREATE TYPE … END $$;` guard (copy the `0009` pattern verbatim). Values `'decimal_separator','illegible','wrong_unit'` in schema order.
  - [x] 1.3 **Section 2 — Enum value widening.** `ALTER TYPE public.observation_source_enum ADD VALUE IF NOT EXISTS 'operator_confirmed';` with a one-line comment: strict-superset widening, safe non-CONCURRENTLY, PG ≥12 allows `ADD VALUE` in a tx as long as the value is not USED in the same tx (it isn't here).
  - [x] 1.4 **Section 3 — Column ADDs on `extraction_review_queue`.** `lab_name text` (8.1), `rejection_reason public.rejection_reason_enum` (8.2), `resolved_by_operator_id uuid` (8.2) — all `ADD COLUMN IF NOT EXISTS`, all nullable, no defaults, no FK on `resolved_by_operator_id`. Inline comments mirror the Drizzle JSDoc (denormalised lab name / reject discriminator / bare-uuid no-FK rationale).
  - [x] 1.5 **Section 4 — RLS.** ONLY the operator SELECT policy: `DROP POLICY IF EXISTS "extraction_review_queue_select_operator" ON "extraction_review_queue"; CREATE POLICY … FOR SELECT USING (current_setting('app.current_user_role', true) = 'operator' AND reason = 'loinc_unresolved');`. Copy byte-for-byte from `custom_rls_extraction_review_queue.sql`. Do NOT re-create patient policies or the REVOKE/GRANT block (AC5). Keep `ALTER TABLE … ENABLE ROW LEVEL SECURITY;` (idempotent, already enabled by baseline — harmless re-assert, matches `0009` style) OR omit it since baseline enabled it; choose to OMIT to keep the file strictly net-new (document the choice in a comment).
  - [x] 1.6 Confirm the file has exactly ONE `CREATE POLICY` (AC6 grep check) and ZERO `CREATE INDEX` / ZERO `CONCURRENTLY` (AC3).

- [x] **Task 2 — Verify against schema source of truth (AC2, AC4)**
  - [x] 2.1 Diff each migration statement against the Drizzle schema: `packages/db/src/schema/extraction_review_queue.ts` (lab_name, rejection_reason_enum, rejection_reason, resolved_by_operator_id) and `packages/db/src/schema/observations.ts` (observation_source_enum value). Column types/nullability/order must match the Drizzle output. (Drizzle snake_case: `labName`→`lab_name`, `resolvedByOperatorId`→`resolved_by_operator_id`, `rejectionReason`→`rejection_reason`.)
  - [x] 2.2 Confirm NO other Epic 8 schema change exists: grep `packages/db/src/schema/*` for any Story-8.1/8.2 edit not captured (search comments `Story 8.1` / `Story 8.2`). The review-queue + observations files are the only two touched (verified in 8.1/8.2 File Lists). Document the grep result in Dev Notes.
  - [x] 2.3 Confirm the baseline does NOT already contain any of these objects (it doesn't — verified: baseline `extraction_review_queue` lacks all three columns; `observation_source_enum` baseline = `extracted`/`manual_bia`/`patient_corrected`; no operator policy). Note in Dev Notes.

- [x] **Task 3 — Ordinal + post-apply check (AC3)**
  - [x] 3.1 Confirm `0010` is the correct next ordinal: `migrations/` holds `0001`–`0006`, `0009`; `migrations-postapply/` holds `0007`, `0008`. `0010` sorts after all. No collision.
  - [x] 3.2 Confirm NO `migrations-postapply/` file is created this story (zero CONCURRENTLY DDL). Add a sentence to the PR description stating this explicitly (AC3).

- [x] **Task 4 — Docs + sprint bookkeeping (AC8)**
  - [x] 4.1 Update the CLAUDE.md "Epic 8.3 migration checklist (deferred SQL)" line: replace the deferred framing with "shipped in `supabase/migrations/0010_epic_8_operator_review.sql`".
  - [x] 4.2 In `sprint-status.yaml`: set `8-3-author-incremental-supabase-migration-for-epic-8-schema: ready-for-dev` (this story-create step) → the code-review step flips it to `done`. Leave `epic-8: in-progress` (retro closes it).
  - [x] 4.3 If `_bmad-output/implementation-artifacts/deferred-work.md` tracks the Epic 8 live-`db:push` deferral, mark it resolved by `0010`. (If no such entry, note in Dev Notes that none existed.)

- [x] **Task 5 — Quality gates (mandatory)**
  - [x] 5.1 `pnpm -w typecheck` green (no code change expected — sanity only).
  - [x] 5.2 `pnpm -w lint` green.
  - [x] 5.3 `pnpm -w format` clean (the `.sql` is not prettier-managed; confirm no stray TS/MD formatting drift from doc edits).
  - [x] 5.4 **SQL self-review** (no live DB in worktree — Epic 6/7 carry-forward): manually trace each statement for syntax + idempotency + dependency order (enum `rejection_reason_enum` created before the column that uses it; `ALTER TYPE ADD VALUE` before nothing depends on it). `supabase db push` against a real project is exercised by `supabase-deploy` on merge — the actual apply is a deploy-time gate, documented as deferred.
  - [x] 5.5 If the testcontainer harness runs in CI (`rls-adversarial` / `test:integration`), the existing `extraction-review-queue-operator.rls.test.ts` already applies the Drizzle schema via `drizzle-kit push --force` — it does NOT consume the migration file, so it is unaffected. Note this: the migration's correctness vs Drizzle is asserted by AC2's zero-drift contract at deploy, not by the testcontainer suite (which uses the schema directly).

---

## Dev Notes

### What this story is (and is NOT)

- **IS:** one hand-authored SQL file mirroring the 8.1 + 8.2 Drizzle deltas, following the Epic 7 (`0009`) precedent exactly. Plus doc/sprint bookkeeping.
- **IS NOT:** any application code, any new test, any Drizzle schema change, any RLS policy change beyond transcribing the already-authored operator SELECT policy. If you find yourself editing a `.ts` file under `packages/`, stop — that means a 8.1/8.2 delta was missed upstream, which is a finding for the PR, not a fix here.

### The exact net-new object set (verified against baseline + schema source)

| Object                                                                 | Story | Kind                         | Source file                                       |
| ---------------------------------------------------------------------- | ----- | ---------------------------- | ------------------------------------------------- |
| `extraction_review_queue.lab_name text`                                | 8.1   | column add (nullable)        | `schema/extraction_review_queue.ts`               |
| `extraction_review_queue_select_operator` policy                       | 8.1   | RLS SELECT policy            | `policies/custom_rls_extraction_review_queue.sql` |
| `rejection_reason_enum` (`decimal_separator`,`illegible`,`wrong_unit`) | 8.2   | enum create                  | `schema/extraction_review_queue.ts`               |
| `extraction_review_queue.rejection_reason`                             | 8.2   | column add (nullable)        | `schema/extraction_review_queue.ts`               |
| `extraction_review_queue.resolved_by_operator_id uuid`                 | 8.2   | column add (nullable, NO FK) | `schema/extraction_review_queue.ts`               |
| `observation_source_enum += 'operator_confirmed'`                      | 8.2   | enum value widening          | `schema/observations.ts`                          |

No role table/enum (env allowlist). No new index. No new GRANT (operator reads as `authenticated`, already granted SELECT).

### Existing files to read before writing (READ ALL)

- `supabase/migrations/0009_epic_7_personal_context.sql` — **the template.** Copy its header style, the `DO $$ … pg_type IF NOT EXISTS … CREATE TYPE … END $$;` enum guard, the `ADD COLUMN IF NOT EXISTS` style, the `DROP POLICY IF EXISTS … CREATE POLICY` style, and the section banners. Epic 7 also shipped zero CONCURRENTLY / zero post-apply — the precedent for AC3.
- `packages/db/policies/custom_rls_extraction_review_queue.sql` — the operator SELECT policy to transcribe byte-for-byte (AC4 / AC5). Note: this file ALSO contains the patient policies + REVOKE/GRANT block — those are baseline (`0001`), do NOT copy them into `0010`.
- `packages/db/src/schema/extraction_review_queue.ts` — the three column deltas + `rejection_reason_enum` (schema source of truth for AC2).
- `packages/db/src/schema/observations.ts` — `observation_source_enum` (baseline 3 values + `operator_confirmed`).
- `supabase/migrations/0001_baseline_epics_0_to_3.sql` L519–528 (baseline `observation_source_enum` = 3 values) + L628–643 (baseline `extraction_review_queue` columns — confirms all three Epic 8 columns are net-new).
- `_bmad-output/implementation-artifacts/8-1-…md` + `8-2-…md` File Lists — the authoritative inventory of every schema file 8.1/8.2 touched (extraction_review_queue.ts + observations.ts only).

### Migration-discipline gotchas (pre-baked for R1)

- **`ALTER TYPE … ADD VALUE` in a transaction.** Supabase wraps each migration file in an implicit tx. PG ≥12 permits `ALTER TYPE … ADD VALUE` inside a tx _provided the new value is not referenced in the same tx_. This migration only ADDs the value (no row uses it), so it is safe inside Supabase's wrapper. Use `ADD VALUE IF NOT EXISTS` for re-run safety. (This is the strict-superset WIDENING the CLAUDE.md note blesses as safe non-CONCURRENTLY.)
- **No CONCURRENTLY, no post-apply file.** Zero new indexes this epic → the `migrations-postapply/` + SQLSTATE-25001 carve-out does not apply. Mirror Epic 7. State it in the PR (AC3) so a reviewer doesn't flag a "missing" post-apply file.
- **Idempotency.** Every statement re-runnable: `ADD COLUMN IF NOT EXISTS`, `pg_type IF NOT EXISTS` enum guard, `ADD VALUE IF NOT EXISTS`, `DROP POLICY IF EXISTS … CREATE POLICY`. This matches the `0009` contract and AC2's "re-running is a no-op."
- **Dependency order.** `rejection_reason_enum` (Section 1) MUST precede the `rejection_reason` column add (Section 3). `observation_source_enum ADD VALUE` has no dependents in-file. Keep the `0009` section ordering: Enums → (enum widening) → Column ADDs → RLS.
- **Zero-drift contract (AC2).** The whole point: after `supabase db push`, `pnpm db:push` must report nothing pending. Achieved only if column types/nullability and the enum value-order match Drizzle's emitted DDL exactly. Snake_case the camelCase Drizzle names. No `DEFAULT`, no `NOT NULL` (all three columns are nullable in Drizzle).

### Existing behaviour that must be preserved (regression watch)

- **Patient review-queue RLS (Story 2.4)** — untouched. The migration adds ONLY the operator SELECT policy via an independent `CREATE POLICY`; RLS policies are OR-combined, so the patient `low_confidence` scope is unchanged. Do not touch the baseline patient policies.
- **`observations` partial-unique index** (`… WHERE source = 'manual_bia'`) — the new `operator_confirmed` enum value does NOT touch the index predicate (the predicate names `manual_bia` literally). Confirmed unaffected (8.2 AC7). No index DDL in this story.
- **`extraction_review_queue` idempotency index** (`upload_id, biomarker_name, reason`) — unchanged; not re-created.
- **Testcontainer RLS suite** — applies the Drizzle schema directly via `drizzle-kit push --force`, NOT the migration file. So `0010` does not alter what the suite tests; the migration-vs-schema fidelity is a deploy-time (`db push` then `db:push` zero-drift) contract, not a unit/integration assertion.

### Project Structure Notes

- **NEW file:** `supabase/migrations/0010_epic_8_operator_review.sql`.
- **MODIFIED (docs/bookkeeping only):** `CLAUDE.md` (Epic 8.3 checklist line → shipped), `_bmad-output/implementation-artifacts/sprint-status.yaml` (8-3 status), optionally `_bmad-output/implementation-artifacts/deferred-work.md` (resolve Epic 8 db:push item).
- **NO** `packages/**`, **NO** `apps/**`, **NO** `services/**`, **NO** `migrations-postapply/**` changes.

### Open questions for Francis (surface at hand-off, do NOT block)

1. **`ENABLE ROW LEVEL SECURITY` re-assert** — baseline already enabled RLS on `extraction_review_queue`. I plan to OMIT the re-assert from `0010` to keep it strictly net-new (it's a harmless no-op either way). Flag if you'd rather mirror `0009`'s style of re-asserting it for self-containment.
2. **Epic 8 retro** — after `0010` lands and the stacked PR (8.1+8.2+8.3) merges, `epic-8-retrospective` is `optional`. The deferred live-`db:push` items from 8.1/8.2 are resolved by this migration at deploy; worth a one-line retro note that the stacked-PR + batched-migration pattern carried cleanly from Epics 5–7.

### References

- [Source: `_bmad-output/planning-artifacts/epics.md` L1839–1861] Story 8.3 spec (AR6/AR10/AR14, NFR-S7).
- [Source: `supabase/migrations/0009_epic_7_personal_context.sql`] The hand-authored batched-migration precedent this story mirrors (header style, enum guard, idempotent DDL, zero-CONCURRENTLY rationale).
- [Source: `packages/db/policies/custom_rls_extraction_review_queue.sql`] The operator SELECT policy transcribed verbatim.
- [Source: `packages/db/src/schema/extraction_review_queue.ts` + `observations.ts`] Schema source of truth for the AC2 zero-drift contract.
- [Source: `CLAUDE.md` "Migration discipline" + "Epic 8.3 migration checklist (deferred SQL)"] The ops rules + the pre-written object checklist this story executes.
- [Source: `_bmad-output/implementation-artifacts/8-1-…md` + `8-2-…md`] The two predecessor stories whose deferred schema this migration captures.

## Dev Agent Record

### Agent Model Used

claude-opus-4-8 (BMad bmad-create-story + bmad-dev-story workflows)

### Debug Log References

- Migration-invariant grep (executable lines only, comments stripped): `CREATE POLICY` 1, `CREATE INDEX` 0, `CONCURRENTLY` 0, `GRANT`/`REVOKE` 0, `ADD COLUMN` 3, `ADD VALUE` 1, `CREATE TYPE` 1, `CREATE TABLE`/`DROP TABLE` 0 — matches AC4/AC5/AC6 exactly.
- Operator-policy fidelity: `diff` of the `CREATE POLICY extraction_review_queue_select_operator` block between `0010` and `packages/db/policies/custom_rls_extraction_review_queue.sql` → **IDENTICAL**.
- Schema-source verification: only two schema files carry Story 8.1/8.2 edits (`grep -rln "Story 8\.\(1\|2\)" packages/db/src/schema/` → `observations.ts`, `extraction_review_queue.ts`). `observation_source_enum` order confirmed `extracted, manual_bia, patient_corrected, operator_confirmed`. Baseline `extraction_review_queue` (0001 L628–643) confirmed to lack all three Epic 8 columns; baseline `observation_source_enum` = 3 values.
- Ordinal: `migrations/` had `0001`–`0006`, `0009`; post-apply had `0007`,`0008` → `0010` sorts after all, no collision.
- `pnpm -w typecheck` 17/17 (cached — no TS change) · `pnpm -w lint` 15/15 · `pnpm -w format` clean (`.sql` is not prettier-managed; CLAUDE.md doc edit passed).

### Completion Notes List

- Implemented 2026-06-02 on `worktree-story-8-1-operator-review-queue`, STACKED on Stories 8.1 + 8.2 (same PR branch; no new PR while predecessors unmerged).
- **NEW file `supabase/migrations/0010_epic_8_operator_review.sql`** — consolidates the six net-new Epic 8 objects (3 column adds, 1 enum create, 1 enum-value widening, 1 operator SELECT policy), each idempotent, in dependency order (enum before its column; enum-value widening standalone; policy references only existing `reason` column). Header documents per-story provenance, mirrored source files, the env-allowlist (no role table), the no-write-policy/escalation note, the no-GRANT-churn rationale, the no-CONCURRENTLY/no-post-apply decision, the `ALTER TYPE ADD VALUE`-in-tx safety note, and the authored-from-schema-source (no linked project) rationale — mirroring the Epic 7 (`0009`) precedent.
- **Anonymisation boundary preserved (AC6):** the file's only `CREATE POLICY` is `extraction_review_queue_select_operator`; no operator policy on `users`/`uploads`/`observations`; no operator write policy anywhere.
- **No GRANT/REVOKE, no patient-policy re-creation (AC5):** baseline `0001` already `GRANT SELECT … TO authenticated` and ships the patient policies; only the net-new operator SELECT policy is added. RLS left ENABLED by baseline (not re-asserted) to keep the file strictly net-new — chose the OMIT option from the story's open question 1.
- **No post-apply file (AC3):** zero new indexes → no `migrations-postapply/` companion; `ALTER TYPE ADD VALUE` is a strict-superset widening, safe non-CONCURRENTLY. Documented for the reviewer.
- **Deferred (no DB / linked project in worktree — Epic 6/7 carry-forward):** the live `supabase db push` apply + the `pnpm db:push` zero-drift check (AC2) run at deploy time via the `supabase-deploy` GHA workflow. The testcontainer RLS suite applies the Drizzle schema directly (`drizzle-kit push --force`), NOT this file, so it is unaffected — migration-vs-schema fidelity is the deploy-time zero-drift contract, asserted here by the byte-for-byte diff + grep checks.
- **deferred-work.md:** no Story-8-specific live-`db:push` entry existed to resolve (the db:push deferrals there are general carry-forward, not an Epic-8 line item); left unchanged.
- Docs: CLAUDE.md "Epic 8.3 migration checklist (deferred SQL)" stanza rewritten to "Epic 8 migration (Story 8.3 — shipped)" pointing at `0010`. sprint-status `8-3-…` → `review`; `epic-8` stays `in-progress` (retro closes it).

### File List

**NEW**

- `supabase/migrations/0010_epic_8_operator_review.sql`

**MODIFIED (docs/bookkeeping only)**

- `CLAUDE.md` (Epic 8.3 checklist → "shipped in 0010")
- `_bmad-output/implementation-artifacts/sprint-status.yaml` (8-3 status; last_updated)
- `_bmad-output/implementation-artifacts/8-3-author-incremental-supabase-migration-for-epic-8-schema.md` (this story file)

**NO `packages/**`, `apps/**`, `services/**`, or `migrations-postapply/**` changes.**

## Senior Developer Review (AI)

**Reviewed:** 2026-06-02 · **Outcome:** Approve (1 LOW/MED hardening applied) · **Method:** 3-layer adversarial (Blind Hunter — diff only; Edge Case Hunter — diff + repo read; Acceptance Auditor — diff vs spec). The Acceptance Auditor confirmed all 8 ACs satisfied and all tasks done with no violations. The Edge Case Hunter independently verified the migration is a faithful, drift-free, idempotent, dependency-ordered mirror of the 8.1+8.2 Drizzle deltas with the anonymisation boundary, no-GRANT, and no-write-policy invariants intact. One convergent finding (the enum existence guard) was patched.

### Action Items

- [x] **MED — `rejection_reason_enum` existence guard was not namespace-qualified** (`SELECT 1 FROM pg_type WHERE typname = …`). Raised by Blind Hunter; Edge Case Hunter noted it matched the `0009` precedent but the baseline `0001` uses the stricter schema-joined form. A same-named type in another schema (the repo already has a `pgboss` schema with its own enums — confirmed) could short-circuit the create and leave `public.rejection_reason_enum` missing for the subsequent column ADD. **Fix:** hardened the guard to `FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace WHERE n.nspname = 'public' AND t.typname = 'rejection_reason_enum'` — byte-identical to the baseline `0001` form. (`supabase/migrations/0010_epic_8_operator_review.sql`)

### Dismissed (with rationale)

- **`ALTER TYPE … ADD VALUE` inside Supabase's implicit transaction (potential SQLSTATE 25001)** — verified SAFE. `supabase/config.toml` pins PG 15; the "cannot run in a transaction block" restriction is PG ≤11 only. PG 12+ permits `ADD VALUE` in a tx provided the value is not _referenced_ in the same tx — `operator_confirmed` is never used in this file, and the `rejection_reason` column add uses a _different_ enum. Both hunters confirmed.
- **Unquoted enum literal `reason = 'loinc_unresolved'` in the policy predicate** — PG coerces text→`review_reason_enum` correctly and would raise at policy-create time on a typo (self-guarding). Cosmetic only.
- **`DROP POLICY IF EXISTS … CREATE POLICY` non-atomicity** — both run inside the implicit per-migration tx (atomic to concurrent readers); the operator read policy is brand-new and OR-combined, so it cannot transiently widen/narrow the patient scope. No window.
- **`current_setting('app.current_user_role', true)` injection/bypass** — `missing_ok=true` yields fail-closed `NULL = 'operator'` → row filtered; the GUC value is compared as data, never concatenated into SQL. Correct.
- **AC2 live `db push` / `db:push` zero-drift not run in worktree** — deferred to deploy by design (no linked project / DATABASE_URL), matching the Epic 7 (`0009`) precedent; asserted here by the byte-for-byte policy diff + the schema-vs-migration field-by-field check.

### Post-patch gates

`pnpm -w typecheck` 17/17 · `pnpm -w lint` 15/15 · `pnpm -w format` clean (the patch is SQL-only; `.sql` is not prettier-managed, no TS/MD touched). Executable-line invariants re-confirmed after the patch: 1 `CREATE POLICY`, 0 `CREATE INDEX`, 0 `CONCURRENTLY`, 3 `ADD COLUMN`, balanced `DO $$ … END $$`. Live `db push` apply + zero-drift check remain deploy-time gates via `supabase-deploy`.
