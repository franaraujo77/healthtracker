# Deferred Work

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
