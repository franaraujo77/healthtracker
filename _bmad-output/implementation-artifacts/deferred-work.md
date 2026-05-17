# Deferred Work

## Deferred from: code review of 0-4-configure-rls-token-principal-model-and-migration-protection (2026-05-17)

- **D1: `doctorProcedure` no share token DB validation** — `packages/api/src/trpc.ts` — any non-empty `x-share-token` header sets the doctor role in RLS with no DB lookup; requires sharing token schema (story 5.2) before validation is possible
- **D2: Applying `custom_rls_post.sql` will break `publicProcedure` read endpoints** — `post.all` / `post.byId` use no RLS transaction wrapper; once the policy is applied to the DB, anon reads will fail silently; must add an anon-safe SELECT policy or review before applying
- **D3: `cleanupPosts` deletes by content LIKE prefix** — `packages/db/__tests__/rls/setup.ts` — no test-run scoping; low risk in local dev, but add a `beforeEach` truncation or a test-run ID before running against shared environments
- **D4: GUC leak if pg driver closes connection without ROLLBACK** — `packages/api/src/trpc.ts` — SET LOCAL reverts on ROLLBACK; session-mode pooler handles normal cases; edge case only if connection teardown skips ROLLBACK
- **D5: `shareTokenId: undefined as string | undefined` in base context** — `packages/api/src/trpc.ts` — minor: downstream code can't distinguish "no token" from "token not yet set"; acceptable for current story scope
- **D6: AC3 drizzle-kit check CI gate not wired to GitHub Actions** — per dev notes, CI wiring is story 0-6; the script and npm task exist but no workflow file was modified

## Deferred from: code review of 0-3-configure-supabase-auth-with-magic-link-and-email-providers (2026-05-16)

- **D1: Double Supabase round-trip per request** — `packages/auth/src/server.ts` `getSession()` calls `getUser()` (network) then `getSession()` (cookie) sequentially; pre-existing before story 0.3; `react cache()` deduplicates within a single RSC tree but is a latency concern for high traffic; consider returning a synthetic session from the `getUser()` response to avoid the second call.
- **D2: Expo tRPC access token from AsyncStorage without server-side re-validation** — `apps/expo/src/utils/api.tsx` uses `getSession()` to retrieve the bearer token; this is the standard Supabase mobile pattern (calling `getUser()` per request would be too expensive); the server-side `protectedProcedure` validates the JWT anyway; acceptable trade-off but should be documented.

## Deferred from: code review of 0-2-configure-tamagui-design-system-with-health-tracker-tokens (2026-05-16)

- **D1: TamaguiProvider hardcodes `defaultTheme="light"`** — `packages/ui/src/providers/TamaguiProvider.tsx` — dark mode is defined in tokens and themes but not surfaced to users; per AC #4 this is intentional for MVP; a future story should add `useColorScheme()` detection and pass the active theme to the provider

## Deferred from: code review of 0-1-initialize-monorepo-from-create-t3-turbo-starter-template (2026-05-15)

- **W1: Auth callback stub returns `{ok:true}`** — `apps/web/src/app/api/auth/[...all]/route.ts` — intentional per story spec; Story 0.3 implements full PKCE token exchange
- **W2: `@vercel/postgres` DB adapter** — starter template default; outside Vercel deployments requires specific env var format; replace with native postgres driver in a future story before production
- **W3: Two parallel Expo session stores** — `apps/expo/src/utils/session-store.ts` (SecureStore, synchronous) and Supabase client (AsyncStorage, async) hold session state independently; Story 0.3 must unify auth state management to avoid stale-token races
- **W4: `postinstall` runs unpinned `sherif@latest`** — `package.json`; starter template default; fetches latest from network on every install including CI; pin to a specific sherif version
- **W5: `console.log` timing on every tRPC call** — `packages/api/src/trpc.ts`; starter template default; remove or gate behind a debug flag before production
- **W6: `updatedAt` NULL on insert** — `packages/db/src/schema.ts`; `$onUpdateFn` only fires on UPDATE, no `defaultNow()` on column; freshly-inserted rows have `updatedAt = null`
- **W7: `CreatePostSchema` caps `content` at 256 chars** — `packages/db/src/schema.ts`; inconsistent with `text` column (unbounded); starter template artifact
- **W8: `drizzle.config.ts` port-replace logic** — `packages/db/drizzle.config.ts`; strips port 6543→5432 assuming transaction-mode PgBouncer URL; linked to W2 (`@vercel/postgres` assumption)
- **W9: `POSTGRES_URL` optional in env validation** — `apps/web/src/env.ts`; linked to W2; runtime DB calls will fail if var is absent; make required once DB adapter is settled
