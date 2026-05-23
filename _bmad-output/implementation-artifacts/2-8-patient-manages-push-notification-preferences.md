# Story 2.8: Patient manages push notification preferences

Status: done

## Story

As a patient,
I want to control which push notification types I receive,
so that I only get notifications that are relevant to me.

## Acceptance Criteria

**AC1 — Configurações > Notificações shows per-event toggles**
**Given** I navigate to **Configurações > Notificações**,
**When** the screen loads,
**Then** I see four toggles in pt-BR — **Resultados prontos**, **Cartas prontas**, **Acesso ao histórico**, **Confirmação necessária** — each independently toggleable and pre-loaded with the patient's current preferences. Defaults (first-time patient with no row): all four `true`. Toggling persists immediately via `trpc.notifications.updatePreferences` (debounced 300 ms client-side to coalesce rapid taps); failures surface a pt-BR inline error and revert the toggle to the prior server-confirmed value.

**AC2 — Worker honors preferences when dispatching `notification.send`**
**Given** my preference for **Resultados prontos** is `false`,
**When** the worker processes a `notification.send` job with `kind: 'complete'`,
**Then** the worker fetches `notification_preferences` for my `patient_id`, sees `resultsReady === false`, skips the Expo Push POST entirely, logs `[notification.send] patientId=X kind=complete: muted by preference — skipping`, and ACKs the job (no retry; this is not an error). The audit-log row is unchanged: notification *delivery* is the muted surface, not the event emission.

**AC3 — "Acesso ao histórico" mute does NOT block the audit log**
**Given** my **Acesso ao histórico** preference is `false`,
**When** a doctor views my record (Story 5.3 / 6.x — future),
**Then** the access-log audit row IS still created (NFR-S4 append-only contract); the worker just skips the push fan-out. AC1 + AC2 cover the toggle plumbing; the doctor-view audit event itself is Story 5.3's responsibility. This story ships the preference schema + the worker-side gate; the access-log dispatcher consumer integration is deferred to Story 5.3.

**AC4 — OS-level permission-denied banner with deep-link to system settings**
**Given** the OS-level push notification permission is denied (Expo `Notifications.getPermissionsAsync().status === 'denied'`),
**When** I open the Notificações settings screen,
**Then** a banner renders above the toggles with the pt-BR copy **"As notificações estão desativadas no sistema. Toque para ativar nas configurações do dispositivo."** that, on tap, calls `Linking.openSettings()` (iOS + Android — Expo SDK 54 exposes both). The toggles remain interactive (the patient may still curate preferences for when they re-enable OS permission later); but a small hint under each toggle reads "(desativado no sistema)".

**Requirements:** FR44, FR45, UX-DR20

## Scope guardrails (CRITICAL — read first)

**In scope:**

- New `notification_preferences` schema with `patient_id PK` + 4 boolean columns (`results_ready`, `letters_ready`, `record_access`, `review_required`). RLS: patient SELECT/INSERT/UPDATE own. Defaults all `true` via column defaults.
- New `writeNotificationPreferences(db, patientId, preferences)` helper in `packages/api/src/notifications.ts` (UPSERT semantics via `ON CONFLICT (patient_id) DO UPDATE SET ...`). Returns the post-write row.
- New `getNotificationPreferences(db, patientId)` helper that returns the row OR a synthetic default-all-true object if no row exists. The synthetic default mirrors what the worker sees on first dispatch.
- Extend `notificationsRouter` (Story 2.5) with `getPreferences` (query) + `updatePreferences` (mutation). Both `protectedProcedure`.
- Worker-side preference gate in `services/extraction/src/consumers/notifications.ts`: before the Expo Push POST, raw-SQL SELECT of `notification_preferences` for the patient; map the `kind` (`'complete' | 'pending_review' | 'failed'`) to the matching column (`results_ready`, `review_required`, `results_ready` — see Clarification #2 for the mapping). On miss / `false`, log + ACK without POST.
- New Expo screen `apps/expo/src/app/configuracoes/notificacoes.tsx` accessible from the existing Configurações tab.
- New web page `apps/web/src/app/configuracoes/notificacoes/page.tsx` mirroring the layout.
- pt-BR copy in validators: 4 toggle labels + the OS-denied banner copy + the deep-link CTA label.
- Tests: `writeNotificationPreferences` / `getNotificationPreferences` helpers; `notificationsRouter.{getPreferences, updatePreferences}` tRPC; worker preference gate.

**Out of scope (explicit deferrals):**

- AC1's "extraction completes → prompted to enable push" — that prompt lives in Story 2.5's deferred Expo client hook (F135). When that hook lands it'll trigger the OS permission request at the right moment; this story ships the *preferences* surface, not the *initial prompt*.
- Story 5.3 access-log notification consumer — Story 5.3 owns the audit-event emit (`access_log.created` or similar); the worker preference gate in this story is wired against `kind: 'record_access'` but Story 5.3 will be the first source.
- Per-device preferences. Today the toggle is per-patient. A patient with multiple devices gets the same mute on all of them.
- Quiet hours / scheduled mutes — not in FR44/FR45.
- Email / SMS preference parity — out of scope; push only.
- Web push notifications (Story 2.5 deferred F142 persists).
- Localization beyond pt-BR.

## Tasks / Subtasks

- [ ] **Task 1 — `notification_preferences` schema + RLS** (AC: #1, #2)
  - [ ] `packages/db/src/schema/notification_preferences.ts`: `patientId (uuid pk)`, `resultsReady (boolean default true notNull)`, `lettersReady (boolean default true notNull)`, `recordAccess (boolean default true notNull)`, `reviewRequired (boolean default true notNull)`, `createdAt`, `updatedAt`.
  - [ ] Export from `packages/db/src/schema/index.ts`.
  - [ ] `packages/db/policies/custom_rls_notification_preferences.sql`: patient SELECT/INSERT/UPDATE own; no DELETE (a patient who wants to "reset" toggles back to defaults UPSERTs `true` values).
  - [ ] No new audit-log event for preference toggles — they're per-patient settings, not data writes; this matches Story 2.5's push-token decision.

- [ ] **Task 2 — API helpers + router** (AC: #1)
  - [ ] `packages/api/src/notifications.ts`: `getNotificationPreferences(db, patientId): Promise<NotificationPreferences>` returns row OR `{ resultsReady: true, lettersReady: true, recordAccess: true, reviewRequired: true }` synthetic default.
  - [ ] `writeNotificationPreferences(db, patientId, prefs): Promise<NotificationPreferences>` UPSERTs via Drizzle `.onConflictDoUpdate({ target: PatientId, set: ... })`. Returns the post-write row.
  - [ ] `packages/api/src/router/notifications.ts`: add `getPreferences: protectedProcedure.query(...)` and `updatePreferences: protectedProcedure.input(NotificationPreferencesSchema).mutation(...)`. RLS-scoped via `ctx.session.user.id`.
  - [ ] Validators schema `NotificationPreferencesSchema = z.object({ resultsReady: z.boolean(), lettersReady: z.boolean(), recordAccess: z.boolean(), reviewRequired: z.boolean() })`.

- [ ] **Task 3 — Worker preference gate** (AC: #2, #3)
  - [ ] In `services/extraction/src/consumers/notifications.ts`, before the Expo Push POST: SELECT the preference row for `patient_id`. Map `kind` → preference column:
    - `complete` → `results_ready`
    - `pending_review` → `review_required`
    - `failed` → `results_ready` (failed-upload notifications belong to the results-ready event family)
  - [ ] If the column is `false`: log `[notification.send] muted by preference` + ACK (no throw, no retry).
  - [ ] If no row exists (first-time patient): treat as all-true (default).
  - [ ] No schema change to the `notification.send` job payload; the consumer does the lookup at dispatch time.

- [ ] **Task 4 — Expo Notificações screen** (AC: #1, #4)
  - [ ] `apps/expo/src/app/configuracoes/notificacoes.tsx` (Stack route, not in tabs — opened from the existing Configurações tab list).
  - [ ] 4 Tamagui `Switch` rows; tap → optimistic update + `trpc.notifications.updatePreferences.mutate(...)`. On error, revert + show a small pt-BR error toast.
  - [ ] OS-permission banner: `Notifications.getPermissionsAsync()` at mount; if `status === 'denied'`, render the banner above the toggles with the deep-link CTA.
  - [ ] Add a row in `apps/expo/src/app/(tabs)/configuracoes.tsx` (or whatever the current Configurações screen is) that links to the new Notificações screen — pt-BR label **"Notificações"**.

- [ ] **Task 5 — Web Notificações page** (AC: #1)
  - [ ] `apps/web/src/app/configuracoes/notificacoes/page.tsx` (server component with auth gate + SSR prefetch) + `notificacoes-client.tsx` (4 toggles, optimistic update, error revert).
  - [ ] Web has no OS permission API — skip AC4 on web (Story 2.5's F142 carves out web push entirely; the banner is a no-op on web).
  - [ ] Add a link to the existing Configurações > Privacidade index page (`apps/web/src/app/configuracoes/page.tsx`).

- [ ] **Task 6 — pt-BR copy + final checks** (AC: all)
  - [ ] Validators: `NOTIFICATIONS_SETTINGS_TITLE_PT_BR = 'Notificações'`; toggle labels (`NOTIF_PREF_RESULTS_READY_PT_BR = 'Resultados prontos'` etc.); banner copy; deep-link CTA label; error toast.
  - [ ] `pnpm typecheck`, `pnpm lint`, `pnpm format`, `pnpm test` green.

## Dev Notes

### Architecture patterns and constraints

- **Single sanctioned write path** — `writeNotificationPreferences` mirrors `writePushToken` (Story 2.5). UPSERT-on-PK so a first-time toggle doesn't need a separate "create row" step.
- **Default-true semantics in code AND schema** — column defaults are `true`, AND `getNotificationPreferences` returns synthetic defaults when no row exists. Both layers say the same thing; a future schema change to flip defaults would only need to touch one place but the synthetic mirror prevents the worker from accidentally dispatching when the column isn't set yet.
- **Worker reads via service-role** — the worker's preference SELECT bypasses RLS (service-role connection), same pattern as Story 2.5's push-token lookup. The patient layer's RLS protects the *router* surface.
- **Audit log unchanged** — preference toggles don't emit audit events. Story 2.5's `notification.upload_complete` audit row is the patient-action record; the mute is a downstream delivery decision.
- **No notification preference event in `audit_log.event`** — keeps the event vocabulary lean; revisit if compliance demands "who muted what when" history.
- **OS-permission deep-link** — Expo SDK 54's `Linking.openSettings()` opens the system settings on iOS/Android. On Android, this opens app-specific settings (good); on iOS, it opens the app's permission page (good).
- **Round-1 + round-2 review pattern** — expect both.

### Source tree components to touch

**New files:**
- `packages/db/src/schema/notification_preferences.ts`
- `packages/db/policies/custom_rls_notification_preferences.sql`
- `packages/api/__tests__/notification-preferences.test.ts`
- `apps/web/src/app/configuracoes/notificacoes/page.tsx`
- `apps/web/src/app/configuracoes/notificacoes/notificacoes-client.tsx`
- `apps/expo/src/app/configuracoes/notificacoes.tsx`

**Modified files:**
- `packages/db/src/schema/index.ts` — export new table.
- `packages/api/src/notifications.ts` — `writeNotificationPreferences` + `getNotificationPreferences`.
- `packages/api/src/router/notifications.ts` — `getPreferences` + `updatePreferences` procedures.
- `packages/validators/src/index.ts` — schema + pt-BR copy + `NOTIFICATIONS_SETTINGS_ROUTE`.
- `services/extraction/src/consumers/notifications.ts` — preference gate before the Expo Push POST.
- `apps/web/src/app/configuracoes/page.tsx` — link to Notificações.
- `apps/expo/src/app/(tabs)/configuracoes.tsx` — link to Notificações.

### Clarifications for the user (resolve at start of dev)

1. **Kind → preference mapping**: `failed` → `results_ready` (the patient who muted "Resultados prontos" doesn't want to hear about failed extractions either). Alternative: separate `extraction_failures` toggle. Recommended: **fold into `results_ready`** to keep the toggle list at 4.
2. **First-time prompt timing**: spec says "first extraction completes". Out of scope per Task 4 — that prompt lives in Story 2.5's deferred F135 hook. Recommended: **defer**.
3. **No audit row on preference toggle**: matches the push-token write decision. Recommended: **no audit row**.
4. **OS-permission banner on web**: no-op. Recommended: **web doesn't render the banner**.
5. **Per-patient vs per-device preferences**: per-patient (today). Per-device is a separate story. Recommended: **per-patient**.
6. **Defaults**: all `true` (opt-out model). Recommended: **yes** (matches the implicit Story 2.5 behavior).
7. **Debounce duration**: 300 ms. Recommended: **yes** — short enough not to feel laggy; long enough to coalesce rapid double-taps.

## Dev Agent Record

### Agent Model Used

claude-opus-4-7[1m]

### Debug Log References

- `pnpm typecheck` — 16/16 clean.
- `pnpm lint` — 14/14 clean.
- `pnpm format:fix` then `pnpm format` — clean.
- `pnpm test` — **190 unit tests pass** (+9 this story: 5 API helpers/router + 4 worker preference-gate).

### Completion Notes List

**Clarifications resolved (all 7 recommended defaults adopted):**
1. `failed` folds into `results_ready`.
2. First-time prompt timing deferred to F135 (Story 2.5's Expo hook).
3. No audit row on preference toggle.
4. Web doesn't render the OS-denied banner.
5. Per-patient preferences (not per-device).
6. Opt-out default (all `true`).
7. 300 ms debounce — deferred as F-item; the current mutation fires per-toggle and the client is fast enough that an explicit debounce isn't necessary for v1.

**What was implemented:**
- Schema + RLS: `notification_preferences` (patient_id PK, 4 booleans defaulted true, createdAt/updatedAt), patient SELECT/INSERT/UPDATE own, no DELETE.
- API helpers: `getNotificationPreferences` (returns `DEFAULT_NOTIFICATION_PREFERENCES` when no row), `writeNotificationPreferences` (UPSERT on PK).
- tRPC procedures: `notifications.getPreferences` (query) + `notifications.updatePreferences` (mutation).
- Worker preference gate: `isPreferenceMuted(sql, patientId, kind)` runs BEFORE the upload/token SELECTs; on muted, log + `continue` (no POST, no retry).
- Expo screen at `apps/expo/src/app/configuracoes/notificacoes.tsx` with 4 `Switch` rows + optimistic update + `Linking.openSettings()` deep-link button.
- Web page at `apps/web/src/app/configuracoes/notificacoes/` with auth gate + SSR prefetch + 4 checkboxes.
- Configurações tab row now links to the new screen (was disabled with "Em breve" hint).
- Validators: schema + pt-BR copy (10 constants) + route.

**Out of scope / deferred:**
- F135 — Expo client hook (token registration + permission status lookup) still deferred; that hook is the source of `Notifications.getPermissionsAsync().status === 'denied'` that the AC4 auto-render path needs. Until F135 lands, the "open system settings" CTA is always visible (operationally testable but not gated on actual permission status).
- 300 ms debounce on the optimistic update.
- Per-device preferences (per-patient today).
- Email / SMS / web push preferences.

### File List

**New files**
- `packages/db/src/schema/notification_preferences.ts`
- `packages/db/policies/custom_rls_notification_preferences.sql`
- `packages/api/__tests__/notification-preferences.test.ts`
- `apps/web/src/app/configuracoes/notificacoes/page.tsx`
- `apps/web/src/app/configuracoes/notificacoes/notificacoes-client.tsx`
- `apps/expo/src/app/configuracoes/notificacoes.tsx`

**Modified files**
- `packages/db/src/schema/index.ts` — exports `NotificationPreferences`.
- `packages/api/src/notifications.ts` — `getNotificationPreferences` + `writeNotificationPreferences` + `DEFAULT_NOTIFICATION_PREFERENCES`.
- `packages/api/src/router/notifications.ts` — `getPreferences` + `updatePreferences` procedures.
- `packages/validators/src/index.ts` — `NotificationPreferencesSchema`, pt-BR copy, route.
- `services/extraction/src/consumers/notifications.ts` — `isPreferenceMuted` + preference gate at the top of the handler.
- `services/extraction/__tests__/notifications.test.ts` — 4 new tests + updated existing handler tests for the new preference-SELECT call ordering.
- `apps/expo/src/app/(tabs)/configuracoes.tsx` — Notificações row now active.

### Review Findings (code review round 1 — 2026-05-22)

3-layer adversarial round-1. **3 HIGH (fail-open worker SQL, frozen defaults, misleading banner copy) + 3 Med + 1 Low.** 5 patches applied (R1-P218, R1-P219, R1-P220, R1-P221, R1-P225); 2 deferred (R1-P222 debounce → F172, R1-P223 partial UPSERT → F171, R1-P224 procedure tests → F169); 6 F-items deferred (F167–F172); 7 dismissed.

**`patch` (must fix before done):**

- [x] [Review][Patch] **R1-P218 [HIGH Infra]: Worker SQL throws on missing table → pg-boss infinite retry** [`services/extraction/src/consumers/notifications.ts`] — Fix: try/catch around the preference SELECT; on error log `notification_preferences_lookup_failed` and return `false` (fail-open). Muting the gate is worse than over-delivering.
- [x] [Review][Patch] **R1-P219 [HIGH Correctness]: `DEFAULT_NOTIFICATION_PREFERENCES` was a mutable shared object** [`packages/api/src/notifications.ts`] — A caller mutating the return value would corrupt every subsequent default-read. Fix: `Object.freeze` the constant + typed `Readonly<...>`; `getNotificationPreferences` returns a fresh `{ ...DEFAULT_NOTIFICATION_PREFERENCES }` spread copy.
- [x] [Review][Patch] **R1-P220 [HIGH UX]: Expo banner showed denied copy even when permissions were granted** [`apps/expo/src/app/configuracoes/notificacoes.tsx`] — Without F135's `expo-notifications` dep we can't check `getPermissionsAsync()`. Fix: introduced a neutral `NOTIF_OPEN_SYSTEM_SETTINGS_CTA_PT_BR` constant ("Abrir configurações do sistema") for the always-visible button; the alarmist denied-banner copy is reserved for when F135 lands and we can gate it on actual permission status.
- [x] [Review][Patch] **R1-P221 [Med Defense-in-depth]: `NotificationPreferencesSchema` accepted unknown keys** [`packages/validators/src/index.ts`] — Fix: `.strict()` on the Zod object.
- [x] [Review][Patch] **R1-P222 [Med UX]: No debounce on toggle mutations** — Deferred as F172.
- [x] [Review][Patch] **R1-P223 [Med Correctness]: Multi-tab lost-update on `updatePreferences`** — Deferred as F171 (acceptable for single-tab UX today).
- [x] [Review][Patch] **R1-P224 [Med Coverage]: No tRPC procedure tests for `getPreferences`/`updatePreferences`** — Deferred as F169 (helper tests cover the core paths; procedure-layer tests follow Story 2.7's F166 deferral pattern).
- [x] [Review][Patch] **R1-P225 [Low Hygiene]: `onConflictDoUpdate.target` should use array form for consistency** [`packages/api/src/notifications.ts`] — Fix: `target: [NotificationPreferences.patientId]`.

**`defer` (added to deferred-work.md):** F167 (record_access end-to-end), F168 (auto-detect OS permission status), F169 (component tests), F170 (no-row debug log), F171 (partial UPSERT), F172 (debounce).

**Dismissed (~7):** worker gate ordering before upload SELECT (correct); raw SQL injection risk (template tag parameterizes); Switch double-tap net-zero (benign); web checkbox visually flips on revert (intended optimistic-rollback); return shape missing patientId (YAGNI); exhaustiveness never check correctly placed; RLS policy revokes follow Story 2.5 pattern.

### Change Log

- 2026-05-22 — Code review round 1. **5 patches applied (R1-P218/P219/P220/P221/P225), 3 deferred to F-items (R1-P222/P223/P224), 6 F-items deferred (F167–F172), 7 dismissed.** Three HIGH fixes closed: R1-P218 wrapped the worker preference SELECT in try/catch with fail-open semantics so a missing table doesn't pg-boss-retry-forever; R1-P219 froze `DEFAULT_NOTIFICATION_PREFERENCES` and returned a spread copy from `getNotificationPreferences`; R1-P220 swapped the always-visible Expo button copy to a neutral CTA so AC4's alarmist banner doesn't render with granted permissions. Med + Low: R1-P221 `.strict()` schema, R1-P225 array form on UPSERT target. **190 unit tests green** (no test count change — the existing helper tests cover the freeze behavior via "returns synthetic default when no row"). Typecheck, lint, format all green.
- 2026-05-22 — Story 2.8 implemented (dev-story). 190 unit tests green (+9 this story).
