# Deferred Work

## Deferred from: code review of story-2-3 round 2 (2026-05-22)

- **F115: `sql.begin` test mock makes `tx === sql`** — production `postgres.js` `TransactionSql` forbids nested `.begin` without `.savepoint`; current tests give false confidence. Add typing-only doc; integration test deferred.
- **F116: `awsTextractAdapter` import is eager** in worker `index.ts` regardless of `EXTRACTION_ADAPTER`. Switch to dynamic `await import()` when real SDK lands.
- **F117: `parseCollectedAt` still rejects `2024-03-15T00:00:00Z`** — R1-P103 only stripped space-then-time, not T-suffix. Extends F109.
- **F118: Worker `applyUploadTransition` raw SQL drift from API helper** — snapshot test pins only the arc map, not the SQL body. Integration test required (extends F112).
- **F119: `pending_review → processing` not in `UPLOAD_TRANSITIONS`** — Story 8.2's reviewer-reject-retry can't be modeled in the current state machine. Design decision.
- **F120: R1-P93 audit emission uses `actor_id = patientId` for system events** — actor is the worker, not the patient. F10 follow-up should introduce a sentinel system UUID or nullable actor_id.
- **F121: `writeObservation` `toISOString().slice(0, 10)` throws RangeError for years > 9999** — theoretical; document the contract.
- **F122: Empty-fixtures mock-mode error doesn't `applyDeadLetter` directly** — propagates to pg-boss → dead-letter handler → `markUploadFailed`. Multi-hop but eventually correct.

## Deferred from: code review of story-2-3 (2026-05-22)

- **F103: Nested `sql\`COALESCE(...)\``template fragments in worker`applyUploadTransition`** — verify with integration test (testcontainer or local Supabase) that the `postgres` driver inlines them as fragments, not string literals.
- **F104: `RawExtractedField.confidence` scale ambiguity** (0.0–1.0 vs 0–100) — document the contract on JSDoc; the AWS adapter stub must normalize when shipped.
- **F105: `parseBrazilianDecimal` mis-parses US-formatted `12.345` as 12345** (BR thousands sep). Add heuristic or document the limitation.
- **F106: Dead-letter `name.startsWith("extraction.")` queue sniff is brittle** — replace with explicit `markUploadFailedOnDeadLetter: boolean` per queue registration.
- **F107: `metadata: Record<string, unknown>` allows un-serializable values** (BigInt, circular, functions). Sanitize at helper or tighten type.
- **F108: collectedAt timezone-naive risk** — document the "UTC midnight only" contract or accept `YYYY-MM-DD` strings at the helper boundary.
- **F109: `parseCollectedAt` ISO regex too strict** — rejects `2024-3-15` and `2024-03-15T00:00:00Z`. Relax.
- **F110: `resolveLoincCode` accent-folding gap** ("Hemoglôbina" misses canonical "Hemoglobina"). Use unaccent extension if available.
- **F111: Review-queue `reason` enum collapses two failure modes** (structural value-parse failure + low confidence) into `low_confidence`. Story 8.x.
- **F112: Mock SQL discriminator in `document-consumer.test.ts` brittle** (`.toLowerCase().includes(...)`). Add integration test against a real Postgres.
- **F113: Year bounds `[1900, 2100]` in `parseCollectedAt` arbitrary** — move to named constant or relax.
- **F114: Terminal-state lock-miss in consumer's `processing→pending_review` / `processing→complete` returns silently** — should record an audit event indicating external mutation.

## Deferred from: code review of story-2-2 round 2 (2026-05-22)

- **F96: ExtractionPulse `failed`-state fallback only renders when ALL three recovery callbacks are undefined** — caller with only `onRetake` set sees one button + no fallback. Decide policy: caller-controlled, or always render fallback alongside?
- **F97: P78 removed `result.assets ?? []` defensive guard for lint cleanliness** — trades runtime safety for lint score. Restore with `eslint-disable-next-line` if a future Expo upgrade returns `undefined` instead of empty array.
- **F98: Web `validateClientSide` may receive empty `file.type` for HEIC on older Safari** — `isUploadMimeType('')` returns false → user sees "unsupported mime" for a valid HEIC. Pre-existing issue, exposed more after P81 widening.
- **F99: Filename without extension reaches synthetic-name fallback** — `image-${Date.now()}.jpg` loses the original label; patient can't identify which capture failed.
- **F100: Web `openPicker` `setTimeout(reset, 250)` could race the `change` handler on slow devices** — releases `isPickingRef` before the upload starts. Stale `cancel` listener can also fire on next picker open.
- **F101: Two camera captures in one session sharing the same `asset.uri`** (rare on Android cache reuse) collide in `progressByPath[uri]`. Use synthetic per-pick id.
- **F102: Permission revoked mid-flow surfaces as `GENERIC_UPLOAD_ERROR_MESSAGE_PT_BR`** — no hint to re-grant in Settings. Distinct copy + deep-link to Settings would help.

## Deferred from: code review of story-2-2 (2026-05-22)

- **F90: Verify `expo-image-picker`'s config plugin registers `android.permission.CAMERA` automatically** — without it, `launchCameraAsync` may silently fail on Android. Hand-test required; otherwise add `CAMERA` to `android.permissions` in `app.config.ts`.
- **F95: No rejection surface on Expo Início** — `pickImages` / `pickDocuments` return `rejected` entries on permission denial / launch error / unsupported mime; the Web Início has `lastOutcomes` to display them, but Expo Início only renders ExtractionPulse + EmptyStateRecord. Rejections currently log via `console.warn` (P80). Add a patient-facing surface (toast or inline list) when Story 2.5's status surface lands.
- **F91: Desktop OS file picker may grey out HEIC files** with `accept="image/jpeg,image/png,image/heic"` — broaden to `accept="image/*"` and rely on server validation, OR document via the camera hint.
- **F92: iOS camera capture at `quality: 1` routinely produces HEIC files > 5 MB** — hits `UPLOAD_FILE_TOO_LARGE_PT_BR`. Either lower `quality` (lossy; surprises the patient) or add `expo-image-manipulator` for transparent compression.
- **F93: ExtractionPulse `failed` state visual distinction for low-vision users** — `failed` circle uses `$biomarkerDeviation` (amber) fill with no border; visually similar to `review-needed` border (same token) when animation is off. Add an icon or distinct color token.
- **F94: ExtractionPulse callbacks have no stable-identity guarantee** — state transitions processing → failed mid-render with new callback closures could trigger a stale-handler invocation. Document the callback-identity expectation, or use a `useEvent`-style ref.

## Deferred from: code review of story-2-1 round 2 (2026-05-22)

- **F84: Type-tighten `PickedFile` so `application/pdf` requires `pageCount`** — currently optional at the TS level; the gate ensures it's set in practice, but a future caller could skip the gate and the Zod error message would be confusing. Discriminated-union refactor; do when a third upload caller appears.
- **F85: Web `inicio-empty-state.tsx` has no unmount safety** — navigation away mid-upload triggers React's "setState on unmounted" warning and orphans the in-flight PUT. Joins F74's AbortController work.
- **F86: Verify `role="status"` forwards to the rendered DOM via Tamagui on web AND that RN View ignores it cleanly** — hand-test. If RN logs warnings, gate the `role` prop behind `Platform.OS === 'web'`.
- **F87: `applyDeadLetter` metadata merge uses `JSON.stringify(merged)`** — BigInt or circular structures throw synchronously and the row never transitions to `failed`. Wrap in try/catch and sanitize.
- **F88: `countPdfPages` dynamic `await import('pdf-lib')` — first pick on a cold page incurs ~200–500 ms** — hot pick is fine. Add a spinner state or use static import.
- **F89: `usePulseOpacity` `setInterval` triggers a 1.5 s re-render of the entire ExtractionPulse subtree** — wasted renders. Use CSS keyframes on web / `react-native-reanimated` on RN, or memoize children.

## Deferred from: code review of story-2-1 (2026-05-22)

- **F74: No `AbortController` / per-file timeout on web upload** — `apps/web/src/app/inicio/inicio-empty-state.tsx` — a long-hung storage PUT stalls the whole batch with no cancel UI. Revisit when Story 2.5's status surface adds the real upload status feed.
- **F75: `confirmImport.source` not cross-checked against `requestImport.source`** — `packages/api/src/router/uploads.ts` — a client can mis-attribute funnel by sending different sources at the two calls. Audit-attribution concern, not security. Resolve when the funnel metrics surface lands.
- **F76: Sequential `gatePdfPageCount` on web blocks UI for multi-PDF batches** — `apps/web/src/app/inicio/inicio-empty-state.tsx`, `apps/web/src/app/onboarding/import/import-flow.tsx` — parallelize with `Promise.all` or surface per-file progress.
- **F77: Web `lastOutcomes` aria-live list lingers permanently below the empty-state CTA** — `apps/web/src/app/inicio/inicio-empty-state.tsx` — clear after N seconds or on next CTA tap.
- **F78: `applyPageCountGate` re-fetches file bytes via `fetch(file.uri)`** — `apps/expo/src/hooks/use-import-files.ts` — picker may have cached them; duplicates I/O on large PDFs. Cache the buffer and reuse during PUT.
- **F79: Verify Tamagui `Button disabled` truly blocks `onPress` on web (not just style)** — `packages/ui/src/upload-source-sheet.tsx` — `pdfDisabled` may be visual-only; rapid taps during active upload could spawn duplicate picker invocations.
- **F80: Brief animation flash for `prefers-reduced-motion` users on Web's first paint** — `apps/web/src/app/inicio/inicio-empty-state.tsx` — initial `reducedMotion` defaults to `false` before the effect runs. Minor; would need SSR-aware initial state.
- **F81: `applyDeadLetter` test bundles "already complete" + "already failed" into one "terminal" case** — `packages/api/__tests__/upload-transitions.test.ts` — split into two assertions for clarity.
- **F82: `upload-transitions.test.ts` "merges metadata via the `||` jsonb concatenation seam" test has a dead assertion** — `packages/api/__tests__/upload-transitions.test.ts` — promises a metadata check, only verifies `status: "processing"`. Add a meaningful metadata assertion when the test seam grows (likely Story 2.3).
- **F83 (reaffirms F71): Web `inicio-empty-state.tsx` reimplements the request/confirm flow inline** — instead of reusing a shared web hook mirroring `useImportFiles`. Wait for Story 2.5's status surface to crystallize the shape before extracting.

## Deferred from: code review of story-1-2 round 2 (2026-05-19)

- **F32: Task 8 DRY mandate not satisfied** — `apps/web/src/app/onboarding/consent/consent-flow.tsx`, `apps/expo/src/app/onboarding/consent.tsx` — submit-handler logic duplicated. Shared schemas/copy/routes mitigate ~80% of drift; React state machine still duplicated. Extracting a `useConsentFlow` hook requires adding React as a `packages/validators` peer dep. Revisit when Story 1.4 settings panel makes the case for a third consumer.
- **F33: Web `/auth/callback` latency on hot path** — `apps/web/src/app/auth/callback/route.ts` — every email-verification redirect now does 2 sync DB calls. Acceptable for v1; revisit if login p95 regresses.
- **F34: `consentRequiredProcedure` ignores `version`** — `packages/api/src/middleware/consent.ts` — stale grants satisfy the gate when `CONSENT_TEXT_VERSION` bumps. Tied to F22.
- **F35: `decline` doesn't check for an active grant** — `packages/api/src/router/consent.ts` — patient who granted then declined logs only the decline; grant stays active. **→ Story 1.4**.
- **F36: Partial unique index `WHERE revoked_at IS NULL` drizzle-kit push correctness** — `packages/db/src/schema/consent.ts` — no real-DB integration test proves drizzle emits the WHERE clause in the CREATE UNIQUE INDEX. Verify on first `pnpm db:push` by inspecting the generated DDL.
- **F37: Append-only + partial unique revocation model gap** — `packages/db/src/schema/consent.ts`, `packages/db/policies/custom_rls_consent_grants.sql` — without an UPDATE policy, a revocation insert can't move the original active row out from under the partial unique index. **→ Story 1.4** must reconcile.
- **F38: `consent.list` dedup is application-side** — `packages/api/src/router/consent.ts` — could push to SQL via `DISTINCT ON (consent_type) ... ORDER BY consent_type, granted_at DESC`. Performance optimization.
- **F39: Consent flow resume doesn't skip granted screens** — `apps/web/src/app/onboarding/consent/consent-flow.tsx`, `apps/expo/src/app/onboarding/consent.tsx` — on mount, fetch `consent.list` and `setStepIndex` to first ungranted screen. UX polish.
- **F40: Declining all 3 lands on Início with no valid upload path** — Epic 2 — upload CTA will hit `CONSENT_REQUIRED`. Epic 2 must gate the CTA on the grants set.
- **F41: Anti-phishing scanners consume single-use verification codes** — `apps/web/src/app/auth/callback/route.ts` — Outlook/Gmail Safelinks preview the link, consuming the code before the patient. Out of scope; requires Supabase auth flow tuning.

## Deferred from: code review of story-1-2 (2026-05-19)

- **F19: Repeated decline writes repeated audit events** — `packages/api/src/router/consent.ts` — rapid "Pular por agora" taps each insert a `consent.declined` audit row. FR33 captures every decision by design; UI `disabled={pending}` covers the in-flight case. Add server-side dedup if telemetry shows noise.
- **F20: `consent_grants.revoked_at` has no CHECK constraint** — `packages/db/src/schema/consent.ts` — a `CHECK (revoked_at IS NULL OR revoked_at >= granted_at)` would catch backdated revocations. **→ Story 1.4** introduces revocation and is the right place.
- **F21: RLS `WITH CHECK` does not constrain `revoked_at`** — `packages/db/policies/custom_rls_consent_grants.sql` — a patient could INSERT a row with `revoked_at` pre-set; defenses-in-depth. **→ Story 1.4**.
- **F22: Per-screen `CONSENT_TEXT_VERSION`** — `packages/validators/src/index.ts` — single global version means bumping legal copy for one screen re-prompts unchanged screens. Revisit when copy changes per-screen.
- **F23: Single-tab tabs navigator UX wart** — `apps/expo/src/app/(tabs)/_layout.tsx` — one tab renders an ugly tab bar on iOS. Hide tab bar until additional tabs ship in later epics (Fingerprint / Settings).
- **F24: `SafeAreaView` hex `#F9F7F4` duplicated** — `apps/expo/src/app/(tabs)/_layout.tsx`, `apps/expo/src/app/(tabs)/inicio.tsx`, `apps/expo/src/app/onboarding/consent.tsx` — extract to a shared `SAFE_AREA_BG` constant in `~/lib/colors` or similar. Joins F17.
- **F25: `next` query parameter lost when consent forces redirect** — `apps/web/src/app/auth/callback/route.ts` — preserve via `/onboarding/consent?next=<encoded>` and resume after consent completes.
- **F26: Mobile rapid "Concordo" double-tap race** — `apps/expo/src/app/onboarding/consent.tsx` — `disabled={pending}` covers typical case but the React state flip is async. Add an `isInFlight` ref guard if telemetry shows duplicates.
- **F27: Cold-start deep-link before router mounted** — `apps/expo/src/app/_layout.tsx` — Expo Router v6 generally handles this internally; surface if observed.
- **F28: TRPCError vs network-error distinction** — `apps/{web,expo}/.../consent*` — single generic error message hides the difference; acceptable for v1.
- **F29: `version` field accepts any non-empty string** — `packages/validators/src/index.ts` — no ISO format regex. Values are server-controlled today; add `.regex(/^\d{4}-\d{2}-\d{2}$/)` if external callers appear.
- **F30: No callback-route integration test for the redirect-to-consent branch** — `apps/web/src/app/auth/callback/route.ts`, `apps/expo/src/app/_layout.tsx` — joins F11 (no app-level test infra).
- **F31: `EmptyStateRecord` per-state visual differentiation** — `packages/ui/src/empty-state-record.tsx` — wire when a consumer differentiates `partial` / `filtered-empty` (P15 removed the unused prop in this story).

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

## Deferred from: code review of story-1.3 (2026-05-20)

- **F19** Cold-launch uses `getSession()` without refresh — expired session passes the gate; tRPC will surface the failure on first call. → Acceptable v1.
- **F20** `disableDeviceFallback: false` lets device passcode count as "biometric result" — Clarification-acknowledged. → Revisit if stricter UX requested.
- **F21** Double-tap race on Concordo / Enable buttons — `disabled={pending}` covers typical case; ref-guard if telemetry shows duplicates.
- **F22** `pending` state not in a11y live region on either biometric screen — joins F11 (no app-level a11y test infra).
- **F23** `capability === 'idle'` spinner with `flex={1}` may push skip CTA offscreen on small devices — verify on simulator.
- **F24** No timeout on `Promise.all([getSession, SecureStore.getItem])` in `_layout.tsx` — local APIs are reliable; fail-open is acceptable.
- **F25** `useBiometric().isEnabled` exposed but unused — reserved for the Story 1.4 Settings biometric toggle.
- **F26** `disable()` swallows `deleteItemAsync` errors — logging would help diagnose stuck-on-relaunch reports.
- **F27** Lock screen has no manual escape (cancel forever → stuck); Clarification #3-acknowledged. Add "Sair / Usar senha" when a sign-in screen ships.
- **F28** Onboarding biometric offer screen lacks session-presence guard — only reachable from `/onboarding/consent` (which requires a session). Theoretical gap; joins F11.
- **F29** Cannot distinguish user-initiated `SIGNED_OUT` from token-refresh-induced `SIGNED_OUT`; the `SecureStore.deleteItemAsync(BIOMETRIC_ENABLED_KEY)` in the auth-change listener may wipe the preference during a transient refresh failure. Requires Supabase to surface intent metadata.
- **F30** Double-tap race on Unlock button (lock screen) — same family as F21; add ref-guard if telemetry shows duplicates.
- **F31** Warm-launch deep-link not protected by P3's `/auth/callback` guard — only the cold-launch `getInitialURL()` path is gated. Low real-world likelihood.
- **F32** `BackHandler` on the lock screen returns `true` unconditionally — future modals would not be dismissable via Android back. Revisit when the first overlay ships.
- **F33** `'unavailable'` UX over-rotates: signs the patient out and forces re-registration for a recoverable OS-side biometric state change. Soften when `/login` screen lands.
- **F34** `fallbackToRegistration` runs `disable()` and `signOut()` sequentially with no progress indicator — slow / offline devices freeze the button. Parallelize + show progress.
- **F35** Lock-screen mount effect deps `[router]` — `useRouter()` identity is conventionally stable but not contractual. Use the imported `router` singleton with empty deps.

## Deferred from: code review of story-1.4 (2026-05-20)

- **F36** `consent.list` `surface` flag is client-forgeable in both directions (spam or suppress `consent.read` audits). Best-effort audit tradeoff; revisit if audit ledger becomes a compliance artifact.
- **F37** Web SSR `prefetch` is fire-and-forget — audit emission timing non-deterministic. "At most one audit per visit" because the client refetches on cache miss; the helper convention doesn't support awaiting today.
- **F38** SQL trigger `consent_grants_revoke_only_revoked_at` enumerates allowed columns explicitly; future schema additions silently bypass tampering protection. Add to column-add checklist.
- **F39** Tamagui `Dialog.Close asChild` may not forward `onPress` to the custom `Button` on RN — verify on hand-test.
- **F40** `apps/expo/src/app/privacidade/_layout.tsx` bare `<Stack />` — iOS back-button shows "Back" instead of "Voltar". Minor i18n.
- **F41** Pull-to-refresh on the Expo Meus Consentimentos list emits a fresh `consent.read` audit row — intentional for explicit refresh; the resolver comment should acknowledge.
- **F42** Android hardware back during Tamagui `Dialog` open dismisses the entire screen instead of the dialog. F32-family.
- **F43** Cache invalidation after `consent.revoke` + `router.push` re-triggers the SSR prefetch on web, emitting a second `consent.read` audit. F41-family.
- **F44** Route-param tampering on `?version=...&grantedAt=...` is display-only (mutation derives state from session). Trust model intentionally lax.
- **F45** Stale `version`/`grantedAt` if the row mutates between list render and detail open. Reconcile by re-fetching single grant when telemetry shows complaints.
- **F46** Expo offline `router.replace` could strand on a blank screen for invalid route param. Add a fallback "Voltar" affordance if reported.
- **F47** `String(row.grantedAt)` non-Date non-string fallback yields `"[object Object]"`. Theoretical.

## Deferred from: code review of story-1.5 (2026-05-21)

- **F48** `expo-document-picker` + `expo-image-picker` native rebuild required; add to dev README.
- **F49** Storage-object orphan sweep — `requestImport` can leak objects if the client PUTs but never `confirmImport`s. Epic 5 / 8 ops surface.
- **F50** `sanitizeFilename` misses unicode RTL, fullwidth solidus, Windows reserved names, leading-dot dotfiles, extension-preserving truncation.
- **F51** Web `validateClientSide` empty `file.type` → no extension fallback (HEIC drag-drop fails).
- **F52** `pickImages` dead in onboarding screen — iOS photo-library route only via Files app today.
- **F53** Double-tap re-entry guard on `handleConfirm` (Expo + Web). F21/F30 family.
- **F54** `fetch(uri).blob()` round-trips file bytes through JS memory; consider `expo-file-system.uploadAsync` for low-end Android.
- **F55** `UPLOAD_QUEUED_BADGE_PT_BR` shown for both `queued` and `skipped_duplicate` — patient can't distinguish.
- **F56** Per-patient rate limit on `requestImport` — currently unlimited.
- **F57** Post-onboarding Início CTA opens an onboarding-flavored title ("Trazer seus exames anteriores"). Story 2.5 territory.
- **F58** Returning-patient revisit UX for the import flow — analogous to F45 for `consent_grants` detail.
- **F59** Supabase Storage `list()` eventual-consistency race; add retry on `statLabUploadObject` if telemetry shows flake.
- **F60** `pickImages` is exported by `useImportFiles` but not wired into the onboarding screen.
- **F61** `progressByPath` collides on same-uri picks.
- **F62** Retry of fully-failed batch generates a new `idempotencyKey` per file — defeats FR8 offline-retry contract.
- **F63** First-deploy ordering: API → worker dependency on `pgboss.queue('extraction.document')` row + partition existing.
- **F64** Service-role client cache staleness on `SUPABASE_SERVICE_ROLE_KEY` rotation.
- **F65** Web `validateClientSide` empty `file.type` extension fallback.
- **F66** Distinct badge copy for `skipped_duplicate` vs `queued`.


## Story 2.4 — round-1 review deferrals (F123–F129)

- **F123** RLS adversarial test for `extraction_review_queue` patient policies (Task 2 listed five cases). Requires local Supabase; carries Story 2.3 family.
- **F124** Web `<ReviewCard />` component test — vitest+RTL not wired in `apps/web`. Wire the framework, port AC2/AC3 interaction assertions.
- **F125** Expo `<ReviewCard />` component test — no RN test framework configured. Wire detox/jest-expo for at least snapshot + tap-mutation coverage.
- **F126** Service-role-bypassed exact `hasOperatorOnlyRows` count (see P135 patch). Needs a SECURITY DEFINER view exposing only `(upload_id, exists)`.
- **F127** System-sentinel UUID for audit `actorType: 'system'` events — Story 2.3 F120 carries forward; `notification.upload_complete` still uses the patient id as actor.
- **F128** Snapshot-sync test for the worker's raw-SQL `resolveLoincCode` vs `packages/api/src/loinc.ts` (the Drizzle version) — Story 2.3 R1-P110 pattern.
- **F129** Refetch-on-focus for the web detail screen — `refetchOnWindowFocus` doesn't fire on mobile-web returning from camera/picker. Closed by Story 2.5 realtime.


## Story 2.4 — round-2 review deferrals (F130–F134)

- **F130** Introduce `markReviewQueueResolved` helper for write-path symmetry — `writeReviewQueueEntry` only handles INSERT; the patient-confirm flow does its own raw `database.update`. Sanctioned-write-path discipline would suggest a sibling helper.
- **F131** Expo `⚑` glyph isn't a true Lucide/Tamagui icon — spec says "yellow flag icon"; the unicode glyph renders inconsistently across iOS/Android. Replace with a Tamagui/Lucide `Flag` component.
- **F132** Expo `LowConfidenceField` local interface omits `loincCode`, `collectedAtText`, `confidenceScore` — type erases at the tRPC boundary. Use the inferred tRPC output type instead of a hand-rolled interface.
- **F133** Structured log/metric for the `pending_review` post-confirm branch — already added a `console.warn` (R2-P149); upgrade to a metric so ops dashboards can alert on operator-row orphans.
- **F134** Snapshot-sync test for `resolveLoincCode` API vs worker SQL — Story 2.3 R1-P110 pattern. The Drizzle and raw-postgres implementations can drift silently.


## Story 2.5 — round-1 review deferrals (F135–F142)

- **F135** Expo client hook (`use-push-notifications.ts`) not shipped — Task 6 fully deferred. Permission request, `getExpoPushTokenAsync`, deep-link listener, `SIGNED_OUT` revoke. Without this, AC2/AC3/AC4 are operationally unverifiable; the tRPC mutation is wired and tested. Land in the EAS-build PR.
- **F136** Expo Push receipt polling — Tickets returned inline may say `ok` while the actual push fails at FCM/APNs. Add a polling consumer on `/--/api/v2/push/getReceipts` with a 24h delivery-rate SLO.
- **F137** Multi-device push fan-out > 100 tokens — Currently handled via R1-P157 client-side chunking. Long-term, surface ticket failures + add structured logging per token.
- **F138** Notification preferences (per-event opt-out) — Story 2.8.
- **F139** Adversarial RLS test for `push_tokens` — Joins F123 family.
- **F140** SQL snapshot-sync test for `emitNotificationEvent` vs `enqueueNotificationSend` — Two raw-SQL bodies hand-synced.
- **F141** Lab-name aggregate column on `uploads` — Paired with R1-P156. Eliminates the per-notification SELECT subquery; populated by the dispatcher.
- **F142** Web push notifications — Explicit defer per UX-DR4 mobile-first.


## Story 2.5 — round-2 review deferrals (F143–F147)

- **F143** Per-chunk receipt persistence so Expo Push mid-chunk retry doesn't resend earlier chunks. Pairs with F136 receipt polling.
- **F144** Refactor `writeAuditLog` to natively support `ON CONFLICT DO NOTHING` for notification events instead of the SQLSTATE 23505 catch at the call site.
- **F145** Prometheus counter `notification_send_skipped_total{reason="no_tokens"}` for ops visibility — currently a console.log only.
- **F146** Vocabulary-rename consumer audit — R1-P161 renamed `empty_extraction` → `no_readable_text`. Sweep future analytics consumers + alert filters when they ship.
- **F147** Persisted dismiss state for the Histórico failed-card 'Pular' button — currently in React local state, evaporates on tab remount.


## Story 2.6 — round-1 review deferrals (F148–F151)

- **F148** Web offline queue — spec defers; web localStorage is awkward for binary blobs at the patient-upload sizes.
- **F149** Background drains while app suspended (iOS BGTask / Android WorkManager).
- **F150** Retry backoff + observability telemetry on drain failures (Sentry / Datadog metric on attemptCount).
- **F151** Expo test infra + unit tests for queue module + drain hook.


## Story 2.6 — round-2 review deferrals (F152–F155)

- **F152** Encrypted at-rest persistence for `@healthtracker/offline-upload-queue/<patientId>` (NFR-S5 follow-up; today the queue is unencrypted in AsyncStorage).
- **F153** Telemetry on drain outcomes — attemptCount distribution, drop rate, time-to-drain (Sentry / Datadog metric).
- **F154** Adaptive backoff on `recordAttempt` (currently event-driven via NetInfo / AppState; revisit if field data shows it's needed).
- **F155** Hard cap (vs. soft warn) on `QUEUE_SOFT_CAP = 20` for multi-day offline scenarios.


## Story 2.7 — round-1 review deferrals (F156–F160)

- **F156** Make `observations.upload_id` nullable so manual BIA doesn't need `SENTINEL_UPLOAD_UUID`. Track after R1-P199's structural fix lands.
- **F157** Web Adicionar medição CTA — landed inline anchor via R1-P204; revisit if PM wants a Tamagui Button styling instead.
- **F158** SegmentedControl-style device picker on Expo (current impl is 3 styled Buttons).
- **F159** Concurrency hardening (FOR UPDATE) across all observation-write paths — Story 2.3 `writeObservation` has the same race in theory.
- **F160** Audit `resourceType: 'observation_submission'` so single-event-per-submission is semantically distinct from per-row writes elsewhere.
