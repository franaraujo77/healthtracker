# Deferred Work

## Deferred from: code review of 0-7-configure-sentry-error-tracking-with-pii-scrubbing (2026-05-17)

- **D1: Breadcrumb `message` string not scanned for PII** — `packages/config/src/sentry.ts` — freeform breadcrumb messages (e.g., "User patient@x.com signed in") are not redacted; requires regex/NLP approach; out of scope for this story
- **D2: Exception message/value strings not scanned for PII** — `packages/config/src/sentry.ts` — error messages like `"validation failed for patient_id=uuid"` pass through unredacted; requires structured approach; out of scope
- **D3: `sentryBeforeSend` mutates incoming event object** — `packages/config/src/sentry.ts` — modifies properties on the argument directly; Sentry SDK doesn't reuse event references in practice so this is benign; revisit if Sentry SDK behavior changes
- **D4: PII key list has no governance path** — `packages/config/src/sentry.ts` — new biomarker fields won't be auto-detected; no linting rule or schema cross-check; address when data model stabilises in Epic 2
- **D5: `tracesSampleRate: 0.1` not environment-aware** — `apps/web/sentry.*.config.ts`, `apps/expo/src/app/_layout.tsx` — 10% of traces sent from dev/staging; acceptable for now; add env guard before high-traffic production launch
- **D6: Metro `unstable_enablePackageExports` override fragile** — `apps/expo/metro.config.js` — manual re-set after `withSentryConfig` wrap may silently fail if future Sentry version changes Metro wrapper behavior; current impl works and is documented

## Deferred from: code review of 0-3-configure-supabase-auth-with-magic-link-and-email-providers (round 2, 2026-05-17)

- **D1: `auth/callback` route uses `new URL(request.url).origin`** — safe on Vercel (Next.js resolves the external URL), but may return an internal origin on reverse-proxy deployments (Railway, custom ingress); revisit if the app moves off Vercel
- **D2: `cancelled` flag doesn't abort in-flight `exchangeCodeForSession`** — the exchange completes after component unmount; harmless (Supabase client state is updated), cosmetic async leak; fix when RootLayout is refactored
- **D3: `bundleIdentifier: "your.bundle.identifier"` placeholder in `app.config.ts`** — required for iOS Universal Links / Android App Links; set to real identifiers before app store submission
- **D4: Double Supabase round-trip in `packages/auth/src/server.ts`** — see original D1 in deferred-work.md from Story 0.3 round-1 review

## Deferred from: code review of 0-6-set-up-github-actions-ci-cd-pipeline (2026-05-17)

- **D1: `actions/setup-node@v6` in composite action** — `tooling/github/setup/action.yml` — pre-existing; v6 may not exist as of review; verify and pin to `v4` if broken
- **D2: `getDbUrl()` single-occurrence port replace** — `packages/db/__tests__/rls/helpers.ts` — same pattern as `drizzle.config.ts`; port string in password would corrupt the URL; use `new URL()` parser when first adversarial test is written
- **D3: `supabase/migrations/` directory absent** — `supabase/config.toml` exists but no migrations; `supabase start` starts with blank schema; create migrations directory and seed in Epic 1 when patient-data RLS policies are needed
- **D4: `rls-adversarial` DATABASE_URL points to remote Supabase placeholder** — harmless while all tests are `it.todo()`; the job must override DATABASE_URL to the local Supabase URL (`postgresql://postgres:postgres@127.0.0.1:54322/postgres`) before any real test is written

## Deferred from: code review of 0-5-configure-pg-boss-extraction-job-queue (2026-05-17)

- **W1: `createQueue` idempotency on restart** — `services/extraction/src/index.ts` — pg-boss v12 handles schema idempotently; minor concern about retry option drift if queue options change between deploys; revisit when first real extraction queue is added in story 2.1
- **W2: `db.ts` `sql` client not explicitly torn down** — `services/extraction/src/db.ts` — `process.exit(0)` closes connections; causes cosmetic "connection terminated unexpectedly" in Postgres logs on every restart; add `sql.end()` before `process.exit` in story 2.1 or 0-6
- **W3: No `SIGINT` handler** — `services/extraction/src/index.ts` — `Ctrl+C` in dev skips graceful shutdown; `--watch` re-spawn may fail if advisory lock not released; add alongside SIGTERM in story 0-6
- **W4: `JobPayload.createdAt` unvalidated string** — `packages/types/src/jobs.ts` — typed as `string`; no runtime parse guard; consumers that derive dates from this field will silently operate on bad data if a job is manually inserted; add Zod schema in story 2.1 when extraction consumers are implemented
- **W5: `enqueue-smoke-test.ts` assumes queue exists** — `services/extraction/src/enqueue-smoke-test.ts` — does not call `createQueue` before `boss.send()`; manual tool intended to run after worker has started at least once; acceptable for smoke-test use; document in README in story 0-6

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
