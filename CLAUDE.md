# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository Overview

Full-stack health tracker built as a **pnpm + Turborepo monorepo** sharing code between a Next.js 15 web app and a React Native Expo mobile app. The API layer uses tRPC for end-to-end type safety, Drizzle ORM for database access (PostgreSQL via Vercel Postgres), and Supabase for authentication.

## Behavioral guideline

### 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:

- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them - don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

### 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

### 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:

- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it - don't delete it.

When your changes create orphans:

- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: Every changed line should trace directly to the user's request.

### 4. Goal-Driven Execution

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:

- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:

```
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
```

Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.

---

**These guidelines are working if:** fewer unnecessary changes in diffs, fewer rewrites due to overcomplication, and clarifying questions come before implementation rather than after mistakes.

## Commands

All commands run from the repo root unless noted.

**Development**

```bash
pnpm dev           # all apps in parallel (turbo watch)
pnpm dev:next      # web app only (+ its dependencies)
```

**Build / Check**

```bash
pnpm build         # all packages
pnpm typecheck     # tsc across all packages
pnpm lint          # eslint across all packages
pnpm lint:fix      # eslint with --fix
pnpm format:fix    # prettier with --write
```

**Database**

```bash
pnpm db:push       # push Drizzle schema to DB (no migration files)
pnpm db:studio     # open Drizzle Studio UI
```

**Database tests**

```bash
pnpm --filter @healthtracker/db test:unit         # pure-logic, no DB
pnpm --filter @healthtracker/db test:rls          # requires `supabase start`
pnpm --filter @healthtracker/db test:integration  # requires Docker (testcontainers)
```

`test:integration` launches an ephemeral Postgres 16 container per suite via `@testcontainers/postgresql`, applies the Drizzle schema with `drizzle-kit push --force`, and runs `__tests__/integration/**/*.integration.test.ts`. Use it for cases mocks can't reach — partial-index WHERE clauses, JSONB ops, ON CONFLICT semantics, raw-SQL drift between worker and API. See `packages/db/__tests__/integration/setup.ts`.

> **Ops note (Epic 2 retro / Story 2.7 R2-P213):** `pnpm db:push` is fine for
> additive column / index changes on a quiet DB. It is **not** safe for
> altering the `WHERE` clause of a **partial unique index** against
> production: Drizzle emits `DROP INDEX` + `CREATE UNIQUE INDEX`
> (non-`CONCURRENTLY`), which takes a `ShareLock` and opens a window for a
> concurrent insert to violate the new constraint. For those changes write a
> migration file with `CREATE UNIQUE INDEX CONCURRENTLY ... ; DROP INDEX
CONCURRENTLY ...` and apply via `psql` directly (Supabase CLI's
> migration runner wraps every file in an implicit transaction —
> `CONCURRENTLY` fails inside it with SQLSTATE 25001; there is **no**
> `-- supabase: no-transaction` directive despite community lore).
>
> **Ops note (Epic 4 retro / Story 4.4):** the above ShareLock risk
> applies only to **narrowing** or **shifting** WHERE-clause changes.
> A **strict-superset widening** (e.g. adding a new event value to an
> `event IN (...)` predicate) is safe non-CONCURRENTLY: any row that
> lands during the swap window is either (a) already-valid under the
> wider constraint because it was valid under the narrower one, or
> (b) a value no production code writes yet. Widening migrations
> can ship as a normal Supabase CLI migration file. See
> `supabase/migrations/0004_epic_4_audit_index_letter_queued.sql`
> for the canonical 3-step pattern (create `_v2` → drop original →
> rename to preserve `ON CONFLICT ON CONSTRAINT <name>` symbols).
>
> **Ops note (Epic 5 baseline migration / Story 6.6 retro addendum):**
> `supabase/migrations/0005_epic_5_sharing_baseline.sql` lands the
> previously-undocumented Epic 5 schema (`pending_invites`, `share_tokens`,
> `share_token_biomarkers`, `conversation_starter_cache`, `exports`,
> `account_deletion_requests` + 4 enums + RLS + Storage `exports` bucket +
> `pseudonymize_patient_id()` SQL helper) so that the Epic 6 ALTERs on
> `pending_invites.resolved_user_id` no longer fail on a fresh-DB apply.
> Four partial unique indexes ship in
> `supabase/migrations-postapply/0008_epic_5_partial_uniques.sql` with
> `CREATE … CONCURRENTLY` (same SQLSTATE 25001 rule as Epic 6's split).
>
> **Ops note (Epic 6 consolidated migration / Story 6.6):** Two files ship —
> `supabase/migrations/0006_epic_6_doctor_accounts.sql` (tables, enums, FKs,
> non-CONCURRENTLY indexes, RLS policies for `professionals` / `patient_invites`
> / `staleness_thresholds` + the deferred `pending_invites.resolved_user_id` FK)
> and `supabase/migrations-postapply/0007_epic_6_patient_invites_active_uq.sql`
> (the partial unique index `patient_invites_professional_identifier_active_uq` —
> split out because it gates the doctor → patient invite write surface and
> MUST apply with `CREATE … CONCURRENTLY` via `psql` directly per the
> SQLSTATE 25001 rule above). The runtime doctor-data-isolation invariant is
> locked in by `packages/db/__tests__/rls/{professionals,patient_invites,staleness_thresholds}.rls.test.ts`
> — those suites are the source of truth for what the migration's RLS bodies must enforce.
>
> **Ops note (Story 6.6 R1 H1 — deploy contract for CONCURRENTLY-bearing
> companion files):** The `supabase-deploy` GitHub Actions workflow runs
> `supabase db push` first (canonical `supabase/migrations/` dir), then a
> second step iterates every file under `supabase/migrations-postapply/*.sql`
> in lex order and applies each via `psql "$SUPABASE_DB_URL" -v
ON_ERROR_STOP=1 -f <file>` (autocommit; NO `-1` flag). Companion files
> live in the sibling `migrations-postapply/` dir specifically so the
> Supabase CLI does NOT pick them up inside its implicit per-file
> transaction. Files MUST: ship as bare DDL (no `BEGIN`/`COMMIT`), use
> `CREATE … CONCURRENTLY IF NOT EXISTS` (or other `IF NOT EXISTS` guard)
> so partial-success re-runs are safe, and have their parent table
> created by a sibling migration that runs in `db push` above. Naming:
> use a post-apply ordinal that sorts AFTER its parent (e.g. `0007_*`
> depends on `0006`'s `patient_invites`; `0008_*` depends on `0005`'s
> `share_tokens` / `exports` / `account_deletion_requests`); psql
> lex-orders inside the post-apply dir.
> Precedent files: `0007_epic_6_patient_invites_active_uq.sql` and
> `0008_epic_5_partial_uniques.sql`.

**UI components**

```bash
pnpm ui-add        # add a shadcn/ui component to packages/ui
```

**Mobile (from `apps/expo/`)**

```bash
pnpm dev           # start Expo dev server
pnpm dev:ios       # iOS simulator
pnpm dev:android   # Android emulator
```

**Environment**: Copy `.env.example` to `.env` at the repo root before running anything. Required vars: `DATABASE_URL`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `CORS_ORIGIN`. Web scripts use `with-env` to inject these. Story 4.1 adds `ANTHROPIC_API_KEY` (NFR-S6: empty in dev → stub adapter; non-empty in prod → real Claude Sonnet, DPA-gated), `LLM_SERVICE_URL`, and `EXPO_PUBLIC_LLM_SERVICE_URL` for the persistent `services/llm` SSE server (`pnpm --filter @healthtracker/llm-service dev` on `:3001`). Story 5.1 adds `SHARE_TOKEN_HMAC_SECRET` (NFR-S6: required outside `NODE_ENV=development|test` — boot fails on empty in staging/preview/production; dev/test falls back to a deterministic dev-only secret with a console warning). Story 5.2 adds `WEB_APP_URL` (base for the `/m/<shareTokenId>.<tokenHmac>` magic-link the patient's share-sheet emits; same boot-gate as the HMAC secret).

**Sharing duration notes (Story 5.2)**: `share_tokens.expires_at` is now nullable. `NULL` means "Sem prazo" (no expiry — patient-confirmed via a `NoExpiryConfirmDialog` extra-confirmation modal). RLS predicates on `share_tokens` and `share_token_biomarkers` updated to `revoked_at IS NULL AND (expires_at IS NULL OR expires_at > now())`. The `conversation_starter_cache` table is pre-warmed at token-create time via a `conversation_starter.generate` pg-boss queue hosted in `services/llm` (mirror of `letter.generate`). Dev / CI use a deterministic stub adapter (canned payload); real Anthropic generation lands in Story 6.2 alongside the DPA. The pg-boss job is enqueued inside the same Drizzle transaction as the `share_tokens` INSERT via the outbox pattern (`INSERT INTO pgboss.job ... ON CONFLICT DO NOTHING`) so a mid-flight crash leaves no orphan cache row + no orphan job. The duration-picker screen owns the default selection of `"7d"`; there is intentionally no server-side default on `createShareTokenInputSchema.duration`.

**Sharing schema notes (Epic 5 / Story 5.1)**: Three sharing tables (`pending_invites`, `share_tokens`, `share_token_biomarkers`) live in `packages/db/src/schema/sharing.ts`. Three design decisions worth preserving across stories: (a) per-biomarker scope uses a **junction table** (`share_token_biomarkers`), not a JSONB column on `share_tokens` — composite PK gives atomic UPSERT semantics + RLS predicates can target individual rows for the LGPD `visible = true` filter (NFR-S3); (b) `pending_invites.resolved_user_id` is **nullable** and stays NULL until Epic 6's `claimInviteByDoctor` flips it on doctor sign-up — the FK to `users(id)` is deferred to Epic 6 (no FK declared yet to avoid forward-referencing the doctor surface); (c) the doctor-side RLS principal is bound via `SET LOCAL app.current_share_token_id = '<uuid>'` (mirrors `app.current_patient_id` on the patient principal) — see `packages/db/policies/custom_rls_share_*.sql` for the policy bodies and `packages/api/src/trpc.ts` for the eventual `doctorProcedure` middleware.

## Architecture

### Package graph

```
apps/web (Next.js 15)  ←──────────────────────────────┐
apps/expo (React Native)                               │
         │                                             │
         ▼                                             │
packages/api  (tRPC routers)                          ui, validators
         │                                             │
         ├── packages/db   (Drizzle ORM + schema) ────┘
         ├── packages/auth (Supabase client wrappers)
         └── packages/validators (Zod schemas)

tooling/{eslint,prettier,tailwind,typescript}  — shared config, no runtime code
```

### tRPC

- Context is built in `packages/api/src/trpc.ts`: it attaches the Supabase session and the Drizzle `db` client to every request.
- Routers live in `packages/api/src/router/`. Add a new router there and register it in `packages/api/src/router/index.ts`.
- `publicProcedure` vs `protectedProcedure` — the latter throws `UNAUTHORIZED` if there is no session.
- Dev mode adds a fake 100–500 ms delay via timing middleware to surface latency issues early.
- Both apps consume the API through a shared tRPC client; the web app also uses React Server Components with a server-side caller.

### Database

- Schema files live in `packages/db/src/schema/`. The auth schema (`auth-schema.ts`) is auto-generated by Supabase — do not hand-edit it.
- Drizzle is configured for `snake_case` column naming and the `postgres-js` driver (`packages/db/src/client.ts`). The project originally used `@vercel/postgres` from the `create-t3-turbo` starter, but that driver speaks Neon's serverless HTTP protocol and refuses Supabase connection strings — it was swapped for postgres-js (Supabase-compatible, same driver `services/extraction/` already uses).
- Use `pnpm db:push` (not `drizzle-kit generate` + `migrate`) — this project uses push-based schema sync.
- Connection pooling must use **session mode** (not transaction mode) for Supabase RLS compatibility.

### Authentication

- All Supabase client creation is centralised in `packages/auth/`. Import from there; never instantiate Supabase directly in apps or other packages.
- The web app uses `@supabase/ssr` for SSR-compatible cookies. Middleware at `apps/web/src/middleware.ts` refreshes sessions on every request.
- Expo uses the standard `@supabase/supabase-js` client with AsyncStorage.

### Web app (`apps/web`)

- Next.js 15 with App Router and React 19.
- Tailwind 4 (PostCSS plugin, no `tailwind.config.js`). Shared base config lives in `tooling/tailwind/`.
- TypeScript errors are suppressed during `next build` (`ignoreBuildErrors: true`); type checking runs separately via `pnpm typecheck` in CI.
- Workspace packages are listed under `transpilePackages` in `next.config.js` so hot-reload works across packages.

### Mobile app (`apps/expo`)

- Expo SDK 54, React Native 0.81.5, Expo Router 6 for file-based navigation.
- NativeWind 5 provides Tailwind styling; the shared `tailwind-config` package is referenced directly.
- React Compiler and typed routes are enabled as experimental features.

### Shared UI (`packages/ui`)

- Components are added via `pnpm ui-add` (shadcn/ui CLI). Do not copy-paste component code manually.
- All components are re-exported from `packages/ui/src/index.ts`.

## Code review discipline (Epic 1 + Epic 2 retros)

Two rounds of code review per story is a hard process gate, not a recommendation. Patterns that the round-1 → round-2 history has surfaced repeatedly:

- **Narrow catches by default.** Any `try { ... } catch (err) { ... }` in new code must articulate which error shapes it intends to swallow (e.g. `if (err.code === '23505') ...; throw err`). Broad `catch (err)` that fail-opens swallows programmer errors (`TypeError`, `ReferenceError`, `SyntaxError`) and infra faults indistinguishably. The Story 2.5 R2-P193 and Story 2.8 R2-P226 patches both narrowed broad catches after the fact — write them narrow the first time.
- **Query-param coupling check.** When a route helper adds a query-string flag (`postFooRoute(source)` → `/foo?source=...`), the round-1 reviewer must verify the destination route actually consumes the flag. Story 2.5 R1-P153 shipped a producer with no consumer; R2-P171 had to wire it.
- **Round-2 hunts what round-1 broke or half-finished.** The recurring shape is "round-1 patch was correct in isolation but wrong when composed with the surrounding system." Round-2 reviewers explicitly look for: dead-code guards (a SELECT already filters by X, then the application code checks X again), TOCTOU on SELECT-EXISTS-then-INSERT (use partial unique indexes + catch 23505 at the helper), partial-index ON-CONFLICT `where` clauses that exclude the very rows they were meant to dedup, query-param producers without consumers, broad `catch` that swallows programmer errors.
- **Don't use `pnpm db:push` for partial-index `WHERE` changes in prod.** See ops note above.
- **6-identity RLS matrix mandatory for new sharing-related tables:** `correctPatient`, `wrongPatient`, `serviceRole`, `doctorWithActiveToken`, `doctorWithExpiredToken`, `doctorWithRevokedToken`. Story 5.1 round-2 found three tests claiming the full matrix but shipping only the patient subset; round-1 reviewers must verify every identity in the docstring has a corresponding `it(...)` block before approving.

### Export discipline (Story 5.5)

LGPD Art. 18 data-portability is the one sharing-adjacent surface NOT gated by `premiumProcedure` — gating it on subscription tier would be illegal. `requestExport` uses `protectedProcedure`; reviewers must verify the gate stays off when touching this code. Generation runs through the `record.export.generate` pg-boss queue hosted in `services/llm`; the consumer uploads to the private `exports` Supabase Storage bucket at `<patient_id>/<export_id>.<format>` and the API resolver mints a fresh signed URL (`EXPORT_DOWNLOAD_TTL_SECONDS = 3600` — 1h) on each `getExport` poll. The storage object lifetime is 24h (`expires_at` column default). Concurrent double-tap dedup is server-enforced via the `exports_active_uq` partial unique index `(patient_id) WHERE status IN ('queued','generating')` + the resolver's narrow `23505` catch (mirrors Story 5.1's `createShareToken` idempotency-shield). Storage orphan cleanup on tx-failure and final-attempt-failed branches is handled inside the consumer (best-effort `supabase.storage.remove`). The Lora / DM Sans PDF font bundle is deferred (currently Helvetica fallback) and tracked in deferred-work.

### Account deletion discipline (Story 5.6)

LGPD Art. 18 right-to-erasure — also exempt from any premium gate. `accountRouter.requestDeletion` uses `protectedProcedure`; the partial unique index `account_deletion_requests_active_uq ON (patient_id) WHERE status IN ('queued','processing')` enforces single-in-flight; the narrow 23505 catch also accepts `status='complete'` (idempotent — a completed deletion IS the requested outcome). Pseudonymization (AR20 ADR): every audit row for the deleted patient gets `actor_id` and `resource_id` UPDATEd to a deterministic uuid carved from `sha256(patient_id || ACCOUNT_DELETION_SALT)`; metadata is regex-scrubbed in place. The append-only invariant (NFR-S4) is preserved — rows survive, identifying links don't. **Salt rotation invalidates linkability across the boundary** — acceptable trade-off; documented in `services/llm/src/account-deletion.ts`. **FK cascade audit going forward:** every NEW FK to `users(id)` MUST have `onDelete: 'cascade'` or the deletion will leave orphan rows. `audit_log` is deliberately exempt (pseudonymize-only). `account_deletion_requests.patient_id` is intentionally FK-less (the ledger row outlives the user). **Story 6.3 documented exception:** `pending_invites.resolved_user_id` uses `onDelete: 'set null'` — see "Professional account activation (Story 6.3)" below. New exceptions MUST be documented in that paragraph alongside a regression test. **Storage cleanup checklist:** `PATIENT_STORAGE_BUCKETS` in `services/llm/src/account-deletion.ts` lists every patient-scoped bucket cleaned at deletion time (`lab_uploads`, `exports`). Any future patient-scoped bucket MUST be added there. The list is paginated (Supabase `list()` defaults to 100; R1 fix added pagination loop with `limit: 1000, offset`). **pg-boss job cleanup:** at deletion step 4, the consumer removes rows from `pgboss.job` + `pgboss.archive` matching `data->>'patientId' = $1` to prevent the raw uuid leaking in queue payloads until the archive sweep. **UX:** EXCLUIR magic-word + 30s visible cooldown (Story 5.4's deferred-server-write pattern, longer window because irreversible); Tier-2 muted-neutral destructive button (NOT red). **Auth admin classification:** 404 → success (already-deleted); 401/403 → `UnrecoverableAuthError` (skip retry budget; env misconfig won't auto-heal); 5xx → retry. **Final-attempt forensics:** the `account.deletion_failed` audit is pre-emitted BEFORE `supabase.auth.admin.deleteUser` on the final attempt — so a partial auth-side failure is traced even if the process dies mid-call. Retries 1-2 emit `account.deletion_retry` (system-actor) — not in `ACCESS_LOG_EVENT_KINDS` (patient is signed out).

### Pre-auth landing discipline (Story 6.1)

The doctor-side magic-link destination (`/m/[token]`) is a Next.js App Router server component that resolves to one of four states (`active` / `expired` / `revoked` / `invalid`) before the doctor authenticates. Critical disciplines:

- **`sharingRouter.getPreAuthContext` is a `publicProcedure`, NOT `doctorProcedure` — deliberate.** The doctor has no auth yet, no `x-share-token` header. The doctor-side RLS predicate on `share_tokens` filters `revoked_at IS NULL AND (expires_at IS NULL OR > now())`, so running this resolver under `doctorProcedure` would collapse `expired`/`revoked`/`invalid` into a single 404 and erase the patient's surveillance surface. The RLS test file `share_tokens_preauth.rls.test.ts` guards against the regression: a future refactor that "fixes" this back to `doctorProcedure` will fail the matrix.
- **Audit row fires on EVERY pre-auth attempt** — `active` / `expired` / `revoked` / `invalid`. The patient's Access Log MUST surface probes against revoked or invalid links (that is the entire point). Metadata convention: `{ phase: "pre-auth" | "post-auth", status, userAgent }`. Story 6.2 will emit `phase: "post-auth"` from the authenticated history fetch; the `ACCESS_LOG_EVENT_LABEL_PT_BR_FN("share_token.read", { shareTokenReadPhase })` branch handles both. Legacy rows without `phase` fall back to the pre-Story-6.1 label.
- **No enumeration oracle.** Unknown `shareTokenId`, bad HMAC, and malformed `[token]` URL segment all render the SAME `invalid` UI with the SAME pt-BR copy.
- **R1-M3 audit asymmetry — actor/resource id choice per branch.** The patient-surveillance surface (`audit_log_select_own` RLS) joins audit rows to the patient via `resource_id` → `share_tokens.id`. To keep that join honest while still bucketing unverified probes, branches use different sentinels:
  - **active / expired / revoked** — `actorId = resourceId = input.shareTokenId` (verified: HMAC matched a real row; owning patient sees the row).
  - **bad-HMAC against a real row** — `actorId = SHARE_TOKEN_UNKNOWN_SENTINEL`, `resourceId = input.shareTokenId` (the row IS real; owning patient sees the probe; the doctor identity is sentinel because the HMAC failed).
  - **unknown shareTokenId** — `actorId = resourceId = SHARE_TOKEN_UNKNOWN_SENTINEL` (no real row; sentinel collects every "Zod-shaped uuid that doesn't exist" probe under one filterable bucket).
  - **malformed `[token]` segment** — same as unknown-id (sentinel/sentinel).
- **R1-H1 visibility trade-off — sentinel-resource rows are forensic-only.** Rows with `resourceId = SHARE_TOKEN_UNKNOWN_SENTINEL` are NOT visible to any patient under `audit_log_select_own` RLS (no patient owns the sentinel; the EXISTS subquery returns FALSE). This is the honest answer: a malformed URL pointed at NO patient, so there is no patient to surface the probe to. The row is still WRITTEN (forensic ledger preserved); operational forensics queries via service-role can count + alert on `actor_id = SHARE_TOKEN_UNKNOWN_SENTINEL`. **Do not "fix" this by widening the RLS predicate** — there is no patient identity to widen to. If a future story needs to surface malformed probes per-patient, it must recover a patient binding from the URL (e.g. a separate per-patient short-code) and write the row with the real `resource_id`.
- **DoS posture.** Audit-fire-on-invalid is a DoS vector — a doctor (or attacker) hammering `/m/<random>.<random>` writes a row per attempt. Mitigation is deferred to a future infra story (rate-limit at the Next.js edge / Vercel WAF, NOT in the resolver — keeping the resolver dumb keeps the audit promise honest). **Tracked in `_bmad-output/implementation-artifacts/deferred-work.md`** (Story 5.6 R1 precedent for cross-story deferral pointers).
- **HMAC compare runs even for revoked/expired rows.** A doctor with an old valid HMAC must see the correct dead-link state, not `invalid`. Do NOT short-circuit on revocation/expiry before the HMAC check.
- **`resolvePatientFirstName` never throws.** It derives from Supabase Auth email local-part (no `users.first_name` column yet); any SDK failure or empty email returns `null` and the UI renders `"Alguém"`. Narrow catch — `TypeError` / `ReferenceError` / `SyntaxError` still propagate.

### Professional account activation (Story 6.3)

The `professionals` table is the doctor-side identity surface — populated only by `sharingRouter.activateProfessionalAccount`, which the doctor invokes from inside the Conversation Starter view (`apps/web/src/app/m/[token]/view/ProfessionalAccountBanner.tsx` → `ProfessionalAccountModal.tsx`). Critical disciplines:

- **`professionals.user_id` IS the PK.** One row per Supabase user, populated only at Story 6.3 activation. `ON CONFLICT (user_id) DO NOTHING` makes double-tap idempotent (AC5).
- **`pending_invites.resolved_user_id` FK uses `onDelete: "set null"` (NOT cascade).** This is the FIRST justified exception to the Story 5.6 "every new FK to `users(id)` must use cascade" rule. The `pending_invites` row encodes the patient's intent ("I wanted to share with Dr. X"); if Dr. X later deletes their account, the patient's authored intent must survive — the row simply orphans back to "unresolved". Cascading would silently delete patient-authored data on a third-party (doctor) action. Locked into a regression test (`pending_invites_resolved_user_id_fk.rls.test.ts`); a future PR that "fixes" this to cascade fails CI. **Story 6.4 adds a SECOND exception** — `patient_invites.resolved_user_id`, same `set null` semantics, mirror reason (doctor-authored row must survive a patient's later account deletion). See "Doctor → patient invite (Story 6.4)" below. The `audit_log` table is also exempt from the cascade rule (pseudonymize-only, Story 5.6). Going forward: every NEW FK to `users(id)` defaults to cascade; document any future exception in these paragraphs.
- **`professional_account.activated` audit is NOT in `ACCESS_LOG_EVENT_KINDS`.** Doctor-side identity binding, not a patient-data access event. The patient does NOT see "Dr. X activated their account" in their Access Log. Round-1 product question on whether to surface as a positive-signal event is logged in deferred-work (Story 6.3 AC6 / open question #2).
- **Activation status is `auth.uid()`-scoped, NOT share-token-scoped.** A doctor activated via patient A's token IS activated when they open patient B's report. This is the Doctor Acquisition Loop closure — the `professionals_select_own` RLS predicate uses `current_setting('app.current_doctor_user_id', true)` (set by `doctorProcedure` from `session.user.id`), NOT `app.current_share_token_id`. Integration test `get-activation-status.integration.test.ts` locks this invariant.
- **Cross-doctor invite-claim race rejects with `CONFLICT` (`INVITE_ALREADY_CLAIMED_BY_DIFFERENT_DOCTOR`).** First doctor to activate wins; the loser sees the pt-BR explanation. Patient invited Dr. A by email, Dr. A forwarded the link to a colleague Dr. B who clicked → only Dr. A's uid lands on `resolved_user_id`. The `SELECT FOR UPDATE` on `pending_invites` inside the activation tx serializes the race.
- **`SET LOCAL ROLE postgres` escalation inside `activateProfessionalAccount` tx.** The doctor principal has no SELECT or UPDATE policy on `pending_invites` (that surface is patient-side; the doctor's identity hasn't been bound to it yet — chicken/egg). The resolver briefly escalates to `postgres` to acquire the FOR UPDATE lock + run the UPDATE, then `SET LOCAL ROLE NONE` immediately after the critical section. **Reviewer rule:** every escalation MUST be paired with a `NONE` reset in the SAME tx scope (the production resolver uses `try { … } finally { SET LOCAL ROLE NONE }` for the SELECT lock; a future patch that drops the `finally` leaves RLS bypassed for subsequent statements). Alternative considered (and rejected): a `pending_invites_select_doctor` RLS policy gated on a JOIN through `share_tokens`. Rejected for surface-area complexity at a single-write moment; revisit if the policy surface grows.
- **No CRM / license validation.** UX-DR9 frictionless framing: collect category-only metadata (`professional_category_enum`), trust the doctor's editorial discretion on display name. CRM gating would gate. Tracked in deferred-work; revisit before Epic 6 launch if regulatory review demands it.
- **Epic 6 consolidated migration ownership.** Story 6.3 ships dev-only `pnpm db:push` (additive table + nullable FK addition; validation lock is instant because `resolved_user_id` is NULL on every existing row). Prod-deploy lands in Story 6.6's batched Epic 6 migration (mirrors Story 3.5 / 4.4 / 5.x). The migration MUST include: `CREATE TABLE professionals` + `professional_category_enum`, `ALTER TABLE pending_invites … FOREIGN KEY (resolved_user_id) REFERENCES users(id) ON DELETE SET NULL`, and the `professionals` RLS policy file.

### Doctor → patient invite (Story 6.4)

The `patient_invites` table is the doctor-side acquisition surface — populated by `sharingRouter.createPatientInvite` (the InvitePatientButton on `/m/[token]/view`) when an activated doctor invites a patient by email or Brazilian mobile phone. The patient claims the invite by signing up via `/convite/<id>.<hmac>`; `account.initializeProfile` (extended) flips `resolved_user_id` + `status='resolved'` atomically with the user-row INSERT.

- **`patient_invites` is a SIBLING TABLE to `pending_invites`, NOT an extension.** Story 5.1's `pending_invites` is the patient→doctor direction (patient creates the row, doctor resolves at activation). Story 6.4's `patient_invites` is the doctor→patient REVERSE direction (doctor creates the row, patient resolves at sign-up). Lifecycle, RLS principal (`app.current_doctor_user_id` vs `app.current_patient_id`), FK direction (to `professionals.user_id` vs `users.id` for `patient_id`), and audit shape are all different — sharing a table would have required rewriting four existing `pending_invites_*` RLS policies + a CLAUDE.md-flagged partial-index WHERE-clause shift + a ShareLock prod window. Pay the small duplication cost for the much larger blast-radius reduction.
- **`SHARE_TOKEN_HMAC_SECRET` is reused with the `"patient_invite:"` domain prefix** on the signing input (`signPatientInviteToken(raw) = HMAC(SHARE_TOKEN_HMAC_SECRET, "patient_invite:" + raw)`). This is the LOAD-BEARING security guarantee: even though both surfaces share the same secret, a signature minted for a `share_tokens.id` UUID cannot replay as a `patient_invites.id` signature. **ANY future refactor that drops the prefix is a vulnerability and MUST be re-introduced.** Regression test: `signShareToken(raw) !== signPatientInviteToken(raw)` (`packages/api/__tests__/sharing/patient-invite-helpers.test.ts`).
- **`patient_invite.sent` and `patient_invite.resolved` are NOT in `ACCESS_LOG_EVENT_KINDS`.** Both are doctor-side acquisition surfaces — the patient cannot have access-logged an event from before they existed (`sent`) nor an event on their own onboarding (`resolved`). Mirrors Story 6.3 `professional_account.activated`.
- **`patient_invites.resolved_user_id` FK uses `onDelete: "set null"` — SECOND documented exception to Story 5.6's cascade rule** (the first is `pending_invites.resolved_user_id`, Story 6.3). When the patient who claimed the invite later deletes their account, the doctor's referral telemetry must SURVIVE — only the linkage breaks. Cascading would silently delete doctor-authored data on a patient action, which is directionally wrong. Locked in by `patient_invites_resolved_user_id_fk.rls.test.ts`.
- **`accountRouter.initializeProfile` is EXTENDED with an OPTIONAL `inviteId` + `tokenHmac` parameter.** The legacy non-invite registration path (Story 1.1) is unchanged: no `inviteId` → identical legacy behavior. **R1 reviewer guardrail:** every future PR touching `account.ts` MUST verify the parameter stays optional. Promoting to required is a breaking change to the unattributed registration flow.
- **7-identity RLS matrix introduced — `unrelatedDoctor` is the new 7th identity.** Any future doctor-scoped sharing table (`patient_invites`, future `revoke_patient_invite`-style surfaces) MUST use the 7-identity matrix, NOT the 6-identity. The 7th cell is "a DIFFERENT activated doctor whose `auth.uid()` is NOT the row's `professional_user_id`" — expected SELECT result: 0 rows (cross-doctor isolation). See `patient_invites.rls.test.ts`.
- **Renewal semantics:** the partial unique index `patient_invites_professional_identifier_active_uq ON (professional_user_id, identifier_hash) WHERE status = 'pending'` enforces single-in-flight idempotency. Re-inviting an expired prior invite (same identifier) creates a NEW row with a new token + new 7-day expiry + new audit emission — a renewal IS a distinct act of acquisition. There is no UPDATE-row-extend-expiry path.
- **`revokePatientInvite` is OUT OF SCOPE for Story 6.4.** The `revoked_at` column is reserved; the mutation lands when the dashboard story (6.5 / 6.x) owns the invite-history UI.
- **No transactional email/SMS send.** The doctor self-distributes the URL via WhatsApp / SMS / email at their discretion. Avoids introducing a SendGrid/Twilio compliance surface (LGPD Art. 7) without unblocking the Doctor Acquisition Loop. Tracked in deferred-work.
- **auth.users existence-oracle:** the AC11 already-registered check via service-role SELECT on `auth.users` IS a bounded enumeration oracle (doctors can probe whether any email is a HT user). Accepted as bounded — doctors are authenticated, accountable, low-volume; the check writes no audit and never JOINs to sharing tables. Rate-limiting and constant-time response delays tracked in deferred-work.
- **Epic 6 consolidated migration ownership:** no `supabase/migrations/*` file ships in Story 6.4. Prod deploy lands in Story 6.6 and MUST include `CREATE TABLE patient_invites`, `patient_invite_status_enum`, the partial unique index + check constraint + RLS policies, AND the `patient_invites_resolved_user_id_users_id_fk … ON DELETE SET NULL` constraint.

### Doctor staleness thresholds (Story 6.5)

- **`staleness_thresholds` is a NEW table** with composite PK `(professional_user_id, biomarker_category)`. No synthetic `id` column. UPSERT-only via `onConflictDoUpdate`; no DELETE path is exposed by the application layer (the RLS policy file also omits DELETE — a future "reset to default" UI would add it then). Mirrors the `share_token_biomarkers` composite-PK pattern.
- **Absent row → `STALENESS_DEFAULT_DAYS = 180` applied at READ time** (`accountRouter.listStalenessThresholds`, `sharingRouter.getConversationStarter`). Defaults are NEVER persisted as rows — this avoids row-bloat for every doctor × every category × every save, and lets the system default move with code without a backfill.
- **`staleness_threshold.updated` audit is NOT in `ACCESS_LOG_EVENT_KINDS`.** Doctor-side preference change; the patient has no surface to consume it. Mirrors `professional_account.activated` (Story 6.3) and `patient_invite.sent` / `.resolved` (Story 6.4).
- **"Resultado antigo" flag is computed server-side at the `getConversationStarter` resolver boundary.** The `conversation_starter_cache.payload` JSONB shape is UNCHANGED — staleness rides on a parallel array (`biomarkerStaleness`) on the resolver output. Future refactors MUST preserve this separation; folding staleness into the cached payload would force regen of every cached row + worker prompt drift (Story 6.2 regression surface).
- **`BiomarkerCard.isStale` is orthogonal to `state`.** A card can be both `notable` AND `Resultado antigo` simultaneously; both chips render side-by-side. The stale chip uses muted `$textSecondary` + `$border` tokens — NOT amber (deviation owns amber). The patient-surface invariant: `isStale === undefined` MUST render identically to pre-6.5 (no chip, no a11y change).
- **`professionalSessionProcedure` is the session-only doctor procedure** for `/profissional/*` surfaces that have NO share-token in context. Binds `app.current_doctor_user_id` from the verified Supabase session uid (same GUC as `doctorProcedure` post-6.3) so the `professionals`-family RLS policies work without a share-token GUC. The activation gate is the application layer's responsibility.
- **The 7-identity RLS matrix applies** — staleness is `auth.uid()`-scoped (via `app.current_doctor_user_id`), NOT share-token-scoped; `unrelatedDoctor` MUST be in the matrix. INSERT-WITH-CHECK + UPDATE-cross-tenant + DELETE-policy-absent are mandatory `it(...)` blocks.
- **Deferred to Story 6.6 (Epic 6 consolidated migration):** `CREATE TABLE staleness_thresholds`, `staleness_thresholds_days_range_check` CHECK constraint, the `staleness_thresholds_pk` unique index, the `staleness_thresholds_professional_idx` listing index, and the policies in `custom_rls_staleness_thresholds.sql`.
- **Deferred work:** "reset to default" UI (delete a row) — deferred until a doctor-feedback signal motivates it. "Bulk edit thresholds" (slider / apply-to-all) — deferred; per-row UI is sufficient for MVP. Patient view of "this doctor's staleness threshold" — deferred; patients have no surface to introspect doctor settings, product hasn't validated a need.

### Personal context: life events + emotional check-ins (Stories 7.1 + 7.2)

Epic 7's privacy backbone (FR47) ships a **denial-by-RLS-absence** pattern across every personal-context table. Two tables live in this family so far — `life_events` (Story 7.1) and `emotional_checkins` (Story 7.2) — and Story 7.3 (post-results check-in) + Story 7.4 (voice memo) will inherit the same disciplines:

- **Doctor-zero-rows invariant.** No doctor RLS policy ships with these tables. `doctorProcedure` / share-token-principal sessions see zero rows because no policy permits them to. `privacy_flag = 'patient_only'` is metadata for a future explicit-consent surface, NOT a defense — the absence of any doctor policy IS the defense. Every new personal-context table MUST ship the 4-identity RLS matrix from `packages/db/__tests__/rls/{life_events,emotional_checkins}.rls.test.ts` and explicitly assert "doctor SELECT returns 0 rows" (not "query doesn't error").
- **Audit kinds NOT in `ACCESS_LOG_EVENT_KINDS`.** `life_event.created` and `emotional_checkin.recorded` are written to `audit_log` but deliberately excluded from the Acessos tab visibility allowlist. The Acessos surface (Story 5.3) is the doctor-access narrative; personal context never belongs there. Mirrors the Story 6.5 `staleness_threshold.updated` precedent. A validators regression test locks the absence — every new personal-context audit kind must add the same `expect(...).not.toContain(...)` lock.
- **Audit metadata PII gradient.** `life_event.created` carries `{eventDate, category}` — `description` (free-text, possibly sensitive) is intentionally omitted because `audit_log` is append-only (NFR-S4) and a leaked description there cannot be redacted. `emotional_checkin.recorded` carries `{uploadId, type, state}` — the state IS in metadata because closed enums have no PII surface. The test: "is this content authored by the patient with potential identifying info?" — closed enums fail; free text passes.
- **Idempotency shields.** Story 7.2 uses a `(upload_id, type)` UNIQUE constraint + narrow 23505 catch in the helper (returns existing row, NO second audit write) — same Epic 5 partial-unique pattern. Story 7.1 deliberately ships no such constraint (multiple events on the same day are intentional). Future personal-context tables: decide explicitly and document.
- **`uploads.viewed_at` is a NEW column** (Story 7.2 / AC12) that gates the pre-results check-in sheet to first-time viewers. `getUploadDetail` returns `isFirstView: boolean` derived BEFORE any side-effect; the client fires the separate `uploads.markUploadViewed` mutation from BOTH the state-selected and skipped branches of the sheet. The mutation issues `UPDATE … WHERE viewed_at IS NULL` so second calls return `{ marked: false }` and write no audit (render path is high-frequency). The `IS NULL` guard is load-bearing — a future patch that drops it would silently 10x the audit-log write volume.
- **AC10 enum unification deferred to Story 7.6.** Story 7.1 shipped `life_event_privacy_flag_enum` (single value `patient_only`); Story 7.2 ships its own `emotional_checkin_privacy_enum` with identical values to keep PR #59's reviewed surface untouched. Story 7.6's batched migration MUST author `ALTER TYPE life_event_privacy_flag_enum RENAME TO personal_context_privacy_enum` (PG14+, atomic — `AccessExclusiveLock` for microseconds) BEFORE any new table column references the unified type. Story 7.4's voice memos surface should use the unified enum from day one once 7.6 lands.
- **Story 7.6 (Epic 7 batched migration) checklist:** `CREATE TABLE life_events` + `life_event_category_enum` + `life_event_privacy_flag_enum` + the description-length CHECK constraint + the `(patient_id, event_date)` index + `custom_rls_life_events.sql` policies; `CREATE TABLE emotional_checkins` + `emotional_checkin_state_enum` + `emotional_checkin_type_enum` + `emotional_checkin_privacy_enum` + the `(upload_id, type)` UNIQUE + the `(patient_id, created_at)` index + `custom_rls_emotional_checkins.sql` policies; `ALTER TABLE uploads ADD COLUMN viewed_at TIMESTAMPTZ` (additive; no backfill — NULL is the "never viewed" default); the AC10 `ALTER TYPE … RENAME TO personal_context_privacy_enum` rename; voice-memo schema from Story 7.4 once that lands.
- **Voice memos (Story 7.4).** `voice_memos` table with `UNIQUE (upload_id)` is the third Epic 7 personal-context table. Storage path `<patient_id>/<upload_id>.m4a` in the private `voice_memos` bucket — **`voiceMemoId` is the `uploadId`** (deterministic) so a retry-after-success overwrites the prior object instead of orphaning it (R1-H2 carry-forward). Audit kind `voice_memo.recorded` carries `{uploadId, durationMs}` — never `storagePath` (patient-private). Server-side defense: ownership precondition + path-prefix validator (rejects `..`, `\\`, multi-segment subdirs — R1-M1) + exact-name match on Storage list probe (Supabase's `search` is fuzzy `ILIKE`; R1-H4) + narrow 23505 catch. Client-side: `fetch(uri).blob()` upload (NEVER `Buffer.from(base64)` — Hermes does not polyfill `Buffer`; R1-C1). The shell `VoiceMemoRecorder` in `packages/ui` exposes a `renderRecorder` slot (Story 7.5 pattern carry-forward); `expo-audio` lives in `apps/expo` only. Bucket creation SQL deferred to Story 7.6.
- **Native date picker (Story 7.5).** `LifeEventSheet` ships an optional `renderDateField` slot prop so the consumer can inject a platform-native picker. The `@react-native-community/datetimepicker` dep lives in `apps/expo` ONLY — importing it from `packages/ui` (bundled by Next.js for the web app) would break `next build`. Web fallback is the existing free-text `dd/mm/aaaa` / ISO input. The slot's `onChange` MUST emit ISO `yyyy-mm-dd` so the sheet's validation and mutation wire format work uniformly across platforms. Local-calendar Date↔ISO conversion in `apps/expo/src/app/(tabs)/inicio.tsx` (`isoStringToLocalDate` / `localDateToIsoString`) NEVER uses `.toISOString().slice(0,10)` (UTC shift hazard — Story 3.1 R3-P246).

### Integration test discipline (Story 6.4 R1 H1 addendum)

The Story 6.1 → 6.2 → 6.4 sprint-level pattern: spec-mandated integration tests get cut at PR open, the resolver's narrow-23505 / gate / catch logic only ever lives behind unit-test mocks, and the testcontainer file ends up mirroring a partial SQL subset of the resolver. Round-1 reviewers MUST reject this pattern going forward:

- **Resolver-call integration tests are the default.** A new tRPC resolver landing testcontainer coverage SHOULD ship its integration test in `packages/api/__tests__/<router>/*.integration.test.ts` invoking `appRouter.createCaller(ctx).<router>.<resolver>(...)` against a testcontainer-bound `ctx.db`. The test exercises the resolver's gate-throws, narrow-catch composition, and audit emission end-to-end — NOT just the SQL shape.
- **Inline-SQL mirrors are the documented fallback ONLY when the dep graph blocks the resolver call.** The db package CANNOT import api (api → db is the only allowed direction). When the resolver-call path is blocked at the workspace level — as it is for Story 6.4's `createPatientInvite`, whose testcontainer-side `auth.users` schema is Supabase-managed and not provisioned by `drizzle-kit push` — the inline mirror MUST: (a) cover every spec T8.\* case the resolver does (no "subset, the unit tests cover the rest"); (b) include the activation gate, the existence probe, AND the partial-index race in the same mirror; (c) explicitly document at the file header WHY the resolver-call path is blocked. Round-1 reviewers verify EVERY spec case has a corresponding `it(...)` block.
- **The forward fix is to hoist the testcontainer harness.** Once `startIntegrationDb` lives in a workspace-shared location both api and db can import (e.g. a `tooling/testcontainers` package or a published api-package devDep on the db test surface), the inline-SQL fallback is no longer accepted. Tracked in deferred-work.

## Tooling conventions

- **TypeScript**: strict mode, `noUncheckedIndexedAccess`, `moduleResolution: "Bundler"`, ES2022 target.
- **ESLint**: configs in `tooling/eslint/` — `base`, `nextjs`, `react`. Each app/package extends the appropriate one.
- **Prettier**: import sorting (`@iva/prettier-plugin-import-sort`) and Tailwind class sorting are active.
- **Turborepo**: task caching is on by default. The `dev` and `db:studio` tasks are marked persistent; `db:push` and `ui-add` are interactive.
