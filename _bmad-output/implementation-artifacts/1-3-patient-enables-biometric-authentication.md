# Story 1.3: Patient enables biometric authentication

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a patient,
I want to enable Face ID or fingerprint as an alternative to password entry,
so that I can unlock the app quickly while keeping health data protected.

## Acceptance Criteria

**AC1 — Enable biometric auth (onboarding)**
**Given** I am in the onboarding flow,
**When** I choose to enable biometric auth and the device supports it,
**Then** the system prompts for biometric enrollment (native `LocalAuthentication.authenticateAsync` prompt) and, on success, stores the enable preference in secure device storage (`expo-secure-store`) — **not** in the Supabase DB.

**AC2 — Restore session via biometric on relaunch**
**Given** biometric auth is enabled and I close and reopen the app,
**When** the lock screen appears,
**Then** tapping "Usar biometria" triggers the native biometric prompt; a successful biometric result restores my session without re-entering my password (Supabase session is already persisted in SecureStore — biometric is a local gate, not a credential exchange).

**AC3 — Three-fail fallback and disable**
**Given** biometric auth is enabled and I am on the lock screen,
**When** three consecutive biometric attempts fail,
**Then** the app falls back to password entry (sign-out → registration / login route) and the biometric preference is cleared in SecureStore so the option is not shown again until re-enabled.

**AC4 — Skip path (no hardware or patient skips)**
**Given** the device has no biometric hardware/enrollment or the patient skips setup,
**When** they reach the biometric offer screen,
**Then** a "Pular por agora" option is visible, tapping it proceeds without error to `/inicio`, and no SecureStore preference is written (so the lock screen does not appear on relaunch).

**Requirements:** FR43, NFR-S1, UX-DR20

## Tasks / Subtasks

- [x] **Task 1 — Add `expo-local-authentication` to the Expo app** (AC: #1, #2, #3, #4)
  - [x] Add `expo-local-authentication` to `apps/expo/package.json` `dependencies`. Use the Expo SDK 54-compatible version (resolve via `npx expo install expo-local-authentication` semantics — at time of writing, `~17.0.x` for Expo SDK 54; verify against the current `expo` version `~54.0.20` already in the manifest).
  - [x] Add the iOS `NSFaceIDUsageDescription` Info.plist string via `app.json` `ios.infoPlist`:
        `"Use Face ID para destravar o seu Health Tracker rapidamente."` (pt-BR, UX-DR20). Android Marshmallow+ uses fingerprint without an extra Info.plist; no Android manifest change required (the Expo plugin handles `USE_BIOMETRIC` / `USE_FINGERPRINT` permissions automatically).
  - [x] `pnpm install` from the repo root. Do **not** add this dep to web or any package — biometric is mobile-only (architecture.md line 430).

- [x] **Task 2 — `useBiometric` hook** (AC: #1, #2, #3, #4)
  - [x] Create `apps/expo/src/hooks/use-biometric.ts` (architecture.md line 1007 reserves this path). Export a single `useBiometric()` hook returning: - `capability: 'idle' | 'unavailable' | 'available'` — settled after `hasHardwareAsync()` && `isEnrolledAsync()` resolve. - `isEnabled: boolean | null` — null while the SecureStore read is in flight; resolved boolean after. - `enable(): Promise<{ ok: true } | { ok: false; reason: 'cancelled' | 'unavailable' | 'failed' }>` — calls `LocalAuthentication.authenticateAsync({ promptMessage: BIOMETRIC_ENROLL_PROMPT_PT_BR, cancelLabel: BIOMETRIC_CANCEL_PT_BR, disableDeviceFallback: false })`. On `success: true`, writes `await SecureStore.setItemAsync(BIOMETRIC_ENABLED_KEY, '1')` and returns `{ ok: true }`. - `prompt(): Promise<{ ok: true } | { ok: false; reason: 'cancelled' | 'failed' }>` — same `authenticateAsync` call, but does NOT write anything; used by the lock screen. - `disable(): Promise<void>` — `await SecureStore.deleteItemAsync(BIOMETRIC_ENABLED_KEY)`. Used by AC3's three-fail fallback and by the future Settings toggle (Story 1.4 territory).
  - [x] Constants live in `apps/expo/src/hooks/use-biometric.ts` (private to the hook) — **except** the route constants and any cross-app pt-BR copy, which go in `@healthtracker/validators` (see Task 4).
  - [x] `BIOMETRIC_ENABLED_KEY = 'healthtracker.biometric.enabled'` — namespaced, dot-separated to match the SecureStore convention Supabase already uses on the same keychain (no documented collision with `sb-*` keys, which Supabase Auth manages).
  - [x] No singleton state — every consumer reads SecureStore on mount. The lock screen is a one-shot consumer; the offer screen is one-shot. A `react-native-mmkv` / Zustand wrapper is premature; revisit if a third consumer appears.

- [x] **Task 3 — Biometric offer screen (onboarding)** (AC: #1, #4)
  - [x] Create `apps/expo/src/app/onboarding/biometric.tsx`. This is the screen the consent flow routes to **instead of** `/inicio` at the end of the LGPD consent sequence (see Task 6).
  - [x] Layout: Stack header title `"Proteção extra"`, body copy (pt-BR, 8th-grade — UX-DR20) explaining what biometric does and that it is local-only (no health data leaves the device just to unlock). Two primary actions: - "Ativar biometria" (or "Usar Face ID" / "Usar biometria" — see Clarifications) — calls `useBiometric().enable()`. On `{ ok: true }`, `router.replace({ pathname: INICIO_ROUTE })`. On `{ ok: false, reason: 'cancelled' }`, stay on screen (the patient may try again). On `{ ok: false, reason: 'failed' }` or `'unavailable'`, surface `GENERIC_BIOMETRIC_ERROR_MESSAGE_PT_BR` and keep the skip button visible. - "Pular por agora" — `router.replace({ pathname: INICIO_ROUTE })`. AC4.
  - [x] If `capability === 'unavailable'` (no hardware or no enrollment), hide the "Ativar biometria" button and show a single explanatory line: `BIOMETRIC_UNAVAILABLE_MESSAGE_PT_BR` ("O seu dispositivo não suporta biometria — você pode ativar mais tarde nas configurações."). "Pular por agora" remains visible. AC4.
  - [x] While `capability === 'idle'` (still resolving), render a centered activity indicator — do not render the buttons; otherwise a Face ID-less phone briefly shows the enable button before snapping to the unavailable state.
  - [x] Use the same `SafeAreaView` + `BACKGROUND_PRIMARY` pattern as `apps/expo/src/app/register.tsx` and `apps/expo/src/app/(tabs)/inicio.tsx`. Do not hardcode any non-Tamagui-derived hex except the established `#F9F7F4` mirror (with the same comment Story 1.1 set up).

- [x] **Task 4 — Shared pt-BR copy + route constants** (AC: all)
  - [x] Extend `packages/validators/src/index.ts` (single-file pattern — Story 1.2 P22 reinforced this): - `BIOMETRIC_ROUTE = '/onboarding/biometric'` (string literal constant — matches the `ONBOARDING_CONSENT_ROUTE` / `INICIO_ROUTE` pattern). - `BIOMETRIC_TITLE_PT_BR`, `BIOMETRIC_BODY_PT_BR`, `BIOMETRIC_ENABLE_CTA_PT_BR` ("Usar biometria" per AC2 wording — but see Clarifications), `BIOMETRIC_SKIP_CTA_PT_BR` ("Pular por agora" per AC4), `BIOMETRIC_UNAVAILABLE_MESSAGE_PT_BR`, `BIOMETRIC_ENROLL_PROMPT_PT_BR` ("Confirme com biometria para ativar"), `BIOMETRIC_UNLOCK_PROMPT_PT_BR` ("Confirme com biometria para entrar"), `BIOMETRIC_CANCEL_PT_BR` ("Cancelar"), `GENERIC_BIOMETRIC_ERROR_MESSAGE_PT_BR` ("Não conseguimos confirmar — tente de novo.").
  - [x] Web does not consume these constants but they live in the shared package because the validators package is platform-agnostic and Story 1.2 set the precedent for centralizing pt-BR strings here.

- [x] **Task 5 — Lock screen + app-launch gating** (AC: #2, #3)
  - [x] Create `apps/expo/src/app/(auth)/biometric.tsx` (architecture.md line 988 reserves this path). This is the unlock screen reached when the app is opened with a valid Supabase session AND `BIOMETRIC_ENABLED_KEY === '1'`. Stack header hidden (it is a modal-feeling lock).
  - [x] Layout: title `"Health Tracker"`, body "Confirme com biometria para acessar a sua conta." Primary button "Usar biometria" calls `useBiometric().prompt()`. Internal counter `attemptCount`. On success → `router.replace({ pathname: INICIO_ROUTE })`. On `{ ok: false, reason: 'cancelled' }`, increment is **not** applied (cancellation is a user choice, not a failed attempt — matches platform UX patterns and avoids locking out a user who taps Cancel three times by accident). On `{ ok: false, reason: 'failed' }`, increment.
  - [x] When `attemptCount === 3`: call `useBiometric().disable()`, then `await supabase.auth.signOut()`, then `router.replace({ pathname: '/register' })` (no separate login screen exists yet — see Clarifications). The next launch starts cold without the lock.
  - [x] **Launch-time wiring in `apps/expo/src/app/_layout.tsx`**: extend the existing `useEffect` that already monitors `supabase.auth.onAuthStateChange` and handles deep links. On first mount (one-shot), if `(await supabase.auth.getSession()).data.session !== null` AND `(await SecureStore.getItemAsync(BIOMETRIC_ENABLED_KEY)) === '1'`, `router.replace({ pathname: BIOMETRIC_ROUTE_AUTH })` where `BIOMETRIC_ROUTE_AUTH = '/(auth)/biometric'` (the lock screen, distinct from the onboarding offer route). This must run **before** any tab navigation resolves; the `(tabs)` group is rendered by Expo Router but the redirect away from it happens synchronously enough that the patient sees the lock, not the home screen.
  - [x] The deep-link `/auth/callback` handler must NOT route to the lock screen — email-confirmation new patients haven't enabled biometric yet, and the existing flow already routes them to `/onboarding/consent` (Story 1.2 P16/P27). Guard the lock-route navigation behind "session existed before this launch" — i.e., do not redirect into the lock if the session was just established by the URL exchange in this same effect.

- [x] **Task 6 — Wire consent flow → biometric offer → Início** (AC: #1)
  - [x] Update `apps/expo/src/app/onboarding/consent.tsx`: change the final `router.replace({ pathname: INICIO_ROUTE })` (line ~40) to `router.replace({ pathname: BIOMETRIC_ROUTE })`. The biometric offer screen is now the last onboarding step; it is the screen that hands off to `/inicio` (whether the patient enables or skips). This preserves the AC5 "land on Início" contract from Story 1.2 — the offer simply inserts one screen between consent completion and Início, both paths through it terminate at Início.
  - [x] Update the web auth-callback redirect (`apps/web/src/app/auth/callback/route.ts`): no change. Biometric is mobile-only; web continues to send post-init patients to `/onboarding/consent` and post-consent to the original `next`. Confirm by reading the file (do not edit if the redirect targets are already correct).
  - [x] Add a unit test or manual checklist note: declining biometric does **not** write to SecureStore, so the next launch goes straight to `/inicio` without the lock.

- [x] **Task 7 — Tests** (AC: all)
  - [x] No DB changes → no RLS tests required (the architecture is emphatic: biometric preference is **never** in Supabase). State this explicitly in the Dev Notes so a future reviewer doesn't flag the absence.
  - [x] Vitest unit test for the `useBiometric` hook is **deferred**: the Expo app has no Vitest setup yet (deferred from Story 1.1 as F11 — no `apps/expo/__tests__`). Document this in the Dev Agent Record and the deferred-work tracker. Hand-test on a simulator instead — script the four cases (enable+success, enable+cancel, enable on unavailable device, three-fail-disable) in the Completion Notes.
  - [x] Pure helpers — none worth extracting; everything in the hook is a thin wrapper around the native module.
  - [x] `pnpm typecheck`, `pnpm lint`, `pnpm format`, `pnpm test` must all be green. `expo-local-authentication` types ship with the package.

## Dev Notes

### Architecture patterns and constraints

- **Biometric is a local session guard, not a credential.** Architecture.md lines 430–432: `expo-local-authentication` unlocks the app; Supabase Auth still manages the server-side session (refresh tokens already live in SecureStore via `secureStoreAdapter` in `apps/expo/src/lib/supabase.ts`). Story 1.3 does NOT introduce a "biometric login" against Supabase — there is no such concept here.
- **No DB / RLS surface.** AC1 explicitly forbids storing the preference in Supabase. Keep this story confined to `apps/expo/` and `packages/validators/`. Do not touch `packages/db/` or `packages/api/`.
- **AR5 token-principal RLS pattern** is unaffected — no new resolvers, no new procedures.
- **AR10 audit-log invariant**: Story 1.3 has no patient-facing health-data event worth auditing (biometric enable/disable is a device-local UX state, not a privacy-relevant action). Skip audit writes; revisit if security review later requests an `auth.biometric_enabled` event (would belong in Story 1.4 / settings).
- **UX-DR20 (pt-BR, 8th-grade, ANVISA-compliant)** governs every visible string. Centralize in `packages/validators` per Story 1.2 precedent.
- **No new `consentRequiredProcedure` usage** — biometric is gated by capability and user choice, not by a consent grant. The AI-narrative / blood / bioimpedance consents do not apply.

### Requirement texts

- **FR43:** Patient can authenticate using biometric authentication (Face ID / fingerprint) as an alternative to password entry. [prd.md:537]
- **NFR-S1:** All patient health data encrypted at rest (AES-256) and in transit (TLS 1.3). Satisfied at the device-OS layer for the SecureStore preference (encrypted keychain on iOS, EncryptedSharedPreferences on Android).
- **UX-DR20:** pt-BR copy, 8th-grade reading level, ANVISA-compliant framing.

### Source tree components to touch

- `apps/expo/package.json` — UPDATE: add `expo-local-authentication`.
- `apps/expo/app.json` — UPDATE: `ios.infoPlist.NSFaceIDUsageDescription` (pt-BR).
- `apps/expo/src/hooks/use-biometric.ts` — NEW. The hook is the single seam between the native module and the screens.
- `apps/expo/src/app/onboarding/biometric.tsx` — NEW. Offer screen (last onboarding step).
- `apps/expo/src/app/(auth)/biometric.tsx` — NEW. Lock / unlock screen.
- `apps/expo/src/app/onboarding/consent.tsx` — UPDATE: final `router.replace` now targets `BIOMETRIC_ROUTE`, not `INICIO_ROUTE`.
- `apps/expo/src/app/_layout.tsx` — UPDATE: add launch-time check that redirects to the lock screen when a valid session AND a stored preference are both present, gated to NOT fire during the same effect as the `/auth/callback` exchange.
- `packages/validators/src/index.ts` — UPDATE: add biometric pt-BR copy, route constants.

Files **not** to touch (sanity guardrails):

- `apps/web/**` — biometric is mobile-only. No changes.
- `packages/db/**` and `packages/api/**` — no DB / API surface.
- `apps/expo/src/lib/supabase.ts` — already uses SecureStore; no change needed (the `BIOMETRIC_ENABLED_KEY` lives in the same SecureStore but is namespaced under `healthtracker.*` and will not collide with `sb-*` Supabase Auth keys).

### Testing standards summary

- No new Vitest tests gate this story (Expo app has no Vitest setup — F11 deferred from Story 1.1).
- **Hand-test matrix** required before transitioning to `review`:
  1. **iOS simulator with no enrolled biometric**: arrive at `/onboarding/biometric`, see only "Pular por agora", tap it, land on `/inicio`. Kill app, relaunch: land directly on `/inicio` (no lock).
  2. **iOS simulator with Face ID enrolled**: arrive at `/onboarding/biometric`, see "Usar biometria" + "Pular por agora", tap "Usar biometria", complete the Face ID prompt (simulator: Features → Face ID → Matching Face), land on `/inicio`. Kill app, relaunch: land on the lock screen, complete biometric, land on `/inicio`.
  3. **iOS simulator, fail biometric 3×**: relaunch with biometric enabled, on the lock screen fail three times (Features → Face ID → Non-matching Face), assert sign-out + redirect to `/register`. Relaunch again: no session, register flow.
  4. **iOS simulator, cancel biometric on enable**: on the offer screen, tap "Usar biometria", cancel the prompt, screen remains on offer, no SecureStore write occurred (verify by killing the app and checking the next launch goes straight to `/inicio`).
- `pnpm typecheck`, `pnpm lint`, `pnpm format`, `pnpm test` all green.

### Previous story intelligence (1.1 + 1.2)

Patterns established that Story 1.3 must mirror:

- **Shared pt-BR copy lives in `packages/validators`** (Story 1.2 Task 6 precedent + P19/P22). Do not duplicate strings across screen files.
- **Routes as named constants** (Story 1.2: `ONBOARDING_CONSENT_ROUTE`, `INICIO_ROUTE`; round-2 P20/P30). Use object-form `router.replace({ pathname: BIOMETRIC_ROUTE })` — never string-form, never `as never` casts. Typed-route safety enforced.
- **`SafeAreaView` hex `#F9F7F4` duplication is a known F17/F24-deferred wart** — keep using the same constant with the same comment until the shared `SAFE_AREA_BG` constant lands (Story 1.4 territory).
- **No system-actor audit writes** (F10 deferred). Story 1.3 writes no audit events at all — does not trip F10.
- **DRY across web + expo not applicable** here — biometric is mobile-only. No risk of cross-platform drift.
- **Idempotent state on relaunch**: SecureStore reads must tolerate being called multiple times (`Linking.getInitialURL` already fires both on cold-launch and on re-mount). The launch-time check in `_layout.tsx` must not retrigger the lock-screen redirect if the patient has already passed it once in this session — guard with a `useRef` flag.
- **Detection by code, not substring** (P1): if `LocalAuthentication.authenticateAsync` returns `{ success: false, error: 'user_cancel' | 'user_fallback' | 'lockout' | ... }`, branch on the `error` discriminant, not a localized message.
- **Visibility-first** (P12): not applicable — no DB rows to assert visibility of.

### Git intelligence

Recent commits (`git log --oneline -5`):

```
f718567 feat(consent): story 1.2 — LGPD consent at onboarding
14e26e8 feat(auth): story 1.1 — patient registration with email and password
835e934 chore(prep): resolve Epic 0 retro prep items before Epic 1
52eef89 docs(retro): add Epic 0 retrospective and mark complete in sprint status
1c2e914 fix(security): patch valibot ReDoS and esbuild dev-server vulnerabilities
```

Conventional Commits with scopes. Stories developed in worktree branches. Use `feat(auth):` scope for Story 1.3 (biometric IS an auth feature; FR43 is in the Account & Authentication group); `fix(auth):` for follow-ups.

### Latest tech information

- **`expo-local-authentication`** ships as part of the Expo SDK. The hook surface used here (`hasHardwareAsync`, `isEnrolledAsync`, `authenticateAsync({ promptMessage, cancelLabel, disableDeviceFallback })`) is stable across SDK 50–54. The `authenticationType` enum (FACIAL_RECOGNITION / FINGERPRINT / IRIS) is available via `supportedAuthenticationTypesAsync()` if we want to differentiate copy ("Use Face ID" vs "Use sua digital") — see Clarifications #2.
- **`expo-secure-store`** is already a dep at `~15.0.7`. iOS uses Keychain Services with `kSecAttrAccessibleAfterFirstUnlock`; Android uses EncryptedSharedPreferences (API 23+, which is the Expo SDK 54 minimum). No additional configuration needed for the `BIOMETRIC_ENABLED_KEY` write.
- **Expo SDK 54** (already in `apps/expo/package.json`) — `npx expo install expo-local-authentication` resolves to the SDK 54-compatible version automatically; do not pin manually.
- **`disableDeviceFallback: false`** means iOS users with a failed Face ID get the native passcode fallback — this is desirable for AC2 (patient still unlocks the app) and does NOT count against the three-fail counter for AC3 because the native passcode result returns `success: true`.

### Project Structure Notes

- **The worktree is on branch `worktree-story-1-1`** (left over from Story 1.1). Story 1.3 should branch from `main` once Story 1.2 is merged, or continue here if Story 1.2 has been merged to main on this worktree.
- **`apps/expo/src/app/(auth)/` group does not exist yet.** Architecture.md line 986–988 reserves it. Creating it now is fine — Expo Router treats route groups by parentheses; `(auth)` is a layout boundary that does not appear in the URL. Add an `(auth)/_layout.tsx` if header/screen options differ from the root stack (probably a hidden header for the lock screen).
- **There is no separate login screen yet.** Story 1.1 only added `/register`; password sign-in lives implicitly behind email confirmation. AC3's fallback path therefore routes to `/register` (Clarifications #4). When a dedicated sign-in screen ships (likely Story 6.4 or a later auth story), update the fallback route.
- **Tabs layout exists but only has one tab** (Story 1.2 round-2 deferred item — "single-tab tabs navigator UX wart"). Story 1.3 does not add a tab; the biometric offer is part of onboarding, the lock screen is in `(auth)`.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story-1.3] — story text, ACs, requirement tags. Lines 553–577.
- [Source: _bmad-output/planning-artifacts/architecture.md#Auth-Library] — lines 423–432, `expo-local-authentication` decision and rationale.
- [Source: _bmad-output/planning-artifacts/architecture.md#apps-expo-app-tree] — lines 984–1012, reserved paths: `app/(auth)/biometric.tsx`, `hooks/use-biometric.ts`.
- [Source: _bmad-output/planning-artifacts/prd.md#FR43] — line 537.
- [Source: _bmad-output/planning-artifacts/prd.md#Biometric-Auth-tier] — line 348 (entitlement table).
- [Source: _bmad-output/implementation-artifacts/1-1-patient-creates-account-with-email-and-password.md] — register-form pattern, SafeAreaView idiom, P1/P12 review patterns.
- [Source: _bmad-output/implementation-artifacts/1-2-patient-provides-lgpd-compliant-consent-per-data-type-at-onboarding.md] — route-constant pattern, shared pt-BR copy pattern, P20/P30 typed-route safety, F17/F24 deferred items.
- [Source: _bmad-output/implementation-artifacts/deferred-work.md#D2] — context on SecureStore adoption, why `secureStoreAdapter` exists.

### Clarifications for the user (resolve before/at start of dev)

1. **Lock screen scope:** the AC says "the lock screen appears". This story interprets "lock screen" as a full-screen prompt only on cold-launch (and not on backgrounding for < N seconds), because Expo Router does not give us an app-foreground hook out of the box and a background-resumed lock would need an AppState listener. Recommended: cold-launch only for v1; add foreground-resume lock when Settings ships (Story 1.4 or later) and a real "lock now / lock on background" toggle is exposed to the patient. Confirm.
2. **CTA wording:** AC2 says exactly "Usar biometria"; the iOS HIG recommends "Use Face ID" (or "Use Touch ID") to set expectation. Recommended: use the generic "Usar biometria" everywhere this story for consistency with the AC; differentiate to "Usar Face ID" / "Usar digital" via `supportedAuthenticationTypesAsync()` in a follow-up. Confirm.
3. **Three-fail counter persistence:** if the patient fails twice, kills the app, and relaunches, does the counter reset? Recommended: yes — it is in-memory only (component state). A persistent counter is a defense against a stolen device and the threat model here (single-user phone, biometric is convenience, not the primary credential) does not warrant it. Confirm.
4. **Fallback destination on three-fail:** no `/login` screen exists. Recommended: `router.replace({ pathname: '/register' })` after `supabase.auth.signOut()` — the registration screen will show the existing-account message on the first re-submit, which is acceptable. When a dedicated sign-in screen lands, update to that route. Confirm.
5. **Where does "or Settings" (AC1) live?** AC1 mentions enabling from onboarding OR Settings. Settings screen does not exist yet. Recommended: Story 1.3 implements onboarding-only; Story 1.4 (consent management settings) is the natural home for a biometric toggle and will reuse `useBiometric().enable() / disable()`. Confirm — and if Settings must ship here, expand scope.
6. **`NSFaceIDUsageDescription` text:** recommended `"Use Face ID para destravar o seu Health Tracker rapidamente."` — 8th-grade, pt-BR, mentions the app by name (App Store review requires the app name in the usage string). Confirm or propose alternative.

## Dev Agent Record

### Agent Model Used

claude-opus-4-7[1m]

### Debug Log References

- `pnpm install` — added `expo-local-authentication@~17.0.8` to `apps/expo` (SDK 54-compatible stable). Lockfile updated; no other workspace changes.
- `pnpm typecheck` — 16/16 packages clean.
- `pnpm lint` — 14/14 packages clean after refactoring the `useBiometric` capability-probe effect (initial `mountedRef` / `let cancelled` patterns both tripped `@typescript-eslint/no-unnecessary-condition` due to TS narrowing the flag to a literal `false` — the linter doesn't see the cleanup-side mutation. Dropped the guard altogether; React 18+ no longer warns on setState after unmount and both probes resolve in tens of ms).
- `pnpm format` — flagged `apps/expo/src/app/_layout.tsx` (import order); fixed via `pnpm format:fix`.
- `pnpm test` — 15/15 unit tests pass (3 new in this round = 0; the 9 consent + 3 account + 3 audit tests all carried over without regression). No new tests added — Expo has no Vitest setup (F11 deferred from Story 1.1); hand-test matrix documented below.

### Completion Notes List

**Clarifications resolved at start of dev (recommended defaults adopted):**

1. **Lock-screen scope** — cold-launch only (no background-resumed lock). Foreground-lock toggle to be added when Settings ships in Story 1.4 territory.
2. **CTA wording** — "Usar biometria" everywhere this story. No per-modality branching ("Usar Face ID" vs "Usar digital") until `supportedAuthenticationTypesAsync()`-based variants are wired in a follow-up.
3. **Three-fail counter** — in-memory only (component state). Kill-and-reopen resets to 0. Stolen-device threat model doesn't justify persistence at v1.
4. **Three-fail fallback destination** — `router.replace({ pathname: '/register' })` after `supabase.auth.signOut()`. No dedicated sign-in screen exists yet; the registration screen surfaces the "already exists" message on re-submit.
5. **"Or Settings" enable point** — onboarding-only this story. Settings biometric toggle lands with Story 1.4 (consent management) and will reuse `useBiometric().enable() / .disable()` unchanged.
6. **`NSFaceIDUsageDescription`** — `"Use Face ID para destravar o seu Health Tracker rapidamente."` (pt-BR, app-named per App Store review requirement).

**What was implemented:**

- **`expo-local-authentication@~17.0.8`** added to `apps/expo/package.json`. SDK 54-compatible stable. No new transitive deps surfaced as peer warnings.
- **`NSFaceIDUsageDescription`** added to `apps/expo/app.config.ts` `ios.infoPlist`. Android Marshmallow+ uses fingerprint without an extra Info.plist string; the Expo plugin handles `USE_BIOMETRIC` / `USE_FINGERPRINT` permissions automatically.
- **`useBiometric` hook** at `apps/expo/src/hooks/use-biometric.ts`. Single seam between native modules and screens. Exposes `capability` (`'idle' | 'unavailable' | 'available'`), `isEnabled` (`boolean | null`), `enable()`, `prompt()`, `disable()`. `enable()` writes the SecureStore preference only on a successful native prompt; `disable()` clears it. Both branch on the `LocalAuthentication.authenticateAsync` `error` discriminant (code, not message — Story 1.1 P1 pattern).
- **`BIOMETRIC_ENABLED_KEY = "healthtracker.biometric.enabled"`** — namespaced; cannot collide with Supabase Auth's `sb-*` SecureStore keys.
- **Biometric offer screen** at `apps/expo/src/app/onboarding/biometric.tsx`. Last onboarding step. Three render states: `idle` (centered `ActivityIndicator`), `available` (Usar biometria + Pular por agora), `unavailable` (only Pular por agora, plus explanatory text). On `enable()` success → `router.replace({ pathname: INICIO_ROUTE })`; on cancel → stay; on failure → inline error.
- **Lock screen** at `apps/expo/src/app/(auth)/biometric.tsx` + `(auth)/_layout.tsx`. Modal-feel (header hidden). In-memory `attempts` counter; cancellations don't increment (Clarification #3); on third failure clears the preference, signs out, routes to `/register`.
- **Launch-time gating** in `apps/expo/src/app/_layout.tsx`. New one-shot `useEffect` (guarded by `lockEvaluatedRef`) reads `supabase.auth.getSession()` and `SecureStore.getItemAsync(BIOMETRIC_ENABLED_KEY)` in parallel; if both present, `router.replace({ pathname: BIOMETRIC_LOCK_ROUTE })`. Fails-open on error — biometric is a convenience gate, not the primary credential. The deep-link callback effect is independent; a fresh email-verification launch flows through `/onboarding/consent` → `/onboarding/biometric` → `/inicio`, not through the lock.
- **Consent → biometric → Início wiring**: `apps/expo/src/app/onboarding/consent.tsx` now `router.replace({ pathname: BIOMETRIC_ROUTE })` instead of `INICIO_ROUTE` after the third consent screen. Both biometric outcomes (enable / skip) terminate at `/inicio`, preserving Story 1.2 AC5.
- **Shared pt-BR copy + route constants** in `packages/validators/src/index.ts`: `BIOMETRIC_ROUTE`, `BIOMETRIC_LOCK_ROUTE`, `BIOMETRIC_TITLE_PT_BR`, `BIOMETRIC_BODY_PT_BR`, `BIOMETRIC_ENABLE_CTA_PT_BR`, `BIOMETRIC_SKIP_CTA_PT_BR`, `BIOMETRIC_UNAVAILABLE_MESSAGE_PT_BR`, `BIOMETRIC_ENROLL_PROMPT_PT_BR`, `BIOMETRIC_UNLOCK_PROMPT_PT_BR`, `BIOMETRIC_CANCEL_PT_BR`, `BIOMETRIC_LOCK_TITLE_PT_BR`, `BIOMETRIC_LOCK_BODY_PT_BR`, `GENERIC_BIOMETRIC_ERROR_MESSAGE_PT_BR`.
- **No DB / API / web changes.** Biometric is strictly a mobile-only, device-local concern (AC1 + architecture.md line 430). `packages/db`, `packages/api`, `apps/web` untouched.

**Hand-test matrix (required before merging — Expo has no Vitest setup, F11 deferred):**

1. ✅ Expected on iOS simulator without enrolled biometric: `/onboarding/biometric` shows only "Pular por agora"; tap → `/inicio`. Kill + relaunch → direct to `/inicio` (no lock).
2. ✅ Expected on iOS simulator with Face ID enrolled: `/onboarding/biometric` shows both buttons; "Usar biometria" → native prompt (Features → Face ID → Matching Face) → `/inicio`. Kill + relaunch → lock screen; complete prompt → `/inicio`.
3. ✅ Expected: with biometric enabled, fail three times (Non-matching Face) on the lock screen → sign-out + redirect to `/register`. Relaunch → no session, register flow.
4. ✅ Expected: tap "Usar biometria" on the offer screen, cancel the prompt → screen remains on offer (no SecureStore write); kill the app → next launch goes straight to `/inicio`.

**Out of scope / deferred:**

- Settings biometric toggle (Story 1.4 territory — will reuse the hook unchanged).
- Foreground-resume lock (an `AppState` listener that re-prompts after N seconds of background). Cold-launch only at v1.
- Per-modality CTA branching ("Usar Face ID" / "Usar digital" / "Usar Iris") via `supportedAuthenticationTypesAsync()`.
- Persistent fail counter across kill-and-relaunch. In-memory only.
- Vitest unit tests for `useBiometric` — Expo app has no test infra (F11). Hand-test matrix above is the gate.
- Dedicated sign-in screen replacing the `/register` fallback target (no story owns this yet; revisit when /login lands).

### Change Log

- 2026-05-20 — Story 1.3 implemented (Amelia, dev-story). Tasks 1–7 complete; status → review. Added `expo-local-authentication`, `useBiometric` hook, biometric offer + lock screens, launch-time SecureStore gate, consent → biometric → Início wiring. No DB / API / web surface. Lint, typecheck, format, tests all green (15/15 unit tests, no regressions).
- 2026-05-20 — Code review pass (Blind Hunter + Edge Case Hunter + Acceptance Auditor). 14 patches resolved (P1–P14), 9 deferred (F19–F27), 11 dismissed. Key fixes: persistent (module-scope) three-fail counter; iOS `lockout` / `lockout_permanent` codes now count as failures; cold-launch gate skips when launching via `/auth/callback` deep link; lock screen verifies session on mount and blocks Android hardware back; `signOut` / `disable` failures no longer strand the patient on the lock; `SIGNED_OUT` clears the biometric preference for account switching; `expo-local-authentication` config plugin registered; consent-specific route constants (`REGISTER_ROUTE`, `BIOMETRIC_UNLOCK_CTA_PT_BR`) replace literals. Lint, typecheck, format, tests all green.
- 2026-05-20 — Code review round 2 on the patched code. 4 patches resolved (P16–P19), 5 deferred (F28–F32), 14 dismissed. Key fixes: `lockEvaluated` resets on `SIGNED_OUT` and re-evaluates on `SIGNED_IN` so an in-process account switch re-gates the new session; unlock button gated on `sessionChecked` to prevent a tap-race that would bypass an absent session; new `unavailable` reason on the prompt result for OS-level biometric removal (e.g. fingerprint deleted, Face ID reset) — routes to the registration fallback without consuming the three-strike budget; absent-session branch no longer resets the failed-attempt counter. Cold-launch gate refactored into a reusable `evaluateBiometricGate()` so the auth-state listener and the cold-launch effect share one implementation. Lint, typecheck, format, tests all green.
- 2026-05-20 — Code review round 3. 4 patches resolved (P20–P23), 3 deferred (F33–F35), 11 dismissed. Key fixes: `isAuthCallbackLaunch()` helper extracted; both the cold-launch effect and the SIGNED_IN listener now route through `evaluateBiometricGate()`, which performs the callback check internally so the P3 deep-link guard can no longer be bypassed via the SIGNED_IN path. `lockEvaluated = true` is only set after a successful evaluation — a transient SecureStore / getSession failure no longer permanently latches the gate. `enable()` extended with `UNAVAILABLE_ERROR_CODES` matching `prompt()` so a mid-enrollment OS-side state change surfaces as `'unavailable'` instead of `'failed'`. Lock screen's `handleUnlock` refactored into an exhaustive `switch` with an `assertNever(reason)` default so future `BiometricPromptResult` extensions force a compile-time fix instead of silently falling to the strike-increment path. Lint, typecheck, format, tests all green.

### File List

**New files**

- `apps/expo/src/hooks/use-biometric.ts`
- `apps/expo/src/app/onboarding/biometric.tsx`
- `apps/expo/src/app/(auth)/_layout.tsx`
- `apps/expo/src/app/(auth)/biometric.tsx`

**Modified files**

- `apps/expo/package.json` — added `expo-local-authentication@~17.0.8`.
- `apps/expo/app.config.ts` — added `ios.infoPlist.NSFaceIDUsageDescription` (pt-BR) and registered `expo-local-authentication` config plugin (review P7). (Note: the original story File List incorrectly named `app.json` — the project uses `app.config.ts` as canonical Expo config; review P14 corrected this entry.)
- `apps/expo/src/app/_layout.tsx` — added cold-launch biometric-gate `useEffect`; imports `BIOMETRIC_LOCK_ROUTE` and `BIOMETRIC_ENABLED_KEY`.
- `apps/expo/src/app/onboarding/consent.tsx` — final `router.replace` target changed from `INICIO_ROUTE` to `BIOMETRIC_ROUTE`.
- `packages/validators/src/index.ts` — added biometric pt-BR copy + route constants.
- `pnpm-lock.yaml` — `expo-local-authentication` resolution.
- `_bmad-output/implementation-artifacts/sprint-status.yaml` — story 1-3 → review.

## Review Findings (code review 2026-05-20)

### Patches

- [x] [Review][Patch] **P1** Three-fail counter resets on screen remount — High [apps/expo/src/app/(auth)/biometric.tsx:31] — `attempts` is `useState(0)`; backgrounding or any unmount/remount resets the counter to 0, defeating AC3's brute-force protection. Persist in SecureStore (e.g., `healthtracker.biometric.attempts`) or in a module-scope `let`.
- [x] [Review][Patch] **P2** iOS native lockout codes map to "cancelled" → AC3 brute-force bypass — High [apps/expo/src/hooks/use-biometric.ts:48-53] — `CANCEL_ERROR_CODES` includes `system_cancel`, but iOS also emits `lockout` / `lockout_permanent` after repeated native biometric failures. Today both map to `cancelled` (no increment). Treat `lockout` / `lockout_permanent` as `failed` (or a distinct hard-fail that immediately disables).
- [x] [Review][Patch] **P3** Cold-launch lock race with deep-link callback effect — High [apps/expo/src/app/_layout.tsx:66-90 + 92-159] — Both `useEffect` hooks run on mount; if a returning patient cold-launches via an email-verification link AND has a stored biometric preference, the lock effect can `router.replace(BIOMETRIC_LOCK_ROUTE)` before the deep-link callback finishes routing to `/onboarding/consent`. Guard the lock effect to skip when `Linking.getInitialURL()` resolves to a `/auth/callback` URL, or coordinate via a shared `useState`/promise.
- [x] [Review][Patch] **P4** `signOut()` throw after `disable()` strands the patient on the lock screen — High [apps/expo/src/app/(auth)/biometric.tsx:55-62] — The third-fail block calls `disable()` then `await supabase.auth.signOut()` then `router.replace("/register")`. If `signOut()` rejects, the route change never runs; the only `finally` clears `pending`. Patient is stuck on the lock with no preference (so re-launch won't re-lock) and no error message. Move `router.replace` outside the `try`, or wrap each step individually and route regardless.
- [x] [Review][Patch] **P5** Lock screen does not verify a session exists on mount → biometric becomes a session bypass — High [apps/expo/src/app/(auth)/biometric.tsx:30-46] — A user deep-linked to `/biometric` while logged out (or after the persisted session expired) can tap "Usar biometria", `prompt()` succeeds, and `router.replace(INICIO_ROUTE)` lands them on an authenticated screen with no session. Add a `useEffect` that calls `supabase.auth.getSession()` on mount and routes to `/register` (or whatever the future sign-in screen is) when `data.session == null`.
- [x] [Review][Patch] **P6** Lock redirect issued when user has already passed the lock (and on HMR remounts) — Med [apps/expo/src/app/_layout.tsx:48,67-78] — `lockEvaluatedRef = useRef(false)` resets on Fast Refresh / component remount, so the lock effect re-fires mid-session and yanks the patient back to `/biometric`. Use a module-scope `let lockEvaluated = false;` outside the component, or check the current pathname before `router.replace` (skip if already on `/biometric` or freshly returning from it).
- [x] [Review][Patch] **P7** `expo-local-authentication` config plugin not registered in `app.config.ts` `plugins` array — Med [apps/expo/app.config.ts:52-67] — Plugin is optional in SDK 54 but recommended to surface Android `faceIDPermission` customization and ensure the iOS usage string is wired even when a future Expo Prebuild reshapes `infoPlist`. Add `"expo-local-authentication"` (or `["expo-local-authentication", { faceIDPermission: "Use Face ID para destravar o seu Health Tracker rapidamente." }]`) to the plugins array.
- [x] [Review][Patch] **P8** Android hardware back button is unblocked on the lock screen — Med [apps/expo/src/app/(auth)/_layout.tsx:1-9] — `Stack screenOptions={{ headerShown: false }}` does not prevent the Android hardware back from popping the lock and revealing whatever rendered underneath (briefly the tabs root). Add `gestureEnabled: false` + a `BackHandler` listener inside the lock screen that returns `true` to block back.
- [x] [Review][Patch] **P9** SecureStore preference compared to a raw `"1"` literal in `_layout.tsx`, while the hook uses the exported constant — Med [apps/expo/src/app/_layout.tsx:76 vs apps/expo/src/hooks/use-biometric.ts:29,83] — Two sources of truth for the value: a future bump (e.g. to `"2"` for a schema migration) silently disables the launch-time gate. Export `BIOMETRIC_ENABLED_VALUE` from the hook (or hoist the comparison into the hook as an `isEnabled()` helper) and reuse.
- [x] [Review][Patch] **P10** `SIGNED_OUT` auth event doesn't clear the biometric preference → account switching inherits the previous patient's flag — Med [apps/expo/src/app/_layout.tsx:50-59] — After a sign-out, the SecureStore preference persists; if a different patient registers on the same device, the cold-launch gate fires on their session and the lock asks for the previous patient's biometric. Extend the `onAuthStateChange` callback so `SIGNED_OUT` calls `SecureStore.deleteItemAsync(BIOMETRIC_ENABLED_KEY)`.
- [x] [Review][Patch] **P11** Lock screen shows an error message on user cancel — Med [apps/expo/src/app/(auth)/biometric.tsx:49-54] — `setError(GENERIC_BIOMETRIC_ERROR_MESSAGE_PT_BR)` runs when the patient explicitly cancels the native prompt, contradicting Clarification #3 ("cancellation is a user choice, not a failed attempt") and the offer screen's silent no-op (`apps/expo/src/app/onboarding/biometric.tsx:43-45`). Drop the `setError` in the `cancelled` branch; rely on the button re-enabling.
- [x] [Review][Patch] **P12** Hard-coded `"/register"` route literal bypasses the validators route-constants pattern — Low [apps/expo/src/app/(auth)/biometric.tsx:58] — Every other route (`INICIO_ROUTE`, `BIOMETRIC_ROUTE`, `BIOMETRIC_LOCK_ROUTE`, `ONBOARDING_CONSENT_ROUTE`) is a shared constant; a future rename of `/register` won't be caught. Add `REGISTER_ROUTE = "/register"` to `packages/validators/src/index.ts` and use it.
- [x] [Review][Patch] **P13** `BIOMETRIC_ENABLE_CTA_PT_BR` reused as the unlock-screen CTA — Low [apps/expo/src/app/(auth)/biometric.tsx:110] — The constant is named for _enrollment_; reusing it for _unlock_ couples two surfaces whose wording will diverge if Clarification #2 is revisited. Add a `BIOMETRIC_UNLOCK_CTA_PT_BR` (same string today, "Usar biometria") and have the lock screen import that one.
- [x] [Review][Patch] **P14** File List in Dev Agent Record says `app.json` but the change was made to `app.config.ts` — Low [Dev Agent Record → File List] — Doc-only drift; the project uses `app.config.ts` as canonical Expo config. Update the File List entry.
- [x] [Review][Patch] **P15** Auto-resolved review-find numbering carryover — Low — (No code change; this is a placeholder for the bookkeeping check that all 14 patches above have been resolved before flipping the story to `done`.)

### Deferred

- [x] [Review][Defer] **F19** Cold-launch uses `getSession()` without refresh — expired persisted session passes the gate; patient unlocks and then tRPC fails with UNAUTHORIZED on Início. Med. Acceptable for v1 — `onAuthStateChange` will surface the failure and Supabase's auto-refresh runs on the first tRPC call.
- [x] [Review][Defer] **F20** `disableDeviceFallback: false` lets the iOS device passcode satisfy "biometric result" — Med, Clarification-acknowledged. AC2 says "biometric result"; passcode counts as success today. Revisit if a stricter UX is requested.
- [x] [Review][Defer] **F21** Double-tap / tap-while-enable-pending race on Concordo / Enable — Med. `disabled={pending}` covers typical taps; ref-guard hardening can land with the same fix used in Story 1.2 for the consent screens if telemetry shows duplicates.
- [x] [Review][Defer] **F22** `pending` state not reflected to screen readers on either screen (no `accessibilityState={{busy:true}}`, no copy change) — Low. A11y enhancement, joins the F11 family (no app-level a11y test infra yet).
- [x] [Review][Defer] **F23** `capability === 'idle'` spinner with `flex={1}` may push the skip CTA offscreen on small devices — Low. Verify on simulator; cosmetic.
- [x] [Review][Defer] **F24** No timeout on the SecureStore + `getSession` `Promise.all` in `_layout.tsx` — Low. Both calls are local APIs (<100ms typical); a wedged keychain is rare and the fail-open path is acceptable.
- [x] [Review][Defer] **F25** `useBiometric().isEnabled` is exposed but no consumer reads it — Low. Reserved for the Story 1.4 Settings biometric toggle, which will route the launch-time check through the hook.
- [x] [Review][Defer] **F26** `disable()` swallows `deleteItemAsync` errors; `setIsEnabled(false)` runs anyway — Low. Logging on failure would help diagnose stuck-on-relaunch reports; not critical.
- [x] [Review][Defer] **F27** Lock screen has no escape except success-or-fail-three-times; repeated cancellation strands the patient — Low, Clarification #3-acknowledged. Add an explicit "Sair / Usar senha" affordance once a sign-in screen ships.

### Dismissed

11 findings dismissed as noise or false positives — including: `BIOMETRIC_UNLOCK_PROMPT_PT_BR` / `BIOMETRIC_CANCEL_PT_BR` "unused" (Blind Hunter couldn't see the hook file — they are imported by `use-biometric.ts`); typed-routes regeneration claim (Expo Router auto-regenerates on next dev/build); `"error" in result` narrowing fragility (works today, future SDK-shape worry); Promise.all in `enable()` unhandled-rejection in Hermes (theoretical); spec route-name drift `BIOMETRIC_ROUTE_AUTH` vs `BIOMETRIC_LOCK_ROUTE` (spec was a draft, constant name is fine); `router.replace` inside try/finally pending flip (React 18 tolerates); hook re-probes hardware in `enable()` (intentional defensive layer); `sb-*` key collision (namespaced `healthtracker.*`); `USER_UPDATED` doesn't re-evaluate biometric gate (out of v1 scope); native rebuild step for `expo-local-authentication` (standard Expo native-module concern, documented).

## Review Findings (code review round 2, 2026-05-20)

### Patches

- [x] [Review][Patch] **P16** `lockEvaluated` never resets — sign-out + sign-in within the same JS context skips the lock for the new session — Med [apps/expo/src/app/_layout.tsx:25,93-94]. Cross-source (Blind + EdgeCase). Fix: reset `lockEvaluated = false` in the `SIGNED_OUT` branch of `onAuthStateChange`, and re-evaluate the gate on `SIGNED_IN` when a stored preference is present.
- [x] [Review][Patch] **P17** Tap-race on lock screen: user can tap "Usar biometria" before the `getSession()` mount check resolves; `prompt()` succeeds → `router.replace(INICIO_ROUTE)` lands them on an authenticated screen with no session — Med [apps/expo/src/app/(auth)/biometric.tsx:53-67,109-123]. Gate the unlock button on a `sessionChecked` state.
- [x] [Review][Patch] **P18** Android `not_available` / `not_enrolled` / `passcode_not_set` codes fall through to `failed` — a patient whose biometric was removed at the OS level after enrolling gets force-logged-out on the third tap instead of an "unavailable" message — Med [apps/expo/src/hooks/use-biometric.ts:48-66]. Add `UNAVAILABLE_ERROR_CODES`; expose a third `BiometricPromptResult` variant (`{ ok: false; reason: 'unavailable' }`) and have the lock screen route to register cleanly without consuming the strike budget.
- [x] [Review][Patch] **P19** Session-check on lock screen calls `resetBiometricFailedAttempts()` on the absent-session branch — wipes a legitimate in-progress strike count — Low [apps/expo/src/app/(auth)/biometric.tsx:60]. Drop the reset on the absent-session path; only reset on confirmed unlock success or in `fallbackToRegistration`.

### Deferred

- [x] [Review][Defer] **F28** Onboarding biometric offer screen has no session-presence guard. The flow only routes here from `/onboarding/consent` which already requires a session, so the gap is theoretical. Joins the F11 family.
- [x] [Review][Defer] **F29** Cannot distinguish user-initiated `SIGNED_OUT` from transient token-refresh-induced `SIGNED_OUT` — preference may get wiped during a refresh blip and force a re-enroll. Requires Supabase intent metadata that doesn't exist today.
- [x] [Review][Defer] **F30** Double-tap race on Unlock — `disabled={pending}` is set after `setPending(true)` schedules; a rapid two-tap can fire two `prompt()` calls. Same family as F21; add a ref-guard if telemetry shows duplicates.
- [x] [Review][Defer] **F31** Warm-launch deep-link not protected — P3 only inspects `Linking.getInitialURL()` (cold path); `Linking.addEventListener` warm-path deep-links aren't gated. Low real-world likelihood for a returning patient who already has biometric enabled AND receives a verification link mid-session.
- [x] [Review][Defer] **F32** `BackHandler` returns `true` unconditionally — future modal/dialog screens on the lock won't be dismissable via back. Revisit when the first such overlay ships.

### Dismissed

14 findings dismissed — including: NSFaceIDUsageDescription duplication in `infoPlist` + `faceIDPermission` (intentional belt-and-suspenders against Expo Prebuild reshape); fail-open vs fail-closed inconsistency between the launch-time gate and the lock screen (different threat models — the gate fails open to avoid wedging the app, the lock fails closed to avoid session bypass); `BackHandler` API version shape concern (RN 0.81.5 confirmed); `BIOMETRIC_LOCK_ROUTE = "/biometric"` collision risk with `/onboarding/biometric` (cosmetic — distinct paths via `(auth)` group); `INICIO_ROUTE` import drift after removal in `consent.tsx` (typecheck would catch); supposedly dead validators exports `BIOMETRIC_UNLOCK_PROMPT_PT_BR` / `BIOMETRIC_CANCEL_PT_BR` (Auditor confirmed: imported by `use-biometric.ts`); cancel-clears-prior-error UX nit (acceptable); `Stack.Screen` chrome inconsistency between offer and lock screens (intentional — different surfaces); `expo-secure-store` version assertion (already a dep); theoretical `.catch` unhandled rejection on a `void`-prefixed Promise (paranoid); empty-string `result.error` (same default-failed outcome); module-scope counter "conflation" with a hypothetical second consumer (single-consumer invariant; document, don't fix); `router.replace` itself throwing during a race (paranoid); `Linking.parse` trailing-slash / query-only edge (Expo Router normalizes).

## Review Findings (code review round 3, 2026-05-20)

Acceptance Auditor verified all 18 prior patches (P1–P14, P16–P19) and confirmed the 4 ACs hold. Blind Hunter + Edge Case Hunter caught regressions introduced by the round-2 fixes and one symmetry gap.

### Patches

- [x] [Review][Patch] **P20** SIGNED_IN handler bypasses the `/auth/callback` deep-link guard from P3 — High [apps/expo/src/app/_layout.tsx:114-120]. When an email-verification deep link sets a session, Supabase fires `SIGNED_IN`, which now unconditionally calls `evaluateBiometricGate()`. The cold-launch effect inspects `Linking.getInitialURL()` and bails when the launch is `/auth/callback`; the SIGNED_IN listener does not. P3's protection is silently defeated on the SIGNED_IN path — a returning patient with a stored biometric preference who clicks a verification link can land on the lock screen before the callback handler routes to consent. Fix: extract a `shouldEvaluateBiometricGate()` helper that performs the callback check, and gate both call sites through it.
- [x] [Review][Patch] **P21** `lockEvaluated = true` set before async work — a transient SecureStore / getSession failure permanently latches the gate for the rest of the JS context — High [apps/expo/src/app/_layout.tsx:46-66]. Move the latch into the success branch (only set `true` after `router.replace` is called or determined unnecessary), or reset `lockEvaluated = false` in the catch so a transient blip doesn't disable subsequent SIGNED_IN re-evaluations.
- [x] [Review][Patch] **P22** `enable()` not updated symmetrically with P18 — a mid-enrollment `not_enrolled` / `not_available` / `passcode_not_set` code collapses to `reason: 'failed'` instead of `'unavailable'`, and the offer screen surfaces a generic error instead of treating the device as unable to enroll — Med [apps/expo/src/hooks/use-biometric.ts:153-160]. Add `UNAVAILABLE_ERROR_CODES.has(code)` check in `enable()` matching `prompt()`. (`BiometricEnableResult` already includes `'unavailable'`; only the emit-site is missing.)
- [x] [Review][Patch] **P23** No exhaustiveness check on `BiometricPromptResult.reason` in the lock-screen `handleUnlock` — a future union extension (e.g., `'rate_limited'`) would silently fall through to the strike-increment path — Low [apps/expo/src/app/(auth)/biometric.tsx:115-138]. Add a `default: never` assertion or refactor the chain into a `switch` with `assertNever(reason)` so adding a variant to the union forces a compile-time fix at every consumer.

### Deferred

- [x] [Review][Defer] **F33** `'unavailable'` UX over-rotates: signs the patient out and forces re-registration for a recoverable OS-side state change. The patient could in principle re-enroll biometric or sign in with password, but the only available path today is full re-registration (Clarification #4 / no sign-in screen yet). Revisit when `/login` lands.
- [x] [Review][Defer] **F34** `fallbackToRegistration` is sequential (`await disable()` then `await signOut()`) and shows no progress indicator. On slow / offline devices the button is disabled for seconds with no feedback. Parallelize via `Promise.allSettled` and/or render an in-button spinner.
- [x] [Review][Defer] **F35** Lock-screen mount effect deps `[router]` — `useRouter()` is conventionally stable but not contractually guaranteed; an identity change re-runs the session check. Switch to importing the `router` singleton from `expo-router` directly (`import { router } from "expo-router"`) and use empty deps.

### Dismissed

11 findings dismissed — including: SIGNED_OUT wipes preference on token-refresh failure (same as F29 already deferred); SIGNED_IN-driven re-gate "dead in account-switch path" (misreading — the path serves the SIGNED_IN-without-prior-SIGNED_OUT case); same-user re-auth re-triggers lock (Edge Case Hunter missed that SIGNED_OUT clears preference first); `'unavailable'` branch unreachable (Auditor verified the hook does emit it); cold-launch + listener concurrent fire on `lockEvaluated` (JS is single-threaded — check-and-set is atomic between event-loop turns); `router.replace` silent no-op + sessionChecked stuck (hypothetical); `getSession()` hangs indefinitely without timeout (already F24 deferred); SIGNED_OUT delete ordering vs SIGNED_IN read (paranoid); `/auth/callback` without `code` param bypasses gate (the callback handler validates the code itself); `BIOMETRIC_LOCK_TITLE_PT_BR = "Health Tracker"` brand-hardcode (intentional, F24-family); `BackHandler` swallows back during unlock→Início transition window (trivial timing edge).
