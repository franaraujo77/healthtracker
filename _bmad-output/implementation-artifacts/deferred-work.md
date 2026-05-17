# Deferred Work

## Deferred from: code review of 0-7-configure-sentry-error-tracking-with-pii-scrubbing round 4 (2026-05-17)

- **D10: Array traversal does not consume depth budget** — `packages/config/src/sentry.ts` — `scrubItem` recurses into nested arrays via `item.map(scrubItem)` without decrementing depth; only the final `scrubObject` call decrements; a structure `extra → obj → obj → [[obj → {patient_id}]]` at depth=3 scrubs correctly, but `extra → obj → obj → [[obj → { sub: {patient_id} }]]` leaks at the `sub` level (depth exhausted); fix requires explicit depth parameter through `scrubArr`; benign for typical flat Sentry payloads; **→ Epic 2: revisit when biomarker data model is finalized**
- **D11: `Date`/`RegExp` objects inside arrays silently spread to `{}`** — `packages/config/src/sentry.ts` — spreading a `Date` or `RegExp` produces `{}`; Sentry serializes events before `beforeSend` so raw JS objects rarely appear; **→ Won't fix: harmless in production**

## Deferred from: code review of 0-7-configure-sentry-error-tracking-with-pii-scrubbing round 2 (2026-05-17)

- **D7: `scrubObject` depth limit undocumented** — `packages/config/src/sentry.ts` — depth=3 gives 4 levels of actual traversal; **→ Epic 2: document when data model is finalised**
- **D8: Circular references not handled in `scrubObject`** — `packages/config/src/sentry.ts` — Sentry events are serialized snapshots and rarely contain cycles; **→ Won't fix: add WeakSet guard only if production issues arise**
- **D9: Sensitive header key presence visible in Sentry UI** — `packages/config/src/sentry.ts` — only header value is replaced; key name (e.g., "authorization") remains; **→ Won't fix: design decision, key presence is acceptable**

## Deferred from: code review of 0-7-configure-sentry-error-tracking-with-pii-scrubbing (2026-05-17)

- **D1: Breadcrumb `message` string not scanned for PII** — `packages/config/src/sentry.ts` — freeform breadcrumb messages not redacted; requires regex/NLP; **→ Won't fix for MVP: out of scope, documented in pii-review-checklist.md**
- **D2: Exception message/value strings not scanned for PII** — `packages/config/src/sentry.ts` — **→ Won't fix for MVP: out of scope, documented in pii-review-checklist.md**
- **D3: `sentryBeforeSend` mutates incoming event object** — `packages/config/src/sentry.ts` — benign in practice; **→ Won't fix: Sentry SDK doesn't reuse event references**
- **D4: PII key list has no governance path** — `packages/config/src/sentry.ts` — new biomarker fields won't be auto-detected; **→ Epic 2: update scrub key list when biomarker data model is defined (see pii-review-checklist.md)**
- **D5: `tracesSampleRate: 0.1` not environment-aware** — `apps/web/sentry.*.config.ts`, `apps/expo/src/app/_layout.tsx` — **→ Pre-launch gate: add NODE_ENV guard before high-traffic production launch**
- **D6: Metro `unstable_enablePackageExports` override fragile** — `apps/expo/metro.config.js` — **→ Won't fix: documented, current impl works**

## Deferred from: code review of 0-3-configure-supabase-auth-with-magic-link-and-email-providers (round 2, 2026-05-17)

- **D1: `auth/callback` route uses `new URL(request.url).origin`** — safe on Vercel; **→ Won't fix: revisit only if app moves off Vercel**
- **D2: `cancelled` flag doesn't abort in-flight `exchangeCodeForSession`** — cosmetic async leak; **→ Won't fix: harmless, cosmetic**
- **D3: `bundleIdentifier: "your.bundle.identifier"` placeholder in `app.config.ts`** — **→ Pre-launch gate: set before App Store / Play Store submission**
- **D4: Double Supabase round-trip in `packages/auth/src/server.ts`** — see Story 0.3 round-1 D1 below

## Deferred from: code review of 0-6-set-up-github-actions-ci-cd-pipeline (2026-05-17)

- **D1: `actions/setup-node@v6` in composite action** — `tooling/github/setup/action.yml` — **→ Story 1.1: verify and pin to v4 before first Epic 1 PR**
- **D2: `getDbUrl()` single-occurrence port replace** — `packages/db/__tests__/rls/helpers.ts` — **→ Story 1.1: fix to use `new URL()` parser when first real RLS assertion is written**
- **D3: `supabase/migrations/` directory absent** — ✅ **RESOLVED (Epic 0 retro prep): directory and .gitkeep created**
- **D4: `rls-adversarial` DATABASE_URL points to remote Supabase placeholder** — **→ Story 1.1: override to local Supabase URL when first real RLS test is written**

## Deferred from: code review of 0-5-configure-pg-boss-extraction-job-queue (2026-05-17)

- **W1: `createQueue` idempotency on restart** — **→ Story 2.1: revisit when first real extraction queue is added**
- **W2: `db.ts` `sql` client not explicitly torn down** — **→ Story 2.1: add `sql.end()` before `process.exit`**
- **W3: No `SIGINT` handler** — **→ Story 2.1: add alongside SIGTERM handler**
- **W4: `JobPayload.createdAt` unvalidated string** — **→ Story 2.1: add Zod schema when extraction consumers are implemented**
- **W5: `enqueue-smoke-test.ts` assumes queue exists** — **→ Won't fix: manual dev tool, acceptable**

## Deferred from: code review of 0-4-configure-rls-token-principal-model-and-migration-protection (2026-05-17)

- **D1: `doctorProcedure` no share token DB validation** — **→ Story 5.2: validation possible once sharing token schema exists**
- **D2: Applying `custom_rls_post.sql` will break `publicProcedure` read endpoints** — ✅ **RESOLVED (Epic 0 retro prep): anon SELECT policy added to custom_rls_post.sql**
- **D3: `cleanupPosts` deletes by content LIKE prefix** — **→ Story 1.1: add test-run scoping before writing shared-env tests**
- **D4: GUC leak if pg driver closes connection without ROLLBACK** — **→ Won't fix: session-mode pooler handles normal cases**
- **D5: `shareTokenId: undefined as string | undefined` in base context** — **→ Won't fix: acceptable for current scope**
- **D6: AC3 drizzle-kit check CI gate not wired to GitHub Actions** — ✅ **RESOLVED (Story 0.6): `pnpm db:check` runs in drizzle-check CI job**

## Deferred from: code review of 0-3-configure-supabase-auth-with-magic-link-and-email-providers (2026-05-16)

- **D1: Double Supabase round-trip per request** — `packages/auth/src/server.ts` — **→ Pre-launch gate: optimise before high-traffic launch; `react cache()` deduplicates within RSC tree for now**
- **D2: Expo tRPC access token from AsyncStorage without server-side re-validation** — ✅ **RESOLVED (Epic 0 retro prep): Expo now uses SecureStore via secureStoreAdapter; server-side JWT validation via protectedProcedure unchanged**

## Deferred from: code review of 0-2-configure-tamagui-design-system-with-health-tracker-tokens (2026-05-16)

- **D1: TamaguiProvider hardcodes `defaultTheme="light"`** — **→ Post-MVP: add `useColorScheme()` detection when dark mode is user-facing**

## Deferred from: code review of 0-1-initialize-monorepo-from-create-t3-turbo-starter-template (2026-05-15)

- **W1: Auth callback stub returns `{ok:true}`** — ✅ **RESOLVED (Story 0.3)**
- **W2: `@vercel/postgres` DB adapter** — **→ Pre-launch gate: replace with native postgres driver before non-Vercel deployment**
- **W3: Two parallel Expo session stores** — ✅ **RESOLVED (Epic 0 retro prep): Supabase client now uses SecureStore exclusively; session-store.ts deleted**
- **W4: `postinstall` runs unpinned `sherif@latest`** — **→ Won't fix for now: acceptable CI cost; pin before high-churn period**
- **W5: `console.log` timing on every tRPC call** — **→ Pre-launch gate: remove or gate behind DEBUG flag before production**
- **W6: `updatedAt` NULL on insert** — **→ Story 1.1: add `defaultNow()` when patients table is defined**
- **W7: `CreatePostSchema` caps `content` at 256 chars** — **→ Won't fix: starter template artifact; post table is not used in production**
- **W8: `drizzle.config.ts` port-replace logic** — **→ Pre-launch gate: linked to W2 DB adapter replacement**
- **W9: `POSTGRES_URL` optional in env validation** — **→ Pre-launch gate: make required once DB adapter is settled**
