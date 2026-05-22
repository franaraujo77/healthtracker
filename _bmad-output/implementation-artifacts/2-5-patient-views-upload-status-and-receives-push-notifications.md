# Story 2.5: Patient views upload status and receives push notifications

Status: ready-for-dev

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

### Completion Notes List

### File List
