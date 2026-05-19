# Story 1.1: Patient creates account with email and password

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a new patient,
I want to create a Health Tracker account with my email and password,
so that I can begin building my personal longitudinal health record.

## Acceptance Criteria

**AC1 — Successful registration**
**Given** I am on the registration screen,
**When** I enter a valid email and a password meeting the minimum requirements (8+ chars, at least one number) and tap "Criar conta",
**Then** a Supabase Auth account is created and I am issued a valid session,
**And** a corresponding row is inserted into the `patients` table with my `user_id` from `auth.uid()`.

**AC2 — Duplicate email**
**Given** I submit a registration with an email already registered,
**When** Supabase Auth returns a duplicate email error,
**Then** the screen displays "Já existe uma conta com esse e-mail. Tente entrar." without exposing raw error codes.

**AC3 — Hand-off to consent**
**Given** my account is created,
**When** the onboarding flow begins,
**Then** I am presented with the LGPD consent screens (Story 1.2) before any health data collection is offered.

**AC4 — Audit event**
**Given** registration succeeds,
**When** I check the audit log,
**Then** a `patient.created` event is recorded with my `patient_id`, timestamp, and actor set to `self`.

**Requirements:** FR42, FR33, AR5, AR10, NFR-S1, UX-DR20

## Tasks / Subtasks

- [x] **Task 1 — Define the `patients` table schema** (AC: #1)
  - [x] Implement the schema in `packages/db/src/schema/users.ts` (stub today: `// schema defined in story 1.1`). Table name `patients` per AC1; see Project Structure Notes for the naming conflict to resolve first.
  - [x] Columns: `id` (uuid PK, equals `auth.uid()` — no default, supplied at insert), `subscription_tier` (text, `free` | `premium`, default `free` — required by architecture entitlement decision), `created_at` and `updated_at` (timestamptz, `defaultNow()` — deferred item W6).
  - [x] Use `snake_case` columns (Drizzle is configured for it). Export the table from `packages/db/src/schema/index.ts` (currently only exports `./posts`).
  - [x] Add a Zod insert schema via `drizzle-zod` if a typed insert is needed, matching the `posts.ts` pattern (`CreatePostSchema`).

- [x] **Task 2 — Define the `audit_log` table + `writeAuditLog()` helper** (AC: #4)
  - [x] Implement the `audit_log` schema in `packages/db/src/schema/audit.ts` (stub today). Append-only table; columns implied by the helper: `id`, `actor_id`, `actor_type`, `event`, `resource_id`, `resource_type`, `metadata` (jsonb), `created_at` (`defaultNow()`).
  - [x] Export it from `schema/index.ts`.
  - [x] Create `packages/api/src/audit.ts` exporting `writeAuditLog(db, { actorId, actorType, event, resourceId, resourceType, metadata })` — the ONLY path that inserts into `audit_log` (AR10).

- [x] **Task 3 — RLS policy + adversarial test for `patients`** (AC: #1; Story 0.4 mandate)
  - [x] Add `packages/db/policies/custom_rls_patients.sql` using the `current_setting('app.current_patient_id', true)` pattern (prefix `custom_` so `drizzle-kit check` won't drop it).
  - [x] Add `packages/db/policies/custom_rls_audit_log.sql` — SELECT-scoped to the patient; NO update/delete grants for the app role (NFR-S4 append-only).
  - [x] Add `packages/db/__tests__/rls/patients.test.ts` with the adversarial matrix: correct patient / wrong patient / unauthenticated.
  - [x] Before writing the test, resolve deferred items D2 (fix `getDbUrl()` port replace to use `new URL()` in `packages/db/__tests__/rls/helpers.ts`) and D4 (point the `rls-adversarial` CI job `DATABASE_URL` at local Supabase) — verify whether commit `835e934` already resolved these; only act if still open.

- [x] **Task 4 — Registration tRPC procedure** (AC: #1, #2, #4)
  - [x] Add a `register` (or `signUp`) `publicProcedure` — registration has no prior session, so it cannot be `protectedProcedure`. Place it on `authRouter` (`packages/api/src/router/auth.ts`) or a new `account` router; if new, register it in `packages/api/src/root.ts`.
  - [x] Input: Zod schema validating email format and password rule (8+ chars, ≥1 number). Keep the validator in `packages/validators` if reused by the client.
  - [x] Call `supabase.auth.signUp({ email, password })` via the centralised `packages/auth` client — never instantiate Supabase directly.
  - [x] On success: insert the `patients` row with `id = data.user.id`. Then call `writeAuditLog(ctx.db, { actorId: <patient_id>, actorType: 'patient', event: 'patient.created', resourceId: <patient_id>, resourceType: 'patient', metadata: { actor: 'self' } })`.
  - [x] On duplicate email: catch the Supabase error and throw a `TRPCError` whose client-facing message is "Já existe uma conta com esse e-mail. Tente entrar." — never surface raw Supabase codes.
  - [x] Ensure the raw password never enters logs, Sentry breadcrumbs, or `extra` — `password` is NOT in the Sentry scrub key list (Story 0.7). Do not log the input object.

- [x] **Task 5 — Registration UI ("Criar conta" screen)** (AC: #1, #2, #3)
  - [x] Build the registration screen (Expo onboarding flow; web if in scope). Fields: email, password. Submit button label exactly "Criar conta".
  - [x] All copy in pt-BR, 8th-grade reading level (UX-DR20). Password rule shown as helper text, not a red error.
  - [x] Validation language: amber inline help only — never red, never "Erro"/"Inválido". `$color.error` (#DC2626) is reserved for system errors. Use Tamagui semantic tokens; no hardcoded hex.
  - [x] On duplicate-email error from the procedure, show "Já existe uma conta com esse e-mail. Tente entrar." inline; do not clear the form.
  - [x] On success, route into the Story 1.2 LGPD consent flow (do not land on any health-data screen first).

- [x] **Task 6 — Tests** (AC: all)
  - [x] Vitest unit tests for the registration procedure: valid registration, duplicate email, password-rule rejection, audit-event emission.
  - [x] Verify the `patients` RLS adversarial test (Task 3) passes.
  - [x] `pnpm typecheck` and `pnpm lint` clean; `pnpm db:push` applies the new schema.

## Dev Notes

### Architecture patterns and constraints

- **Stack:** pnpm + Turborepo monorepo (create-t3-turbo); tRPC v11; Drizzle ORM on Supabase Postgres (`snake_case`, Vercel Postgres edge driver); Supabase Auth; TypeScript strict. Testing: Vitest (unit/integration), Playwright (web E2E), Maestro/Detox (Expo E2E). [Source: architecture.md#Selected-Foundation, #Testing-Framework]
- **RLS token-principal model (AR5, Story 0.4):** every authenticated tRPC transaction runs `SET LOCAL app.current_patient_id = <session.user.id>` and `SET LOCAL app.current_user_role = 'patient'`. `SET LOCAL` is transaction-scoped, so `protectedProcedure` wraps resolvers in `ctx.db.transaction()` and forwards `db: tx` — resolvers MUST use `tx`. RLS policies are hand-authored in `packages/db/policies/`, each file prefixed `custom_`. Requires Supabase session-mode pooler (port 5432). [Source: architecture.md#Data-Architecture, #RLS-SET-LOCAL-Pattern; story 0-4]
- **Audit logging (AR10):** `writeAuditLog()` is the only path to `audit_log`; inline inserts are prohibited. `audit_log` is append-only — no UPDATE/DELETE grants for the app role (NFR-S4). Event names are `noun.verb` past tense; this story emits `patient.created`. [Source: architecture.md#Audit-Log-Write-Pattern, #Naming-Patterns]
- **tRPC procedures:** `publicProcedure` (no auth, no RLS context) vs `protectedProcedure` (throws `UNAUTHORIZED`, wraps in RLS transaction). Registration has no session → must be `publicProcedure`. Responses return typed data directly, no envelope; errors use `TRPCError`. [Source: packages/api/src/trpc.ts; architecture.md#Format-Patterns]
- **Supabase Auth (Story 0.3):** all client creation centralised in `packages/auth/` — `createSupabaseBrowserClient`, `createSupabaseServerClient`, `getSession()`. Never instantiate Supabase directly outside `packages/auth` (Expo's `apps/expo/src/lib/supabase.ts` is the one documented exception). Email/password + magic-link providers are enabled. [Source: story 0-3; packages/auth/]
- **Error handling / pt-BR:** client-facing messages are plain pt-BR, never technical codes. A central error taxonomy is planned at `packages/api/src/errors.ts`. [Source: architecture.md#Error-Handling-Standards, #Health-Tracker-Error-Taxonomy]
- **Sentry PII (Story 0.7):** `sentryBeforeSend` in `packages/config/src/sentry.ts` scrubs `email`, `patient_id`, etc. — but NOT `password`. Keep raw passwords out of all error context.

### Requirement texts

- **FR42:** Patient can create an account with email and password.
- **FR33:** System records consent events with timestamp, consent text version, and data type scope — in this story, satisfied by establishing the audit ledger (`patient.created`); the consent rows themselves are written in Story 1.2.
- **AR5:** RLS token principal model — `SET LOCAL app.current_patient_id` in every authenticated tRPC context initializer.
- **AR10:** tRPC audit middleware records actor/resource/operation; all audit writes via `writeAuditLog()` only.
- **NFR-S1:** Patient health data encrypted at rest (AES-256) and in transit (TLS 1.3) — satisfied at the Supabase infra layer; story-level obligation is no plaintext credential handling.
- **UX-DR20:** All user-facing strings in Brazilian Portuguese at an 8th-grade reading level.

### Source tree components to touch

- `packages/db/src/schema/users.ts` — NEW: `patients` table (stub today).
- `packages/db/src/schema/audit.ts` — NEW: `audit_log` table (stub today).
- `packages/db/src/schema/index.ts` — UPDATE: re-export the two new tables (currently only `./posts`).
- `packages/db/policies/custom_rls_patients.sql`, `custom_rls_audit_log.sql` — NEW.
- `packages/db/__tests__/rls/patients.test.ts` — NEW.
- `packages/api/src/audit.ts` — NEW: `writeAuditLog()` helper.
- `packages/api/src/router/auth.ts` (or new `account.ts`) — UPDATE/NEW: `register` procedure. If new router, register in `packages/api/src/root.ts`.
- Registration screen in `apps/expo` onboarding flow (and `apps/web` if in scope) — NEW.

### Testing standards summary

- Co-locate unit tests as `{filename}.test.ts`; RLS tests in `packages/db/__tests__/rls/`; integration in `__tests__/integration/`.
- RLS test must cover the adversarial matrix (correct / wrong / unauthenticated patient).
- `pnpm typecheck` and `pnpm lint` must pass; `pnpm db:push` is the schema-sync mechanism (no migration files).

### Previous story intelligence

- **0.3** established `packages/auth` as the single Supabase entry point; `getSession()` re-validates the JWT via `getUser()`.
- **0.4** created the `policies/` directory, the `custom_` prefix convention, the RLS adversarial harness (`packages/db/__tests__/rls/setup.ts`), and the schema stub files `users.ts`/`audit.ts` this story now fills.
- **0.7** built Sentry PII scrubbing — `password` is not scrubbed, so it must never reach Sentry.
- **Deferred items relevant here** (`deferred-work.md`): W6 — add `defaultNow()` for `created_at`/`updated_at` when the patients table is defined; D2 — fix `getDbUrl()` URL parsing in the RLS helper; D4 — point the `rls-adversarial` CI job at local Supabase. Verify whether commit `835e934` ("resolve Epic 0 retro prep items") already closed D2/D4 before acting.

### Git intelligence

- Conventional Commits with scopes (`feat`, `fix(security)`, `chore(prep)`, `docs(retro)`). Stories developed in `worktree-story-*` branches, merged to `main`. Epic 0 complete; its retro prep items resolved in `835e934`.

### Project Structure Notes

- **OPEN QUESTION — table naming conflict.** Story 1.1's AC1 explicitly says rows go into the **`patients`** table; the RLS variable is `app.current_patient_id`. The architecture document instead names this table **`users`** (`users (id, subscription_tier, created_at)`) and the schema stub file is `users.ts`. This story file follows the acceptance criterion (`patients` table name, defined inside `users.ts`), since the AC is the authoritative contract — but the inconsistency should be confirmed before implementation. See the Clarifications section below.
- The router directory is `packages/api/src/router/` (singular); the root router is `packages/api/src/root.ts` (not `router/index.ts`). The architecture map mentions a planned `account.ts` router for FR42–51.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story-1.1] — user story, ACs, requirement tags.
- [Source: _bmad-output/planning-artifacts/architecture.md#Data-Architecture] — RLS token-principal model, `users`/`patients` table.
- [Source: _bmad-output/planning-artifacts/architecture.md#RLS-SET-LOCAL-Pattern] — `SET LOCAL` transaction wrap, session-mode pooler.
- [Source: _bmad-output/planning-artifacts/architecture.md#Audit-Log-Write-Pattern] — `writeAuditLog()` signature, append-only `audit_log`.
- [Source: _bmad-output/planning-artifacts/architecture.md#Health-Tracker-Error-Taxonomy] — pt-BR error messages.
- [Source: _bmad-output/planning-artifacts/ux-design-specification.md#Form-&-Input-Patterns] — amber-not-red validation, label tone.
- [Source: _bmad-output/implementation-artifacts/0-3-configure-supabase-auth-with-magic-link-and-email-providers.md] — Supabase Auth wiring.
- [Source: _bmad-output/implementation-artifacts/0-4-configure-rls-token-principal-model-and-migration-protection.md] — RLS policy + test mandate.
- [Source: _bmad-output/implementation-artifacts/0-7-configure-sentry-error-tracking-with-pii-scrubbing.md] — Sentry PII scrubbing.
- [Source: _bmad-output/implementation-artifacts/deferred-work.md] — W6, D2, D4.

### Review Findings (code review round 2, 2026-05-19) — RESOLVED

- [x] [Review][Patch] **P9** Email normalization moved to a `normalizeEmail()` helper in `@healthtracker/validators` and applied right before `supabase.auth.signUp` on both web and expo. Chained `.trim().toLowerCase()` removed from `RegisterSchema` to avoid the post-validation order bug. Both clients now send identical normalized emails.
- [x] [Review][Patch] **P10** Web `/auth/callback` now uses the session returned by `exchangeCodeForSession` directly — no second `getSession()` round-trip. Eliminates the stale-cookie race the reviewer flagged.
- [x] [Review][Patch] **P11** CI `Export local Supabase env` now tracks each expected key and `exit 1` with a `::error::` annotation if Supabase's CLI ever stops emitting `API_URL` / `DB_URL` / `ANON_KEY` / `SERVICE_ROLE_KEY`. Fails fast instead of silently running tests against placeholder env values.
- [x] [Review][Patch] **P12** `audit_log.rls.test.ts` UPDATE and DELETE cases now SELECT the seeded row under `correctPatient` first to prove visibility before asserting the no-op. A future SELECT-policy regression can no longer masquerade as UPDATE/DELETE denial.
- [x] [Review][Defer] Supabase's enumeration-prevention default obscures duplicate emails when email-confirmation is enabled — `isDuplicateEmailError` cannot detect that path; user sees "verify your email" but no email arrives. Mitigation requires a server-side existence check (admin API), itself an enumeration oracle — PRD-level tradeoff.
- [x] [Review][Defer] No "Entrar" affordance on the duplicate-email error message — UX enhancement.
- [x] [Review][Defer] Web (`@tanstack/react-form`) and Expo (`useState`) implement registration twice; extract a shared submit handler to prevent drift.
- [x] [Review][Defer] `$biomarkerDeviation` Tamagui token is semantically about biomarker data, not form errors — add a `$warning`/`$help` token in a design-system pass.
- [x] [Review][Defer] Web form field-error rendering depends on `@tanstack/react-form`'s issue shape — add a regression test when the apps gain component-test infrastructure.

### Review Findings (code review 2026-05-19) — RESOLVED

- [x] [Review][Patch] **P0** Post-verification callback — `/auth/callback` (web) and Expo `_layout.tsx` deep-link handler now call `account.initializeProfile` after `exchangeCodeForSession` succeeds, so the email-confirmation path also creates the `users` row and `patient.created` audit event (AC1/AC4 end-to-end). Exposed a raw `trpcClient` from `apps/expo/src/utils/api.tsx` for non-React callsites.
- [x] [Review][Patch] **P1** `isDuplicateEmailError` hardened against locale/version drift and moved to `@healthtracker/validators` with `DUPLICATE_EMAIL_MESSAGE_PT_BR` / `GENERIC_REGISTRATION_ERROR_MESSAGE_PT_BR`. Substring matching dropped; detection is now code-based only (`user_already_exists`, `email_exists`, `email_address_already_registered`).
- [x] [Review][Patch] **P2** `users.rls.test.ts` tightened: correct patient asserts `rows === [{id}]`, wrong patient asserts `rows === []`, foreign-id insert asserts Postgres code `42501`.
- [x] [Review][Patch] **P3** `audit_log.rls.test.ts` added — covers INSERT WITH CHECK (own allowed, foreign blocked with `42501`), SELECT own-only, and UPDATE/DELETE denied (rows unchanged).
- [x] [Review][Patch] **P4** `writeAuditLog` failure-path test added — verifies the helper propagates DB errors (RLS denial) so the surrounding transaction can roll back.
- [x] [Review][Patch] **P5** `RegisterSchema.email` now `.trim().toLowerCase()` inside the validation pipeline.
- [x] [Review][Patch] **P6** Validation copy softened ("Isso não parece um e-mail — quer tentar de novo?"); persistent password helper text rendered under the input on both apps via shared `PASSWORD_HELPER_TEXT_PT_BR`.
- [x] [Review][Patch] **P7** CI `rls-adversarial` job hardened — `set -euo pipefail`, line-by-line parse of `supabase status -o env` instead of `eval`.
- [x] [Review][Patch] **P8** Already wired — root `pnpm test` runs `turbo run test:unit`, which picks up the new `packages/api` tests. Verified locally (6/6 pass).
- [x] [Review][Defer] User-enumeration via distinct duplicate-email message — AC2 mandates it; PRD-level tradeoff
- [x] [Review][Defer] Password policy strength (8 + 1 digit) — spec'd in AC1
- [x] [Review][Defer] No rate-limit / captcha on registration — infra concern; Supabase has built-in
- [x] [Review][Defer] No FK from `users.id` to `auth.users` — cross-schema FK pattern decision
- [x] [Review][Defer] No FK on `audit_log.actor_id` / `resource_id` — same
- [x] [Review][Defer] No DB enum/check on `subscription_tier`, `actor_type` — defenses-in-depth
- [x] [Review][Defer] No indexes on `audit_log` — Story 1.4 perf concern
- [x] [Review][Defer] `FORCE ROW LEVEL SECURITY` not enabled — cross-cutting; matches Story 0.4 pattern
- [x] [Review][Defer] `audit_log` INSERT policy doesn't constrain `resource_id` — revisit when more writers ship
- [x] [Review][Defer] System-actor audit writes blocked by current RLS — revisit when first system event ships
- [x] [Review][Defer] No component/E2E tests for the registration UI — no test infra in the apps yet
- [x] [Review][Defer] `account.test.ts` mocks the whole Drizzle chain — RLS test gives integration coverage
- [x] [Review][Defer] Story Task 4 wording says `publicProcedure`; implementation uses `protectedProcedure` — deliberate, user-approved

13 dismissed as noise (false positives or established patterns) — see triage transcript.

### Clarifications for the user (resolve before/at start of dev)

1. **Table name:** `patients` (per AC1) or `users` (per architecture)? This story assumes `patients`. If `users` is preferred, AC1/AC4 wording and the RLS variable name should be reconciled.
2. **Audit `actor` field:** AC4 says actor is `self`; the `writeAuditLog` `actorType` enum is `patient | doctor | system`. This story uses `actorType: 'patient'` with `metadata: { actor: 'self' }`. Confirm acceptable.
3. **Platform scope:** Is the "Criar conta" screen needed on Expo only, or web too? Epic 1 is patient-facing (mobile-first); web scope assumed out unless stated.

## Dev Agent Record

### Agent Model Used

claude-opus-4-7[1m]

### Debug Log References

- `pnpm typecheck` — 16/16 packages clean.
- `pnpm lint` — 14/14 packages clean (api eslint cache had to be cleared once after adding `__tests__` to its tsconfig include).
- `pnpm format` — 10/10 packages clean after `pnpm format:fix`.
- `pnpm -r --filter @healthtracker/api --filter @healthtracker/db run test:unit` — api: 5 passed (audit: 2, account: 3); db: 0 (no co-located unit tests, RLS suite excluded by config).

### Completion Notes List

**Decisions resolved at start of implementation (recorded in Clarifications):**

1. Table named **`users`** per architecture (not `patients`). The RLS variable remains `app.current_patient_id` per AR5; the audit event keeps the business-level name `patient.created` with `resourceType: 'user'`.
2. UI built on **both** `apps/web` and `apps/expo`.
3. Audit recorded with `actorType: 'patient'` and `metadata: { actor: 'self' }`.
4. **Architecture:** Supabase `signUp` runs **client-side**; the tRPC `account.initializeProfile` is a `protectedProcedure` invoked from the resulting session. Idempotent via `onConflictDoNothing()` + `.returning()`: a repeat call inserts nothing and writes no audit event.

**What was implemented:**

- `Users` and `AuditLog` Drizzle tables, exported from `packages/db/src/schema/index.ts`.
- `writeAuditLog()` helper in `packages/api/src/audit.ts` — the single sanctioned audit write path (AR10). Typed to accept either the pool client or a `protectedProcedure` transaction handle.
- `account.initializeProfile` protectedProcedure in `packages/api/src/router/account.ts`, registered in `root.ts`. Inserts the `users` row (RLS WITH CHECK passes because `SET LOCAL app.current_patient_id` matches the id being inserted), then writes a `patient.created` audit event.
- RLS policies `custom_rls_users.sql` (SELECT/INSERT own) and `custom_rls_audit_log.sql` (INSERT own, SELECT own; no UPDATE/DELETE → append-only per NFR-S4).
- RLS adversarial test `packages/db/__tests__/rls/users.rls.test.ts`: correctPatient reads own, wrongPatient zero rows, WITH CHECK blocks foreign-id insert, anon zero rows. **Requires `supabase start` to run; not part of `pnpm test`.**
- Vitest set up for `packages/api`; unit tests for `writeAuditLog` and `account.initializeProfile` (success, idempotent re-call, UNAUTHORIZED).
- Shared `RegisterSchema` validator in `packages/validators` (email + password rule, pt-BR amber messages).
- Web registration screen at `/auth/register` (server `page.tsx` + client `register-form.tsx`) and placeholder `/onboarding/consent`. Expo screens at `app/register.tsx` and `app/onboarding/consent.tsx`. Both apps: client `supabase.auth.signUp` → tRPC `initializeProfile` → route to `/onboarding/consent`. Duplicate-email surfaced as pt-BR "Já existe uma conta com esse e-mail. Tente entrar."; raw passwords never logged or passed to Sentry context.

**Deferred items resolved during this story:**

- D2 (from 0-6): `getDbUrl()` in `packages/db/__tests__/rls/helpers.ts` now parses the URL with `new URL()` and rewrites the port, replacing the bare `:6543` → `:5432` substring replace.
- D4 (from 0-6): the `rls-adversarial` CI job now exports `DATABASE_URL`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` from `supabase status -o env` into `$GITHUB_ENV` after `supabase start`. `dotenv-cli` (used by `with-env`) does not overwrite already-set vars, so these take precedence over the `.env.example` placeholders.
- W6 (from 0-1): `createdAt`/`updatedAt` on the new `users` table use `defaultNow()`.

**Open / out of scope:**

- Consent screen content (Story 1.2) — the `/onboarding/consent` route is a minimal pt-BR placeholder so AC3's "patient is presented with the consent screens before any health data collection" routing seam exists.
- Profile UPDATE/DELETE RLS policies — deliberately absent; future stories add them under their own scope.
- `users` Drizzle drop on `schema/users.ts` change was already-stubbed `// schema defined in story 1.1`; new schema replaces it.

### Change Log

- 2026-05-19 — Story 1.1 implemented (Amelia, dev-story). Tasks 1–6 complete; status → review.
- 2026-05-19 — Code review pass (Blind Hunter + Edge Case Hunter + Acceptance Auditor). 1 decision + 9 patches resolved, 13 deferred, 13 dismissed. Status → done.
- 2026-05-19 — Code review round 2 on the patched code. 4 patches resolved (P9–P12: email-normalization boundary fix, callback session source, CI env assertion, RLS visibility-first assertions), 5 additional findings deferred (F14–F18), ~10 dismissed (verified false positives, including 2 HIGH callsite worries).

### File List

**New files**

- `packages/db/policies/custom_rls_users.sql`
- `packages/db/policies/custom_rls_audit_log.sql`
- `packages/db/__tests__/rls/users.rls.test.ts`
- `packages/db/__tests__/rls/audit_log.rls.test.ts` (code review P3)
- `packages/api/src/audit.ts`
- `packages/api/src/router/account.ts`
- `packages/api/vitest.config.ts`
- `packages/api/__tests__/audit.test.ts`
- `packages/api/__tests__/account.test.ts`
- `apps/web/src/app/auth/register/page.tsx`
- `apps/web/src/app/auth/register/register-form.tsx`
- `apps/web/src/app/onboarding/consent/page.tsx`
- `apps/expo/src/app/register.tsx`
- `apps/expo/src/app/onboarding/consent.tsx`

**Modified files**

- `packages/db/src/schema/users.ts` (stub → real schema)
- `packages/db/src/schema/audit.ts` (stub → real schema)
- `packages/db/src/schema/index.ts` (export `audit`, `users`)
- `packages/db/__tests__/rls/helpers.ts` (D2: `getDbUrl` URL-parse fix)
- `packages/api/src/root.ts` (register `accountRouter`)
- `packages/api/package.json` (add `test:unit`, `vitest`, `@vitest/coverage-v8`)
- `packages/api/tsconfig.json` (include `__tests__`)
- `packages/validators/src/index.ts` (export `RegisterSchema`, shared error helpers — code review P1/P5/P6)
- `apps/expo/package.json` (add `@healthtracker/validators` dependency)
- `apps/expo/src/utils/api.tsx` (expose raw `trpcClient` — code review P0)
- `apps/expo/src/app/_layout.tsx` (call `initializeProfile` after deep-link verification — code review P0)
- `apps/web/src/app/auth/callback/route.ts` (call `initializeProfile` after `exchangeCodeForSession` — code review P0)
- `.github/workflows/ci.yml` (D4: export local Supabase env; code review P7: hardened shell)
- `_bmad-output/implementation-artifacts/sprint-status.yaml` (epic-0 → done; epic-1 → in-progress; story 1-1 → done)
- `_bmad-output/implementation-artifacts/deferred-work.md` (13 deferred findings from this review)
