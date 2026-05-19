# Deferred Work

## Deferred from: code review of story-1-1 round 2 (2026-05-19)

- **F14: Supabase enumeration-prevention obscures duplicates with email-confirm enabled** — `packages/validators/src/index.ts`, `apps/web/src/app/auth/register/register-form.tsx`, `apps/expo/src/app/register.tsx` — when Supabase has email-confirm on, `signUp` for an already-registered email returns success with an obfuscated user payload (no error code). `isDuplicateEmailError` cannot detect this; the user is told "verify your email" but no email arrives. The only client-side fix is a server-side existence check (admin API), itself an enumeration oracle. Revisit as a PRD-level privacy/UX tradeoff.
- **F15: No "Entrar" affordance on the duplicate-email error message** — `apps/web/src/app/auth/register/register-form.tsx`, `apps/expo/src/app/register.tsx` — AC2's message text is exact but offers no recovery path. UX enhancement.
- **F16: Web and Expo implement registration twice** — `apps/web/.../register-form.tsx` uses `@tanstack/react-form`; `apps/expo/src/app/register.tsx` uses `useState`. Two validation/error-rendering pipelines, two drift surfaces. Extract a shared submit handler.
- **F17: `$biomarkerDeviation` Tamagui token mismatched for form errors** — `apps/expo/src/app/register.tsx`, `packages/ui/src/theme/tokens.ts` — the amber token is for biomarker deviation, not form-validation hints. Add a dedicated `$warning` / `$help` semantic token in a design-system pass.
- **F18: Web form field-error rendering depends on TanStack adapter shape** — `apps/web/src/app/auth/register/register-form.tsx` — `(typeof e === "string" ? e : e?.message)` works today because Zod v4 issues have `.message`, but is fragile. Add a regression test once apps have component-test infra (see F11).

## Deferred from: code review of story-1-1 (2026-05-19)

- **F1: User-enumeration via distinct duplicate-email message** — `apps/web/src/app/auth/register/register-form.tsx`, `apps/expo/src/app/register.tsx` — AC2 explicitly mandates the message "Já existe uma conta com esse e-mail. Tente entrar.", which is a textbook account-enumeration oracle for an LGPD product. Spec-level tradeoff; revisit at PRD level if privacy review flags it.
- **F2: Password policy strength (8 chars + ≥1 digit only)** — `packages/validators/src/index.ts` — AC1 specifies this rule; below current NIST/OWASP guidance for PHI. Revisit when stronger password policy is on the security roadmap.
- **F3: No rate-limit / captcha on registration** — `apps/web/src/app/auth/register/register-form.tsx`, `apps/expo/src/app/register.tsx` — Supabase has built-in rate limiting; revisit if abuse appears.
- **F4: No FK from `users.id` to `auth.users`** — `packages/db/src/schema/users.ts` — cross-schema FK pattern decision; deleting a Supabase auth user leaves orphaned app rows. Architecture-level call.
- **F5: No FK on `audit_log.actor_id` / `resource_id`** — `packages/db/src/schema/audit.ts` — same pattern as F4.
- **F6: No DB-level enum/check on `subscription_tier`, `actor_type`** — `packages/db/src/schema/{users,audit}.ts` — TS-only union; defenses-in-depth would add a CHECK constraint or pgEnum.
- **F7: No indexes on `audit_log(actor_id)` or `audit_log(resource_id, created_at)`** — Story 1.4 is the SELECT consumer; performance concern only once the log grows.
- **F8: `FORCE ROW LEVEL SECURITY` not enabled on any policy** — `packages/db/policies/custom_rls_*.sql` — table owner bypasses RLS; matches the Story 0.4 placeholder pattern. Cross-cutting; address in a dedicated policy-hardening pass.
- **F9: `audit_log` INSERT policy does not constrain `resource_id`** — `packages/db/policies/custom_rls_audit_log.sql` — only `actor_id` is checked; future audit writers could log events referencing other patients' resourceIds. Revisit when additional `writeAuditLog` callers ship.
- **F10: System-actor audit writes blocked by current RLS** — `packages/db/policies/custom_rls_audit_log.sql` — `actorType: 'system'` writes fail the WITH CHECK because no `app.current_patient_id` is set. Revisit when first system event ships.
- **F11: No component/E2E tests for the registration UI** — `apps/web/.../register-form.tsx`, `apps/expo/src/app/register.tsx` — no test infra in the apps yet; revisit when E2E (Playwright/Maestro) bootstraps.
- **F12: `account.test.ts` mocks the entire Drizzle chain ("test the mock")** — `packages/api/__tests__/account.test.ts` — provides limited protection against real failure modes (RLS denial, schema drift). The RLS adversarial test gives the integration coverage.
- **F13: Story Task 4 wording says `publicProcedure`, implementation uses `protectedProcedure`** — `packages/api/src/router/account.ts` — deliberate architecture decision approved by the user (client signUp + protectedProcedure initializeProfile). Recommend updating the story Task 4 text in a follow-up edit so the spec matches the code.

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
