# Story 0.1: Initialize Monorepo from create-t3-turbo Starter Template

Status: in-progress

## Story

As a developer,
I want a working monorepo initialized from `create-t3-turbo` with Expo SDK 54, Next.js 15, tRPC v11, Drizzle ORM, and Supabase configured,
so that all subsequent feature stories start from a known, reproducible baseline with shared packages in place.

## Acceptance Criteria

1. **Given** a clean working directory, **When** `pnpm install` is run, **Then** `apps/expo`, `apps/web`, `packages/api`, `packages/db`, `packages/ui` all resolve without errors, **And** `pnpm turbo build` completes successfully with no TypeScript errors.

2. **Given** the monorepo is initialized, **When** `apps/expo` is started with `pnpm dev`, **Then** the Expo dev server starts and the default app renders on a simulator without native build errors.

3. **Given** the monorepo is initialized, **When** `apps/web` is started with `pnpm dev`, **Then** the Next.js dev server starts and the default page renders at `localhost:3000`.

4. **Given** Better Auth ships with the create-t3-turbo starter, **When** the foundation story is accepted, **Then** Better Auth is removed and replaced with Supabase Auth; no Better Auth import remains in any package.

## Tasks / Subtasks

- [x] Task 1: Initialize monorepo from create-t3-turbo starter (AC: #1)
  - [x] Run: `npx create-turbo@latest -e https://github.com/t3-oss/create-t3-turbo --package-manager pnpm`
  - [x] Name the project `healthtracker`
  - [x] Verify directory structure matches expected shape (see Project Structure Notes)
  - [x] Run `pnpm install` and confirm no errors
  - [x] Run `pnpm turbo build` and confirm no TypeScript errors

- [x] Task 2: Verify Expo dev server (AC: #2)
  - [x] Run `pnpm dev` in `apps/expo` (or `pnpm turbo dev`)
  - [x] Confirm Expo Metro bundler starts without errors
  - [x] Confirm default screen renders on iOS or Android simulator

- [x] Task 3: Verify Next.js dev server (AC: #3)
  - [x] Run `pnpm dev` in `apps/web`
  - [x] Confirm Next.js starts and `localhost:3000` renders without errors

- [x] Task 4: Remove Better Auth and install Supabase Auth client (AC: #4)
  - [x] Uninstall `better-auth` and all related packages from every workspace
  - [x] Remove all Better Auth config files (e.g. `auth.config.ts`, `auth.ts` if Better Auth-specific)
  - [x] Remove all Better Auth imports across `packages/api`, `apps/expo`, `apps/web`
  - [x] Install Supabase Auth client packages: `@supabase/supabase-js` and `@supabase/ssr` where needed
  - [x] Create `packages/auth/src/client.ts` — Supabase browser/Expo client helpers
  - [x] Create `packages/auth/src/server.ts` — Supabase server-side auth helpers
  - [x] Wire `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` as env vars in `.env.example`
  - [x] Confirm `grep -r "better-auth" .` returns zero results (excluding `node_modules`)
  - [x] Run `pnpm turbo build` again — must still pass with no TypeScript errors

## Dev Notes

### Critical Initialization Command

```bash
npx create-turbo@latest -e https://github.com/t3-oss/create-t3-turbo \
  --package-manager pnpm
```

This is the exact command from `architecture.md`. Do not use a generic `create-turbo` without `-e` — that creates a different template without Expo, Supabase, or Drizzle.

### What the Starter Ships (Pre-Modification)

The create-t3-turbo starter ships:
- **Next.js 15** (App Router, Server Components, streaming)
- **Expo SDK 54** (React Native, managed workflow)
- **React 19** on both platforms
- **tRPC v11** — end-to-end type safety
- **Drizzle ORM** on Supabase PostgreSQL
- **Supabase** (DB + Storage) — already present in template
- **Better Auth** — the auth layer to REMOVE in this story
- **Tailwind CSS v4 + shadcn-ui** — the styling layer; DO NOT remove in this story (deferred to Story 0.2 — Tamagui setup)

### What This Story Does NOT Do

The following are deferred to later stories and must NOT be implemented here:
- **Tamagui installation** — Story 0.2
- **`metro.config.js` `unstable_enablePackageExports=true`** — Story 0.2
- **RLS token principal model / `SET LOCAL` pattern** — Story 0.4
- **`drizzle.config.ts` migration protection** — Story 0.4
- **pg-boss queue setup** — Story 0.5
- **GitHub Actions CI pipeline** — Story 0.6
- **Sentry configuration** — Story 0.7
- **Supabase Auth magic link or email provider configuration** — Story 0.3 (this story only installs the client and removes Better Auth)

### Better Auth Removal — What to Look For

The starter wires Better Auth in these locations (verify and remove all):
- `packages/auth/` or inline auth config
- tRPC context initializer in `packages/api/src/trpc.ts` (will reference Better Auth session)
- Next.js middleware (`apps/web/src/middleware.ts`) — likely uses Better Auth session refresh
- API route handlers (e.g. `/api/auth/[...betterauth]/route.ts` in `apps/web`)
- Expo auth screens

Replace with minimal Supabase Auth stubs that satisfy TypeScript — full Supabase Auth configuration (magic link, email providers) is Story 0.3.

### Supabase Auth Client Setup (Minimal, for This Story)

Create `packages/auth` with this structure:
```
packages/auth/
  package.json           — name: "@healthtracker/auth"
  src/
    index.ts             — re-exports
    client.ts            — createBrowserClient() / createNativeClient() via @supabase/ssr
    server.ts            — createServerClient() for Next.js server components
```

For `client.ts` (browser/Expo):
```typescript
import { createBrowserClient } from '@supabase/ssr'

export const createSupabaseClient = () =>
  createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  )
```

For `server.ts` (Next.js App Router):
```typescript
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

export const createSupabaseServerClient = async () => {
  const cookieStore = await cookies()
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll: () => cookieStore.getAll(), setAll: (c) => c.forEach(({ name, value, options }) => cookieStore.set(name, value, options)) } }
  )
}
```

Expo uses `@supabase/supabase-js` directly with `AsyncStorage` adapter — wire that in `apps/expo/src/lib/supabase.ts`.

### tRPC Context After Better Auth Removal

The tRPC context in `packages/api/src/trpc.ts` will need updating to use Supabase Auth for session retrieval. Minimal stub for this story — full `SET LOCAL` RLS wiring happens in Story 0.4:

```typescript
// packages/api/src/trpc.ts — minimal session stub for this story
export const createTRPCContext = async (opts: { headers: Headers }) => {
  // Story 0.3 will add full Supabase Auth session; Story 0.4 adds SET LOCAL
  return { db, headers: opts.headers }
}
```

### Environment Variables Required

Add to `.env.example` (not `.env` — never commit secrets):
```
# Supabase — get from Supabase project settings > API
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
DATABASE_URL=            # session-mode pooler URL (Story 0.3 will document this)
```

### Project Structure — Expected After This Story

The initialized monorepo must match this shape (top-level only — internals may vary from starter defaults and will be refined in later stories):

```
healthtracker/
├── apps/
│   ├── expo/            — React Native patient app
│   └── web/             — Next.js 15 (App Router)
├── packages/
│   ├── api/             — @healthtracker/api (tRPC routers)
│   ├── auth/            — @healthtracker/auth (Supabase Auth — created this story)
│   ├── db/              — @healthtracker/db (Drizzle + Supabase)
│   ├── ui/              — @healthtracker/ui (shared components)
│   └── config/          — shared ESLint, TypeScript, Prettier
├── package.json
├── pnpm-workspace.yaml
├── turbo.json
└── tsconfig.json
```

Note: The starter may name the Next.js app `apps/nextjs` or `apps/next` — rename to `apps/web` to match the architecture convention. Similarly `packages/validators` (if present in starter) can be kept or merged into `packages/types` (created in Story 0.2+).

### TypeScript Strict Mode

The starter uses `tsconfig` references. Confirm `compilerOptions.strict: true` is set in the root `tsconfig.json` and all package-level `tsconfig.json` files. Do not disable `strict` to fix errors — fix the errors.

### Naming Conventions Established

These apply from Story 0.1 onward (architecture.md enforcements):
- **DB identifiers:** `snake_case` (e.g., `patient_id`, `loinc_code`)
- **TypeScript identifiers:** `camelCase` for variables/functions, `PascalCase` for types/interfaces/components
- **tRPC routers:** `camelCase` (e.g., `observationsRouter`)
- **Packages:** `@healthtracker/{name}`

### Project Structure Notes

- `packages/auth` does not exist in the starter — create it as part of Better Auth removal
- Starter may ship `packages/validators` — keep as-is or leave for future refactor (don't delete without understanding what imports it)
- Do not restructure anything not required by this story's ACs — leave starter defaults in place where not explicitly required to change
- The `apps/` directory naming (`expo` vs `mobile`, `web` vs `nextjs`) should follow architecture.md: `apps/expo` and `apps/web`

### References

- Initialization command: [Source: architecture.md#Selected Foundation: create-t3-turbo]
- Stack versions (Next.js 15, Expo SDK 54, tRPC v11, Drizzle, Supabase): [Source: architecture.md#Architectural Decisions Provided by Starter]
- Better Auth removal decision: [Source: architecture.md#Authentication — Decision: Supabase Auth (Better Auth removed)]
- `packages/auth` structure: [Source: architecture.md#Complete Project Directory Structure]
- Story requirements: [Source: epics.md#Story 0.1]
- AR1: create-t3-turbo initialization mandate: [Source: epics.md#Architecture-derived requirements AR1]
- AR3: Supabase Auth (remove Better Auth): [Source: epics.md#AR3]

## Dev Agent Record

### Agent Model Used

claude-sonnet-4-6

### Debug Log References

- Used `degit` instead of interactive `npx create-turbo@latest` CLI to clone template into a non-empty directory (BMAD artifacts already present)
- `sherif` postinstall hook enforces alphabetical dependency ordering; fixed sorting in `apps/expo/package.json`, `apps/web/package.json`, and `packages/auth/package.json`
- Added `SKIP_ENV_VALIDATION` to `turbo.json` `globalPassThroughEnv` so build can be verified without a `.env` file present
- Fixed `apps/web/src/trpc/server.tsx` import of removed `auth` — replaced with `getSession` from Supabase server client

### Completion Notes List

- Cloned create-t3-turbo via `degit`, excluded `apps/tanstack-start` (not in architecture)
- Renamed `apps/nextjs` → `apps/web`, updated all references across `package.json`, `turbo.json`, root scripts
- Replaced all `@acme/` package prefixes with `@healthtracker/`
- Removed Better Auth entirely: `packages/auth/script/`, `packages/db/src/auth-schema.ts` Better Auth tables, all imports in api/expo/web
- Created `packages/auth/src/{index,client,server}.ts` with Supabase Auth stubs (browser, server, getSession)
- Updated `packages/api/src/trpc.ts` context to use Supabase `Session` type
- Updated `pnpm-workspace.yaml` catalog with Supabase packages, removed Better Auth entries
- Updated `turbo.json` globalEnv with Supabase vars, removed Better Auth vars
- `SKIP_ENV_VALIDATION=1 pnpm turbo build` → 4/4 tasks successful, zero TypeScript errors
- `grep -r "better-auth" .` → zero results

### File List

- `pnpm-workspace.yaml` — replaced better-auth catalog entries with @supabase/supabase-js, @supabase/ssr
- `package.json` (root) — renamed project `healthtracker`, updated dev:next script to `@healthtracker/web`
- `turbo.json` — replaced AUTH_* globalEnv with Supabase vars, added SKIP_ENV_VALIDATION to globalPassThroughEnv
- `.env.example` — replaced Better Auth env vars with Supabase + POSTGRES_URL (session-mode pooler)
- `apps/web/` — renamed from `apps/nextjs/`
- `apps/web/package.json` — renamed to `@healthtracker/web`, added Supabase deps, removed better-auth
- `apps/web/src/env.ts` — replaced AUTH_* vars with NEXT_PUBLIC_SUPABASE_*, added SKIP_ENV_VALIDATION support
- `apps/web/src/auth/client.ts` — replaced better-auth/react with Supabase browser client
- `apps/web/src/auth/server.ts` — replaced Better Auth server init with Supabase server client re-export
- `apps/web/src/app/api/auth/[...all]/route.ts` — replaced auth.handler with minimal placeholder
- `apps/web/src/app/api/trpc/[trpc]/route.ts` — replaced auth with getSession for tRPC context
- `apps/web/src/app/_components/auth-showcase.tsx` — replaced Better Auth social provider with getSession stub
- `apps/web/src/trpc/server.tsx` — replaced auth import with getSession
- `apps/expo/package.json` — removed better-auth, added @supabase/supabase-js + async-storage
- `apps/expo/src/utils/auth.ts` — replaced Better Auth expo client with Supabase + AsyncStorage
- `apps/expo/src/utils/api.tsx` — removed Better Auth cookie forwarding from tRPC headers
- `apps/expo/src/app/index.tsx` — removed MobileAuth component, simplified to health tracker posts view
- `packages/auth/package.json` — removed better-auth/drizzle deps, added @supabase/ssr + supabase-js, updated exports
- `packages/auth/env.ts` — replaced AUTH_* vars with NEXT_PUBLIC_SUPABASE_URL + ANON_KEY
- `packages/auth/src/index.ts` — replaced Better Auth init with Supabase re-exports
- `packages/auth/src/client.ts` — new: Supabase browser client helper
- `packages/auth/src/server.ts` — new: Supabase server client + getSession helper
- `packages/api/src/trpc.ts` — replaced Auth type with Session, updated createTRPCContext signature
- `packages/db/src/auth-schema.ts` — cleared Better Auth Drizzle tables
- `packages/db/src/schema.ts` — removed auth-schema re-export

### Change Log

- 2026-05-15: Story 0.1 implemented — monorepo initialized from create-t3-turbo, Better Auth removed, Supabase Auth stubs wired

### Review Findings

**Decision needed:**
- [x] [Review][Decision] D1: Expo Supabase client file path — created `apps/expo/src/lib/supabase.ts`; `apps/expo/src/utils/auth.ts` re-exports from new location ✅
- [x] [Review][Decision] D2: Env key naming — standardized on `DATABASE_URL` across `.env.example`, `apps/web/src/env.ts`, `packages/db/drizzle.config.ts`, `turbo.json` ✅
- [x] [Review][Decision] D3: tRPC context includes session + protectedProcedure — kept as intentional forward-compatible improvement ✅
- [x] [Review][Decision] D4: CORS restricted to `CORS_ORIGIN` env var (default `http://localhost:3000`) — `apps/web/src/app/api/trpc/[trpc]/route.ts` ✅

**Patches:**
- [x] [Review][Patch] P1: Removed spurious `Access-Control-Request-Method` header from tRPC route [apps/web/src/app/api/trpc/[trpc]/route.ts] ✅
- [x] [Review][Patch] P2: Fixed `next: ^16.0.9` → `^15.3.0` [apps/web/package.json] ✅
- [x] [Review][Patch] P3: Removed `auth:generate` root script (packages/auth has no generate script) [package.json] ✅
- [x] [Review][Patch] P4: `.vscode/launch.json` updated `apps/nextjs` → `apps/web` ✅
- [x] [Review][Patch] P5: `turbo.json` dev task `persistent: false` → `persistent: true` ✅
- [x] [Review][Patch] P6: `getSession()` now calls `auth.getUser()` first to re-validate JWT server-side [packages/auth/src/server.ts] ✅
- [x] [Review][Patch] P7: `authEnv()` now imported and used in `packages/auth/src/client.ts` and `packages/auth/src/server.ts` — env vars validated via Zod ✅
- [x] [Review][Patch] P8: Added `next: ">=15"` peerDependency to `packages/auth/package.json` ✅

**Deferred:**
- [x] [Review][Defer] W1: Auth callback stub returns `{ok:true}` for all requests [apps/web/src/app/api/auth/[...all]/route.ts] — deferred, intentional per story spec; Story 0.3 implements full PKCE exchange
- [x] [Review][Defer] W2: `@vercel/postgres` DB adapter (starter template default) — deferred, pre-existing; local dev needs Supabase-compatible connection; address in future story
- [x] [Review][Defer] W3: Two parallel Expo session stores (`session-store.ts` SecureStore vs Supabase AsyncStorage) [apps/expo/src/utils/session-store.ts] — deferred, pre-existing; Story 0.3 will unify auth state
- [x] [Review][Defer] W4: `postinstall` runs unpinned `sherif@latest` [package.json] — deferred, pre-existing; starter template default
- [x] [Review][Defer] W5: `console.log` timing on every tRPC call in all environments [packages/api/src/trpc.ts] — deferred, pre-existing; starter template default
- [x] [Review][Defer] W6: `updatedAt` is NULL on insert — `$onUpdateFn` only fires on updates, no `defaultNow()` [packages/db/src/schema.ts] — deferred, pre-existing; starter template artifact
- [x] [Review][Defer] W7: `CreatePostSchema` caps `content` at 256 chars inconsistently with `text` column [packages/db/src/schema.ts] — deferred, pre-existing; starter template artifact
- [x] [Review][Defer] W8: `drizzle.config.ts` port-replace logic tied to `@vercel/postgres` assumption — deferred, pre-existing; linked to W2
- [x] [Review][Defer] W9: `POSTGRES_URL` optional in env validation — deferred, pre-existing; linked to W2
