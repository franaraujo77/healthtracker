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

## Tooling conventions

- **TypeScript**: strict mode, `noUncheckedIndexedAccess`, `moduleResolution: "Bundler"`, ES2022 target.
- **ESLint**: configs in `tooling/eslint/` — `base`, `nextjs`, `react`. Each app/package extends the appropriate one.
- **Prettier**: import sorting (`@iva/prettier-plugin-import-sort`) and Tailwind class sorting are active.
- **Turborepo**: task caching is on by default. The `dev` and `db:studio` tasks are marked persistent; `db:push` and `ui-add` are interactive.
