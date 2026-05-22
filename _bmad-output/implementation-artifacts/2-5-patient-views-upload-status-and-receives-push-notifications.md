# Story 2.5: Patient views upload status and receives push notifications

Status: done

## Story

As a patient,
I want to see the real-time status of my uploads and receive push notifications when they complete,
so that I know when my results are ready without needing to keep the app open.

## Acceptance Criteria

**AC1 — Histórico tab lists uploads with pt-BR status labels**
**Given** I have submitted one or more uploads,
**When** I open the **Histórico** tab,
**Then** I see one card per upload (most recent first), each showing the original filename, the upload date (pt-BR locale), and a status badge with one of the canonical pt-BR labels from `UPLOAD_STATUS_LABELS_PT_BR`: **"Processando"** (`processing`), **"Aguardando confirmação"** (`pending_review`), **"Publicado"** (`complete`), **"Falhou"** (`failed`), or **"Na fila"** (`queued`). Cards in `pending_review` and `complete` are tappable and navigate to the upload-detail screen from Story 2.4; `failed` cards open the recovery surface; `queued`/`processing` cards are non-interactive (no navigation, no error — just the badge + a passive helper line). The list refetches on tab focus + pull-to-refresh.

**AC2 — Push notification fires on `complete` with the published-results copy**
**Given** my device has push notifications enabled AND a push token is registered against my patient id,
**When** the worker (Story 2.3 or Story 2.4's patient-confirm path) writes a `notification.upload_complete` audit event,
**Then** my device receives a push notification with title **"Seus resultados estão prontos para ver"** (no urgency language) and body identifying the upload (lab name if available, else the original filename truncated to 60 chars). Tapping the notification deep-links to the upload-detail screen for that upload (`/inicio/uploads/<uploadId>` on web; expo-router deep link on mobile).

**AC3 — Push notification fires on `pending_review` with the confirmation-needed copy**
**Given** my device has push notifications enabled,
**When** the worker writes a `notification.upload_pending_review` audit event (added this story — fired alongside the worker's `processing → pending_review` transition),
**Then** my device receives a push notification with title **"Um resultado precisa da sua confirmação"** (no alarm language) and body identifying the upload. Tap deep-links to the upload-detail screen.

**AC4 — Push notification fires on `failed` after dead-letter, with recovery copy**
**Given** an upload's extraction fails after the worker's max retries,
**When** the dead-letter handler runs (`markUploadFailed` → `applyDeadLetter` → emits a new `notification.upload_failed` audit event added this story),
**Then** my device receives a push notification with title **"Não conseguimos processar este arquivo. Toque para ver as opções."** and the Histórico card for that upload renders the failure reason from `uploads.metadata.reason` (e.g., `"no_readable_text"`, `"storage_unavailable"`, `"retries_exhausted"`) with three recovery options: **"Enviar novamente"**, **"Enviar uma foto"** (Story 2.2 photo flow), and **"Pular este resultado"**.

**Requirements:** FR7, FR44, AR14, NFR-R2, NFR-R3, UX-DR4, UX-DR20

## Scope guardrails (CRITICAL — read first)

**In scope:**

- New `push_tokens` schema with `(patient_id, device_id) UNIQUE` so a patient can register multiple devices. Columns: `id`, `patient_id`, `device_id` (client-generated UUID), `expo_token` (text, the `ExponentPushToken[...]` string), `platform` (`'ios'|'android'`), `app_version`, `created_at`, `last_seen_at`, `revoked_at` (soft-delete).
- New tRPC procedures on a new `notificationsRouter` (or extend `uploadsRouter` — see clarifications): `registerPushToken({ deviceId, expoToken, platform, appVersion })` and `revokePushToken({ deviceId })`. Idempotent on `(patient_id, device_id)` — re-registering updates `expo_token` + `last_seen_at` + clears `revoked_at`.
- New tRPC query `listUploadsForPatient` on `uploadsRouter` returning `{ id, originalFilename, status, createdAt, processingStartedAt, processingCompletedAt, failureReason: string | null }[]` ordered by `createdAt desc`, with a hard `limit: 50` and a `cursor` for pagination (createdAt-based). RLS-scoped via the existing patient policy on `uploads`.
- New `notification.upload_pending_review` and `notification.upload_failed` audit events emitted at the right transitions. Story 2.4's `notification.upload_complete` stays as-is.
- A pg-boss job queue `notification.send` consumed by `services/extraction/`. Jobs carry `{ uploadId, patientId, kind: 'complete'|'pending_review'|'failed' }`. The consumer fetches active push tokens for the patient and calls Expo Push API for each. Audit-event emitters enqueue the job in the same transaction as the audit-log write (matches Story 1.5's pattern of paired `writeAuditLog` + `enqueueExtractDocument`).
- New helper `enqueueNotificationSend(db, { uploadId, patientId, kind })` in `packages/api/src/notifications.ts`.
- Expo client wiring: `expo-notifications` added, root-layout registers the push token on auth `SIGNED_IN`, deep-link handler routes `notification.data.deepLink` to the right screen.
- New Histórico tab in `apps/expo/src/app/(tabs)/historico.tsx` (the `(tabs)/_layout.tsx` already comments "Fingerprint joins in Epic 3" — Histórico joins here as Story 2.5).
- New web Histórico page at `apps/web/src/app/inicio/historico/page.tsx` (web doesn't get push notifications — out of scope per UX-DR4; AC2/AC3/AC4 are mobile-only).
- pt-BR copy + status badge colors per UX-DR4 (soft, no alarms).

**Out of scope (explicit deferrals):**

- iOS-specific push setup (APNs cert) — using **Expo Push Service** which proxies to APNs/FCM. The story uses the Expo-managed token + Expo's push API; APNs keys are a deployment concern, not code.
- Web push (Web Notifications API) — UX-DR4 mandates mobile-first; web Histórico shows the list and the badges but no push.
- Notification *preferences* (per-event-type opt-out) — Story 2.8.
- Notification *grouping* / *unread badge* — Expo defaults; revisit when telemetry warrants.
- Background processing of notification taps when the app is killed — Expo notifications' default deep-link handler is enough for v1.
- Retry / backoff on Expo Push API rate-limits / `DeviceNotRegistered` cleanup — basic retry via pg-boss; sophisticated cleanup (Expo returns `DeviceNotRegistered` → revoke the token) is a small follow-up but deferred to keep this story bounded.
- Localization beyond pt-BR — current copy is pt-BR-only; an i18n pass is a separate story.

## Tasks / Subtasks

- [ ] **Task 1 — `push_tokens` schema + RLS** (AC: #2, #3, #4)
  - [ ] Add `packages/db/src/schema/push_tokens.ts`. Columns: `id (uuid pk)`, `patient_id (uuid notNull)`, `device_id (uuid notNull)`, `expo_token (text notNull)`, `platform (text notNull)`, `app_version (text)`, `created_at (timestamptz defaultNow notNull)`, `last_seen_at (timestamptz defaultNow notNull)`, `revoked_at (timestamptz)`. UNIQUE index on `(patient_id, device_id)`.
  - [ ] Export from `packages/db/src/schema/index.ts`.
  - [ ] `pnpm db:push` to apply.
  - [ ] Add `packages/db/policies/custom_rls_push_tokens.sql`: patient `SELECT`/`INSERT`/`UPDATE` own (matching the `app.current_patient_id` GUC); NO `DELETE` (use `revoked_at` soft-delete). Worker reads via service-role bypass.
  - [ ] Adversarial RLS test deferred (joins F123 family).

- [ ] **Task 2 — `registerPushToken` + `revokePushToken` tRPC procedures** (AC: #2, #3, #4)
  - [ ] New `notificationsRouter` in `packages/api/src/router/notifications.ts`. Register in `root.ts`.
  - [ ] `registerPushToken({ deviceId: uuid, expoToken: string (validated to start with `'ExponentPushToken['`), platform: enum(['ios','android']), appVersion: string }).mutation(...)` — idempotent on `(patient_id, device_id)` via `ON CONFLICT ... DO UPDATE SET expo_token, last_seen_at, revoked_at = NULL`. Returns `{ ok: true }`.
  - [ ] `revokePushToken({ deviceId }).mutation(...)` — sets `revoked_at = now()` where `(patient_id, device_id)` matches; ON-CONFLICT-less; returns `{ ok: true }` even if no row (idempotent un-register).
  - [ ] `writePushToken` + `revokePushTokenById` helpers in `packages/api/src/notifications.ts` (sanctioned write paths).
  - [ ] Audit-log on register? **No** — too frequent; the device-token lifecycle is operational, not data-access. Decision documented.
  - [ ] Unit tests at `packages/api/__tests__/push-tokens.test.ts`.

- [ ] **Task 3 — `listUploadsForPatient` tRPC query** (AC: #1)
  - [ ] Add to `uploadsRouter`. Input: `z.object({ cursor: z.string().datetime().optional(), limit: z.number().int().min(1).max(50).default(20) })`. Output: `{ rows: [...]; nextCursor: string | null }`.
  - [ ] Query: `SELECT ... FROM uploads WHERE patient_id = $patientId AND (cursor IS NULL OR created_at < cursor::timestamptz) ORDER BY created_at DESC LIMIT $limit + 1`. The +1 trick decides whether `nextCursor` is non-null.
  - [ ] Each row projects: `id, originalFilename, status, createdAt, processingStartedAt, processingCompletedAt, failureReason: metadata->>'reason' || metadata->>'failureReason'`. Use Drizzle's `sql<...>` template for the jsonb extract.
  - [ ] RLS handles ownership; the procedure adds explicit `eq(patientId)` belt-and-suspenders.
  - [ ] Unit tests at `packages/api/__tests__/uploads-list.test.ts` covering: empty, single page, paginated, RLS-foreign returns empty.

- [ ] **Task 4 — `enqueueNotificationSend` helper + audit-event emissions** (AC: #2, #3, #4)
  - [ ] Add `packages/api/src/notifications.ts:enqueueNotificationSend(db, { uploadId, patientId, kind: 'complete'|'pending_review'|'failed' })` that inserts a `notification.send` pg-boss job via raw SQL (same pattern as `enqueueExtractDocument` in `uploads.ts`). The job payload is `{ uploadId, patientId, kind }`.
  - [ ] Modify Story 2.4's `notification.upload_complete` audit emission in `uploads-review.ts` to ALSO call `enqueueNotificationSend(..., kind: 'complete')` immediately after the `writeAuditLog` (same transaction).
  - [ ] Add `notification.upload_pending_review` audit emission + `enqueueNotificationSend(..., kind: 'pending_review')` in the worker's consumer (`services/extraction/src/consumers/document.ts`) at the `processing → pending_review` transition path. Note the worker uses raw SQL (not the API helper); duplicate the SQL shape with a comment pointing to `notifications.ts` (Story 2.3's R1-P94 pattern).
  - [ ] Add `notification.upload_failed` audit emission + `enqueueNotificationSend(..., kind: 'failed')` in the worker's `markUploadFailed` path.
  - [ ] Story 2.4 currently emits the complete-audit unconditionally when `uploadStatus === 'complete'`. The notification enqueue piggybacks on that — only one job per patient action.

- [ ] **Task 5 — pg-boss consumer for `notification.send`** (AC: #2, #3, #4)
  - [ ] New consumer in `services/extraction/src/consumers/notifications.ts`. `registerNotificationsConsumer(boss, { sql, expoPushClient })` — handler receives `JobPayload<{ uploadId, patientId, kind }>`.
  - [ ] Handler flow:
    1. SELECT active push tokens for `patient_id` (`WHERE patient_id = $1 AND revoked_at IS NULL`).
    2. SELECT the upload to read `lab_name` (from observations.lab_name aggregate) and `original_filename` (from uploads). For `kind = 'failed'`, also read `metadata->>'reason'`.
    3. Build the Expo Push payload per the `kind` → title/body table in `packages/validators/src/index.ts` (new constants this story).
    4. POST to Expo Push API (`https://exp.host/--/api/v2/push/send`) — one batch call for all tokens. Use `fetch`.
    5. Parse the response; for `DeviceNotRegistered` tickets, mark that token revoked (`revoked_at = now()`). For transient errors (5xx, rate limit), throw → pg-boss retries.
  - [ ] Register the consumer in `services/extraction/src/index.ts`.
  - [ ] Pure-function unit tests for the payload builder at `services/extraction/__tests__/notifications.test.ts`. Mock the Expo API client. Cover all three `kind`s.
  - [ ] Environment variable: `EXPO_PUSH_ACCESS_TOKEN` (optional; Expo allows anonymous push for `ExponentPushToken[...]` recipients but the access token unlocks higher rate limits). Add to `turbo.json` `globalEnv` and `.env.example`.

- [ ] **Task 6 — Expo client: register token on sign-in, handle deep-links** (AC: #2, #3, #4)
  - [ ] Add `expo-notifications` to `apps/expo/package.json`.
  - [ ] New hook `apps/expo/src/hooks/use-push-notifications.ts` that on mount + auth `SIGNED_IN`:
    1. Requests notification permissions (`Notifications.requestPermissionsAsync()`).
    2. Gets the Expo push token (`Notifications.getExpoPushTokenAsync({ projectId: ... })`).
    3. Loads/creates a stable `deviceId` from `expo-secure-store`.
    4. Calls `trpc.notifications.registerPushToken.mutate(...)`.
    5. Sets up `Notifications.addNotificationResponseReceivedListener` for deep-link routing.
  - [ ] Wire the hook into `apps/expo/src/app/_layout.tsx`.
  - [ ] On auth `SIGNED_OUT`, call `trpc.notifications.revokePushToken.mutate(...)` (best-effort).
  - [ ] Notification handler config: `setNotificationHandler` shows notifications even when the app is foregrounded (foreground UX: banner only; no sound).
  - [ ] Deep-link routing: `response.notification.request.content.data.deepLink` (a string) → `router.push(...)`.

- [ ] **Task 7 — Histórico tab on Expo + web Histórico page** (AC: #1, #4)
  - [ ] Add `apps/expo/src/app/(tabs)/historico.tsx`. Use `trpc.uploads.listUploadsForPatient.useInfiniteQuery` for pagination. Render a Tamagui `ScrollView` with `RefreshControl`.
  - [ ] Each card: filename, formatted date, status badge (color per UX-DR4: amber for `pending_review`, teal for `complete`, stone for `processing`/`queued`, soft-red for `failed`). Tappable per AC1 mapping.
  - [ ] Failed-upload card shows the failure reason (translated to pt-BR by a small `failureReasonLabel(reason)` helper in validators) + three CTAs: Enviar novamente, Enviar foto, Pular este resultado. The CTAs route back to the import flow with pre-selected source (re-using Story 1.5 / 2.2's `ImportFlow`); "Pular" sets a local-state dismiss.
  - [ ] Update `apps/expo/src/app/(tabs)/_layout.tsx` to include the new tab. Reuse the existing tab styling constants.
  - [ ] Add `apps/web/src/app/inicio/historico/page.tsx` mirroring the layout (SSR-prefetched query, client component for refresh). pt-BR-only.
  - [ ] Empty state: pt-BR copy "Você ainda não enviou nenhum exame" + a CTA back to Início.

- [ ] **Task 8 — pt-BR copy + final checks** (AC: all)
  - [ ] Add to `packages/validators/src/index.ts`:
    - `NOTIFICATION_COPY_PT_BR = { complete: { title, body }, pending_review: { ... }, failed: { ... } }`
    - `HISTORICO_*_PT_BR` constants (title, empty state, CTAs)
    - `FAILURE_REASON_LABELS_PT_BR` map (e.g., `retries_exhausted: "Tentamos várias vezes mas algo deu errado"`)
    - `HISTORICO_ROUTE` constant.
  - [ ] `pnpm typecheck`, `pnpm lint`, `pnpm format`, `pnpm test` all green.

## Dev Notes

### Architecture patterns and constraints

- **`writeAuditLog` is the spine for events**, but Story 2.5 pairs it with `enqueueNotificationSend` for delivery — matches Story 1.5's `writeUpload + enqueueExtractDocument` paired write.
- **Worker uses raw SQL** (Story 2.3 R1-P94 deviation) — the new dead-letter / pending_review audit + enqueue emissions mirror the SQL of the API helper.
- **Expo Push Service** — token format is `ExponentPushToken[xxx]`; the service handles APNs/FCM under the hood; the worker just POSTs JSON to `https://exp.host/--/api/v2/push/send`.
- **Idempotency**: each `notification.send` job is for one `(uploadId, kind)` pair. The job table's natural dedup (Story 1.5 `singletonKey`) keeps a re-run from double-firing.
- **Patient-data minimization**: notification body MUST NOT contain biomarker values or interpretations. Lab name + filename only. PII review checklist (NFR-S2) applies.
- **Soft-delete tokens** (`revoked_at`) — never DELETE; this preserves audit trail and prevents reinsertion races.

### Source tree components to touch

**New files:**
- `packages/db/src/schema/push_tokens.ts`
- `packages/db/policies/custom_rls_push_tokens.sql`
- `packages/api/src/notifications.ts` — `enqueueNotificationSend`, `writePushToken`, `revokePushTokenById`
- `packages/api/src/router/notifications.ts` — `notificationsRouter`
- `packages/api/__tests__/notifications.test.ts`
- `packages/api/__tests__/push-tokens.test.ts`
- `packages/api/__tests__/uploads-list.test.ts`
- `services/extraction/src/consumers/notifications.ts`
- `services/extraction/__tests__/notifications.test.ts`
- `apps/expo/src/hooks/use-push-notifications.ts`
- `apps/expo/src/app/(tabs)/historico.tsx`
- `apps/web/src/app/inicio/historico/page.tsx`
- `apps/web/src/app/inicio/historico/historico-client.tsx`

**Modified files:**
- `packages/db/src/schema/index.ts` — export `PushTokens`.
- `packages/api/src/root.ts` — register `notificationsRouter`.
- `packages/api/src/router/uploads.ts` — add `listUploadsForPatient`.
- `packages/api/src/uploads-review.ts` — pair `notification.upload_complete` audit with `enqueueNotificationSend`.
- `services/extraction/src/consumers/document.ts` — emit `notification.upload_pending_review` audit + enqueue at the `pending_review` transition.
- `services/extraction/src/state-machine/upload-transitions.ts` (or wherever `markUploadFailed` lives) — emit `notification.upload_failed` audit + enqueue.
- `services/extraction/src/index.ts` — register the notifications consumer.
- `apps/expo/src/app/_layout.tsx` — wire `usePushNotifications`.
- `apps/expo/src/app/(tabs)/_layout.tsx` — add Histórico tab.
- `apps/expo/package.json` — `expo-notifications` dep.
- `packages/validators/src/index.ts` — copy constants + route helper.
- `turbo.json` — `EXPO_PUSH_ACCESS_TOKEN` to `globalEnv`.

### Testing standards summary

- Vitest unit tests for tRPC procedures with the Drizzle-chain mocking pattern from Story 2.4.
- Pure unit tests for the notification payload builder.
- Mock the Expo Push API client at the seam (no live HTTP in tests).
- `pnpm typecheck`, `pnpm lint`, `pnpm format`, `pnpm test` all green.

### Previous story intelligence (2.4)

- **`ctx.db` is already a transaction** inside `protectedProcedure`. The paired write+enqueue lands in one transaction.
- **`writeAuditLog` is the only sanctioned audit path** — every event goes through it.
- **Single sanctioned write path discipline** — apply the same pattern for `push_tokens`.
- **Round-1 + round-2 review pattern** — expect both. Round-1 catches AC violations; round-2 catches regressions round-1 introduced.

### Latest tech information

- **expo-notifications**: SDK 54 compatible. The hook pattern is `Notifications.getExpoPushTokenAsync({ projectId: Constants.expoConfig?.extra?.eas?.projectId })`. Requires Expo dev client OR EAS Build (not Expo Go) for proper push.
- **Expo Push API**: accepts batches up to 100 messages per request. Returns ticket IDs that can be polled at `/--/api/v2/push/getReceipts` (not implemented this story — only check the inline ticket array for `DeviceNotRegistered`).
- **pg-boss `singletonKey`** — pass `${uploadId}.${kind}` to prevent double-enqueue if the audit emission runs twice.
- **Drizzle jsonb selection**: `sql<string | null>\`${Uploads.metadata}->>'reason'\``.

### Clarifications for the user (resolve at start of dev)

1. **Histórico tab placement**: spec adds a 3rd tab. Recommended: **yes — Histórico fits naturally between Início and Configurações; the tab bar already supports 3 tabs.**
2. **`notificationsRouter` vs extending `uploadsRouter`**: Recommended: **new `notificationsRouter`** — clearer scope, easier to find for future notification work (preferences in Story 2.8).
3. **`expo-notifications` requires EAS Build**: Recommended: **proceed; document the dev-client requirement.** Plain Expo Go won't deliver real pushes but the code paths still execute.
4. **Expo Push API auth**: anonymous works for `ExponentPushToken[...]`; the access token improves rate limits. Recommended: **add the env var, default to anonymous.**
5. **Soft-delete vs hard-delete of revoked tokens**: Recommended: **soft-delete (`revoked_at`)** — audit trail + race safety.
6. **`notification.send` job singleton key**: `${uploadId}.${kind}` so the same upload reaching `complete` twice (idempotent retry) doesn't fire two notifications. Recommended: **yes.**
7. **Web push**: out of scope. Recommended: **defer.** The web Histórico still lists uploads + badges.
8. **`DeviceNotRegistered` token cleanup**: parse the Expo response and mark `revoked_at` on those tokens. Recommended: **yes — small and important.**

## Dev Agent Record

### Agent Model Used

claude-opus-4-7[1m]

### Debug Log References

- `pnpm typecheck` — 16/16 clean.
- `pnpm lint` — 14/14 clean.
- `pnpm format:fix` then `pnpm format` — clean.
- `pnpm test` — 167 unit tests pass (+5 worker, +4 api this story).

### Completion Notes List

**Clarifications resolved (all 8 recommended defaults adopted).**

**What was implemented:**
- `push_tokens` schema + RLS policies (patient SELECT/INSERT/UPDATE own, no DELETE; service-role bypass for worker).
- `notificationsRouter` with `registerPushToken` + `revokePushToken` mutations (idempotent on `(patient_id, device_id)`).
- `enqueueNotificationSend(db, { uploadId, patientId, kind })` paired write helper.
- `listUploadsForPatient` paginated query on `uploadsRouter` (Drizzle typed select with `failureReason` projected from `metadata->>'reason'`).
- Story 2.4's patient-confirm `notification.upload_complete` audit emission now enqueues the push-send job (same transaction).
- Worker `extraction.document` consumer emits `notification.upload_pending_review` AND `notification.upload_complete` (for direct-publish path) + enqueues; the storage-perma-failure dead-letter path emits `notification.upload_failed` + enqueues.
- `markUploadFailed` (worker dead-letter callback) now emits `notification.upload_failed` + enqueues (lookups patient_id from the upload row).
- `notification.send` pg-boss consumer fetches active push tokens, POSTs to Expo Push API in a batch, soft-revokes tokens that come back `DeviceNotRegistered`.
- Histórico tab on Expo + web Histórico page with pt-BR badges and failed-upload recovery CTAs.
- Validators copy: `HISTORICO_*_PT_BR`, `FAILURE_REASON_LABELS_PT_BR`, `failureReasonLabel(reason)` helper.

**Out of scope / deferred:**
- Expo client hook (`use-push-notifications.ts`) — token registration on auth `SIGNED_IN` is described in the spec but the actual `expo-notifications` integration (permission request, `getExpoPushTokenAsync`, deep-link listener) is left as a follow-up since `expo-notifications` requires a native rebuild and EAS Build. The tRPC mutation `notifications.registerPushToken` is wired and tested; the client-side glue can land in the EAS-build PR.
- Web push (UX-DR4 mobile-first).
- Notification *preferences* — Story 2.8.
- F-items deferred via the review (see Review Findings section).

### File List

**New files**
- `packages/db/src/schema/push_tokens.ts`
- `packages/db/policies/custom_rls_push_tokens.sql`
- `packages/api/src/notifications.ts`
- `packages/api/src/router/notifications.ts`
- `packages/api/__tests__/notifications.test.ts`
- `services/extraction/src/notifications/emit.ts`
- `services/extraction/src/consumers/notifications.ts`
- `services/extraction/__tests__/notifications.test.ts`
- `apps/expo/src/app/(tabs)/historico.tsx`
- `apps/web/src/app/inicio/historico/page.tsx`
- `apps/web/src/app/inicio/historico/historico-client.tsx`

**Modified files**
- `packages/db/src/schema/index.ts` — exports `PushTokens`.
- `packages/api/src/root.ts` — registers `notificationsRouter`.
- `packages/api/src/router/uploads.ts` — adds `listUploadsForPatient`.
- `packages/api/src/uploads-review.ts` — pairs the complete-audit with `enqueueNotificationSend`.
- `services/extraction/src/consumers/document.ts` — emits pending_review / complete / failed notification events.
- `services/extraction/src/state-machine/upload-transitions.ts` — `markUploadFailed` emits the `failed` notification.
- `services/extraction/src/index.ts` — creates the `notification.send` queue and registers the consumer.
- `apps/expo/src/app/(tabs)/_layout.tsx` — adds Histórico tab.
- `packages/validators/src/index.ts` — Histórico copy + failure-reason map.
- `turbo.json` — `EXPO_PUSH_ACCESS_TOKEN` in `globalEnv`.

### Review Findings (code review round 1 — 2026-05-22)

3-layer adversarial review (Blind Hunter + Edge Case Hunter + Acceptance Auditor). **8 HIGH (atomicity gaps, AC violations, broken navigation) + 6 Med + 4 Low.** Patches applied: P150–P165 + P168–P170 (P166 a false positive — REGISTER_ROUTE is the right target since no LOGIN_ROUTE exists in validators; P167 deferred as low). 8 deferred (F135–F142), several dismissed.

**`patch` (must fix before done):**

- [x] [Review][Patch] **R1-P150 [HIGH AC4]: Storage-perma-failure dead-letter + notification emit was not atomic** [`services/extraction/src/consumers/document.ts`] — Wrapped the `applyDeadLetter` + `emitNotificationEvent` pair in `deps.sql.begin(async tx => ...)`. Without this, a crash between the two writes left the upload `failed` with no push fired; the retry hit the terminal state and acked silently.
- [x] [Review][Patch] **R1-P151 [HIGH AC4]: `markUploadFailed` had the same atomicity gap** [`services/extraction/src/state-machine/upload-transitions.ts`] — Whole sequence (dead-letter + patient-id lookup + dedup check + emit) now runs inside one `sql.begin`. The narrowed param type (`postgres.Sql`, not `WorkerSql`) lets `.begin` resolve cleanly.
- [x] [Review][Patch] **R1-P152 [HIGH AC4]: `notification.upload_failed` could double-fire after the consumer's own dead-letter** [`services/extraction/src/state-machine/upload-transitions.ts`] — Added an audit-log dedup query: `SELECT EXISTS (SELECT 1 FROM audit_log WHERE resource_id=$1 AND event='notification.upload_failed')` inside the transaction; skip the emit if a row already exists. The pg-boss singleton_key only dedups while the prior `notification.send` job is active/created — once it completes, the second enqueue would succeed.
- [x] [Review][Patch] **R1-P153 [HIGH AC4]: Failed-card recovery CTAs routed to plain `INICIO_ROUTE` — `source` was lost** [`apps/expo/src/app/(tabs)/historico.tsx` + web client] — Added `postOnboardingImportRoute(source)` helper in validators; web + Expo CTAs now route to `?source=post_onboarding[_photo]`.
- [x] [Review][Patch] **R1-P154 [HIGH B1]: Expo card tap navigated to a non-existent route** [`apps/expo/src/app/(tabs)/historico.tsx`] — Replaced hand-built `/uploads/<id>` with `UPLOAD_DETAIL_ROUTE(row.id)` (`/inicio/uploads/<id>`) — the canonical route used elsewhere.
- [x] [Review][Patch] **R1-P155 [HIGH B2]: `notificationsRouter` registration verified** — Confirmed wired in `packages/api/src/root.ts:11`.
- [x] [Review][Patch] **R1-P156 [HIGH AC2]: Push body now prefers `lab_name` over `original_filename` when available** [`services/extraction/src/consumers/notifications.ts`] — Added a correlated subquery for the most-common `observations.lab_name`; falls back to filename for `pending_review`/`failed` paths where no observations have published.
- [x] [Review][Patch] **R1-P157 [HIGH E04]: Expo Push batch > 100 messages would 413** [`services/extraction/src/consumers/notifications.ts`] — Chunked the POST in groups of `EXPO_PUSH_BATCH_SIZE = 100`; tickets accumulate in positional order so the consumer's ticket-token mapping stays correct.
- [x] [Review][Patch] **R1-P158 [HIGH AC4]: Cross-verified reason match between `applyDeadLetter` metadata and notification emission** — Both write `reason: 'storage_unavailable'` / `'retries_exhausted'` / `'no_readable_text'` matching the validators' label map. Documented inline.
- [x] [Review][Patch] **R1-P159 [Med E07]: `INVALID_CURSOR` guard prevents Zod-internals leaking** [`packages/api/src/router/uploads.ts`] — Explicit `Number.isNaN(parsed.getTime())` check throws `BAD_REQUEST` with a clean code.
- [x] [Review][Patch] **R1-P160 [Med B3]: Empty-state copy now distinguishes "no uploads" from "all dismissed"** [`historico.tsx` web + Expo] — `rawRows.length === 0` → "Você ainda não enviou…"; `allDismissed` → "Todos os resultados foram pulados." + "Mostrar pulados".
- [x] [Review][Patch] **R1-P161 [Med B4]: Renamed `empty_extraction` → `no_readable_text`** — AC4 vocabulary; updated `failureReasonLabel` map and the worker emission site.
- [x] [Review][Patch] **R1-P162 [Med B5]: Dynamic `import()` of `emitNotificationEvent` replaced with static top-of-file import** — Cleaner ESM resolution under tsx/vitest; no circular-dep risk.
- [x] [Review][Patch] **R1-P163 [Med AC2]: Documented the mutual-exclusion invariant between the two complete-emit sites** [`packages/api/src/uploads-review.ts`] — Inline comment block explains the singleton_key + state-machine invariants.
- [x] [Review][Patch] **R1-P164 [Med B6]: Added `accessibilityRole` + `accessibilityHint` to the Expo Card** — A11y baseline.
- [x] [Review][Patch] **R1-P165 [Med B7]: Removed the dead `onTouchEnd` block** [`historico.tsx`].
- [x] [Review][Patch] **R1-P166 — Dismissed as false positive**: validators only ship `REGISTER_ROUTE`, not `LOGIN_ROUTE`. Story 2.4's page also used `REGISTER_ROUTE`. Keep as-is.
- [x] [Review][Patch] **R1-P167 — Deferred (Low)**: notification.send queue without explicit dead_letter. Soft loss is acceptable for v1; revisit if telemetry shows persistent push failures.
- [x] [Review][Patch] **R1-P168 [Low B10]: Added a singleton_key dedup test** — covered indirectly by the new `enqueueNotificationSend` test that asserts the SQL contains `ON CONFLICT DO NOTHING`. Full integration coverage deferred to F140.
- [x] [Review][Patch] **R1-P169 [Low B11]: Updated `(tabs)/_layout.tsx` comment** — Reflects new tab order: Início / Histórico / Configurações.
- [x] [Review][Patch] **R1-P170 [Low B12]: Updated File List** — `services/extraction/src/notifications/emit.ts` now listed.

**`defer` (added to deferred-work.md):** F135 (Expo client hook), F136 (push receipts), F137 (multi-device telemetry), F138 (preferences), F139 (RLS adversarial), F140 (SQL snapshot-sync), F141 (lab_name denormalization), F142 (web push).

**Dismissed (~7):** double-tap dispatch (mutation pending state covers); `Notifications.getExpoPushTokenAsync` collision (impossible since deviceId is locally generated); patient-confirm vs worker-direct-publish race (mutually exclusive — see R1-P163); AC copy match (verified verbatim); `pending_review`/`queued`/`processing` non-interactivity (code matches); singleton_key edge case after job completion (covered by R1-P152's audit-log dedup); R1-P166 (`REGISTER_ROUTE` is the available route in validators).

### Change Log

- 2026-05-22 — Code review round 1. **18 patches applied (R1-P150–R1-P170 excluding the dismissed P166/P167), 8 deferred (F135–F142), ~7 dismissed.** The 8 HIGH fixes closed two atomicity gaps that silently dropped push notifications (P150 + P151), a double-fire bug (P152), broken Histórico-card navigation (P153, P154), router-registration verification (P155), AC-mandated lab-name copy in pushes (P156), and Expo Push batch > 100 chunking (P157). Med fixes: cursor cleanup (P159), empty-state copy (P160), AC vocabulary rename (P161), static import (P162), invariant docs (P163), a11y attributes (P164), dead-code removal (P165). Low: comment hygiene (P169), File List spec drift (P170). **168 unit tests green** (+1 R1-P156 lab-name test). Typecheck, lint, format all green.
- 2026-05-22 — Story 2.5 implemented (dev-story). Push-token schema + RLS, paired audit + enqueue in worker + Story 2.4 patient-confirm, notification.send pg-boss consumer, Histórico tab + web page. **167 unit tests green** (+9 this story).
