# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository Overview

Full-stack health tracker built as a **pnpm + Turborepo monorepo** sharing code between a Next.js 15 web app and a React Native Expo mobile app. The API layer uses tRPC for end-to-end type safety, Drizzle ORM for database access (PostgreSQL via Supabase), and Supabase for authentication.

## Behavioral guidelines

1. **Think before coding.** State assumptions explicitly; if uncertain or multiple interpretations exist, ask rather than pick silently. If a simpler approach exists, say so.
2. **Simplicity first.** Minimum code that solves the problem — no speculative features, abstractions, configurability, or error handling for impossible scenarios.
3. **Surgical changes.** Touch only what the request requires. Don't refactor or reformat adjacent code; match existing style. Remove only orphans your own change created; mention pre-existing dead code rather than deleting it.
4. **Goal-driven execution.** Turn tasks into verifiable goals (write the failing test, then make it pass). State a brief plan for multi-step work.
5. **Never destroy without explicit approval.** When a workflow hits a wall (PR can't rebase, fix is structurally impossible, migration would corrupt data), **stop** — do not close PRs, delete branches, force-push, revert, or drop tables, even when the action seems obviously correct. Explain the finding with evidence, list 2–3 options (including "do nothing") without pre-selecting, and let the user decide. A reversible delay costs minutes; an irreversible unilateral action can cost hours and trust. The "obvious" answer is the failure mode — obviousness is how an agent rationalizes skipping confirmation.

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

### Migration discipline

`pnpm db:push` is fine for additive column/index changes (dev) and ships dev-only schema for a story; prod deploy lands in the epic's consolidated migration under `supabase/migrations/`.

- **Partial unique index `WHERE`-clause changes that NARROW or SHIFT the predicate are NOT safe via `db:push` in prod** — Drizzle emits non-`CONCURRENTLY` `DROP`+`CREATE`, which takes a `ShareLock` and opens a constraint-violation window. Write a `CREATE … CONCURRENTLY` migration and apply it via `psql` directly. The Supabase CLI wraps each migration file in an implicit transaction, so `CONCURRENTLY` fails inside it with SQLSTATE 25001 — there is **no** `no-transaction` directive.
- **Strict-superset WIDENING** (e.g. adding a value to an `event IN (...)` predicate) IS safe non-`CONCURRENTLY` and can ship as a normal migration file.
- **`CONCURRENTLY`-bearing files live in `supabase/migrations-postapply/`**, NOT `supabase/migrations/`, so the Supabase CLI doesn't wrap them. The `supabase-deploy` workflow runs `supabase db push` first, then applies each post-apply file in lex order via `psql … -v ON_ERROR_STOP=1 -f` (autocommit, no `-1`). These files MUST be bare DDL (no `BEGIN`/`COMMIT`), use `CREATE … CONCURRENTLY IF NOT EXISTS` (re-run-safe), have their parent table created by a sibling `db push` migration, and use an ordinal that sorts after that parent.

Canonical examples: the 3-step create-`_v2` → drop → rename pattern in `supabase/migrations/0004_epic_4_audit_index_letter_queued.sql`; post-apply files `0007_epic_6_patient_invites_active_uq.sql` and `0008_epic_5_partial_uniques.sql`.

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

**Environment**: Copy `.env.example` to `.env` at the repo root before running anything. Required vars: `DATABASE_URL`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `CORS_ORIGIN`. Several secrets are boot-gated (NFR-S6): required outside `NODE_ENV=development|test`, with dev/test falling back to a stub or deterministic dev-only value:

- `SUPABASE_SERVICE_ROLE_KEY` — `apps/web/src/env.ts` fails first-request after deploy if missing; `packages/api/src/storage.ts` also throws a clear deploy-config error on any storage op (covers `services/llm`, `services/extraction`).
- `ANTHROPIC_API_KEY` — empty in dev → stub adapter; non-empty in prod → real Claude Sonnet (DPA-gated). With `LLM_SERVICE_URL` / `EXPO_PUBLIC_LLM_SERVICE_URL` for the persistent `services/llm` SSE server (`pnpm --filter @healthtracker/llm-service dev` on `:3001`).
- `SHARE_TOKEN_HMAC_SECRET` — dev/test falls back to a deterministic secret with a console warning.
- `WEB_APP_URL` — base for the `/m/<shareTokenId>.<tokenHmac>` magic-link.

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

The dependency direction is **api → db** only; `db` must never import `api`.

### tRPC

- Context is built in `packages/api/src/trpc.ts`: it attaches the Supabase session and the Drizzle `db` client to every request.
- Routers live in `packages/api/src/router/`. Add a new router there and register it in `packages/api/src/router/index.ts`.
- `publicProcedure` vs `protectedProcedure` — the latter throws `UNAUTHORIZED` if there is no session. Doctor-side procedures (`doctorProcedure`, `professionalSessionProcedure`) bind the RLS principal via `SET LOCAL` GUCs — see RLS notes below.
- Dev mode adds a fake 100–500 ms delay via timing middleware to surface latency issues early.
- Both apps consume the API through a shared tRPC client; the web app also uses React Server Components with a server-side caller.

### Database

- Schema files live in `packages/db/src/schema/`. The auth schema (`auth-schema.ts`) is auto-generated by Supabase — do not hand-edit it.
- Drizzle is configured for `snake_case` column naming and the `postgres-js` driver (`packages/db/src/client.ts`). Note: `@vercel/postgres` speaks Neon's HTTP protocol and refuses Supabase connection strings — postgres-js is the required driver.
- Use `pnpm db:push` for schema sync (not `drizzle-kit generate` + `migrate`).
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
- Deps that only work in a native runtime (e.g. `@react-native-community/datetimepicker`, `expo-audio`) must live in `apps/expo` ONLY — importing them from `packages/ui` breaks `next build`. The pattern for shared components needing native widgets is a `render*` slot prop the consumer injects.

### Mobile app (`apps/expo`)

- Expo SDK 54, React Native 0.81.5, Expo Router 6 for file-based navigation.
- NativeWind 5 provides Tailwind styling; the shared `tailwind-config` package is referenced directly.
- React Compiler and typed routes are enabled as experimental features.
- Hermes does not polyfill `Buffer` — never `Buffer.from(base64)` for uploads; use `fetch(uri).blob()`.
- Never derive a `yyyy-mm-dd` date with `.toISOString().slice(0,10)` (UTC-shift hazard). Use local-calendar conversion helpers.

### Shared UI (`packages/ui`)

- Components are added via `pnpm ui-add` (shadcn/ui CLI). Do not copy-paste component code manually.
- All components are re-exported from `packages/ui/src/index.ts`.

## Code review discipline

Two rounds of code review per story is a hard process gate. Recurring patterns to enforce:

- **Narrow catches by default.** Any `try/catch` in new code must articulate which error shapes it swallows (e.g. `if (err.code === '23505') ...; throw err`). Broad `catch (err)` that fail-opens hides programmer errors (`TypeError`, etc.) and infra faults — write it narrow the first time.
- **TOCTOU safety.** Don't SELECT-EXISTS-then-INSERT. Use a partial unique index + a narrow `23505` catch at the helper. Verify partial-index `ON CONFLICT … WHERE` clauses don't exclude the rows they're meant to dedup.
- **Dead-code guards.** Don't re-check in application code a condition a SELECT already filters by.
- **Query-param coupling.** When a route helper adds a query-string flag, verify the destination route actually consumes it (producer without consumer is a recurring bug).
- **RLS test matrices are mandatory and must be complete.** Every identity named in a test docstring must have a corresponding `it(...)` block. The matrix size depends on the surface (see RLS conventions below). Round-1 reviewers verify each identity has a real assertion, not a claimed one.

## RLS & sharing conventions

The doctor/patient sharing surface is the security core. Durable invariants:

- **RLS principals are bound via `SET LOCAL` GUCs.** Patient principal → `app.current_patient_id`; share-token doctor principal → `app.current_share_token_id` (`doctorProcedure`); session-only doctor principal → `app.current_doctor_user_id` (`professionalSessionProcedure`, for `/profissional/*` surfaces with no share-token in context). Policy bodies live in `packages/db/policies/custom_rls_*.sql`.
- **RLS test matrices by surface:**
  - Sharing tables with a share-token doctor principal → **6-identity**: `correctPatient`, `wrongPatient`, `serviceRole`, `doctorWithActiveToken`, `doctorWithExpiredToken`, `doctorWithRevokedToken`.
  - Doctor-scoped tables keyed on `auth.uid()` (e.g. `patient_invites`, `staleness_thresholds`) → **7-identity**: add `unrelatedDoctor` (a different activated doctor whose uid is not the row's `professional_user_id`; expected 0 rows — cross-doctor isolation). INSERT-WITH-CHECK, UPDATE-cross-tenant, and DELETE-policy-absent are mandatory blocks.
  - Personal-context tables (Epic 7) → **4-identity** with the **doctor-zero-rows invariant**: no doctor RLS policy ships at all; the absence of any doctor policy IS the defense (`privacy_flag` is metadata for a future consent surface, not a defense). Tests must assert "doctor SELECT returns 0 rows", not "query doesn't error".
- **Privilege escalation must always reset in the same tx scope.** Where a resolver does `SET LOCAL ROLE postgres` to reach a table the principal has no policy on (e.g. `activateProfessionalAccount` locking `pending_invites`), it MUST pair it with `SET LOCAL ROLE NONE` via `try { … } finally { … }`. Dropping the `finally` leaves RLS bypassed for later statements.
- **Pre-auth resolvers are deliberately `publicProcedure`, not `doctorProcedure`.** `sharingRouter.getPreAuthContext` (the `/m/[token]` landing) must distinguish `active`/`expired`/`revoked`/`invalid` — the doctor RLS predicate filters out non-active rows, so running it under `doctorProcedure` would collapse them to a single 404 and erase the patient's surveillance surface. Run the HMAC compare even for revoked/expired rows (a stale-but-valid HMAC must show the correct dead-link state). No enumeration oracle: unknown id, bad HMAC, and malformed URL all render the same `invalid` UI. `share_tokens_preauth.rls.test.ts` guards against a regression to `doctorProcedure`.
- **HMAC domain separation is load-bearing.** `SHARE_TOKEN_HMAC_SECRET` is reused across surfaces with a domain prefix on the signing input — `signPatientInviteToken(raw) = HMAC(secret, "patient_invite:" + raw)`. This is what stops a `share_tokens.id` signature replaying as a `patient_invites.id` signature. Any refactor that drops the prefix is a vulnerability. Regression: `signShareToken(raw) !== signPatientInviteToken(raw)`.
- **`pending_invites` (patient→doctor) and `patient_invites` (doctor→patient) are deliberate sibling tables, not one shared table** — opposite FK directions, different RLS principals, different lifecycles. The duplication is intentional (sharing one would force rewriting four RLS policies + a ShareLock-prone partial-index shift).

## FK cascade rule (LGPD account deletion)

Every NEW FK to `users(id)` MUST use `onDelete: 'cascade'` or account deletion leaves orphan rows. Document any exception in this section alongside a regression test. Current exceptions:

- `audit_log` — pseudonymize-only (append-only ledger, NFR-S4). Deletion UPDATEs `actor_id`/`resource_id` to a deterministic uuid from `sha256(patient_id || ACCOUNT_DELETION_SALT)` and regex-scrubs metadata. Salt rotation invalidates linkability across the boundary (accepted).
- `account_deletion_requests.patient_id` — intentionally FK-less; the ledger row outlives the user.
- `pending_invites.resolved_user_id` (Story 6.3) and `patient_invites.resolved_user_id` (Story 6.4) — `onDelete: 'set null'`. These rows encode the *other party's* authored intent/telemetry; a third party's account deletion must orphan the linkage, not delete the row. Locked by `*_resolved_user_id_fk.rls.test.ts`.

When adding a patient-scoped Storage bucket, add it to `PATIENT_STORAGE_BUCKETS` in `services/llm/src/account-deletion.ts` (currently `lab_uploads`, `exports`) or it won't be cleaned at deletion.

## Audit log conventions

- `audit_log` is append-only (NFR-S4) — never store free-text PII there (it can't be redacted later). Closed enums are fine; free text (e.g. a life-event `description`) is omitted from metadata.
- The Acessos tab (patient-facing doctor-access narrative) renders only kinds in `ACCESS_LOG_EVENT_KINDS`. Doctor-side and personal-context events (`professional_account.activated`, `patient_invite.sent`/`.resolved`, `staleness_threshold.updated`, `life_event.created`, `emotional_checkin.recorded`, `voice_memo.recorded`, deletion-retry) are deliberately NOT in the allowlist. A validators regression test locks each absence — new such kinds must add an `expect(...).not.toContain(...)`.

## LGPD-exempt surfaces (do not gate on subscription tier)

Data-portability (`requestExport`) and right-to-erasure (`accountRouter.requestDeletion`) are Art. 18 rights — gating them on `premiumProcedure` would be illegal. They use `protectedProcedure`; reviewers must verify the gate stays off when touching this code. Both use the `(patient_id) WHERE status IN (...)` partial-unique + narrow `23505` idempotency-shield pattern.

## Integration test discipline

- **Resolver-call integration tests are the default.** New tRPC resolvers landing testcontainer coverage should ship a test invoking `appRouter.createCaller(ctx).<router>.<resolver>(...)` against a testcontainer-bound `ctx.db` — exercising gate-throws, narrow-catch composition, and audit emission end-to-end, not just the SQL shape.
- **Inline-SQL mirrors are the fallback ONLY when the dep graph blocks the resolver call** (db can't import api; some surfaces depend on Supabase-managed `auth.users` not provisioned by `drizzle-kit push`). When used, the mirror MUST cover every spec case the resolver does, include the gate + existence probe + partial-index race, and document at the file header WHY the resolver-call path is blocked. The forward fix is hoisting the testcontainer harness to a workspace-shared location (tracked in deferred-work).

## Tooling conventions

- **TypeScript**: strict mode, `noUncheckedIndexedAccess`, `moduleResolution: "Bundler"`, ES2022 target.
- **ESLint**: configs in `tooling/eslint/` — `base`, `nextjs`, `react`. Each app/package extends the appropriate one.
- **Prettier**: import sorting (`@iva/prettier-plugin-import-sort`) and Tailwind class sorting are active.
- **Turborepo**: task caching is on by default. The `dev` and `db:studio` tasks are marked persistent; `db:push` and `ui-add` are interactive.

---

> **Note:** Detailed per-story implementation history (Epic 2–7 retros, round-1/round-2 patch IDs, deferred-work items) was trimmed from this file to keep it lean. That context lives in git history, the cited regression/RLS test files, the `supabase/migrations*` files themselves, and `_bmad-output/implementation-artifacts/deferred-work.md`.
