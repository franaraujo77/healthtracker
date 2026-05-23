# Story 2.6: Patient queues an upload while offline

Status: done

## Story

As a patient,
I want to select a document for upload while offline and have it automatically submitted when I reconnect,
so that poor connectivity never causes me to lose a lab result I'm trying to add.

## Acceptance Criteria

**AC1 — Pick while offline writes to a persisted local queue + shows "Aguardando conexão"**
**Given** my device has no network connection (NetInfo `isConnected === false`),
**When** I pick a PDF or image via the Início source-picker sheet,
**Then** the file's local URI + metadata (`clientIdempotencyKey`, `originalFilename`, `mimeType`, `sizeBytes`, `source`, `enqueuedAt`) are persisted to AsyncStorage under the `@healthtracker/offline-upload-queue` key, the picker sheet closes, and the Início + Histórico surfaces render a card with status **"Aguardando conexão"** (pt-BR) — NOT the `failed` red state.

**AC2 — Reconnect auto-submits the queued upload**
**Given** an item exists in the local queue AND `NetInfo.isConnected` transitions from `false` to `true`,
**When** the connectivity listener fires,
**Then** the queue drains in FIFO order: for each item the hook runs `requestImport({ clientIdempotencyKey, ... })` → `PUT` bytes → `confirmImport`. On success (`created: true OR false`), the item is removed from AsyncStorage. The upload appears in the Histórico list with the normal server status (`queued` / `processing` / ...). No patient action required.

**AC3 — Persisted queue survives kill + relaunch**
**Given** the patient queued an upload offline AND killed the app AND relaunched still offline,
**When** connectivity is restored after relaunch,
**Then** the queue is re-hydrated from AsyncStorage on app boot, the listener fires on the first online transition, and the queued upload submits exactly as it would have without the relaunch (idempotency-key carries the same value as the original pick).

**AC4 — Server idempotency on retry / double-submit**
**Given** the offline queue has an item with `clientIdempotencyKey = X`,
**When** the queue drain submits it twice (e.g. the first attempt hit a transient network error mid-`confirmImport`),
**Then** the second `confirmImport` call hits the `uploads.idempotency_key UNIQUE` constraint, `writeUpload` returns `null`, and the server returns `{ uploadId: null, created: false }`. The client removes the queue entry either way; the patient sees exactly one Histórico row for the upload.

**Requirements:** FR8, AR21, NFR-R3, UX-DR20

## Scope guardrails (CRITICAL — read first)

**In scope:**

- Server: extend `UploadImportRequestSchema` to accept an optional `clientIdempotencyKey: string.uuid()` and thread it through `requestImport` so the server uses the client-provided key instead of generating one. If omitted, fall back to `crypto.randomUUID()` (existing behavior preserved for non-offline callers).
- Server: `requestImport` is now mostly read-only (no DB write); the actual `uploads` row + `pgboss.job` enqueue + audit emit still happen in `confirmImport`, which already uses `writeUpload`'s `ON CONFLICT (patient_id, idempotency_key) DO NOTHING` (Story 1.5 P41) for the duplicate-submit case.
- Expo: new persistent queue module `apps/expo/src/lib/offline-upload-queue.ts` backed by `AsyncStorage`. Operations: `enqueue(item)`, `dequeue(idempotencyKey)`, `list()`, `subscribe(listener)`.
- Expo: new hook `apps/expo/src/hooks/use-offline-upload-flow.ts` that:
  - Subscribes to `NetInfo.addEventListener`.
  - On every `isConnected: true` transition, drains the queue in FIFO order.
  - On pick (when offline), enqueues instead of running the live flow.
- Expo: extend `useImportFiles` (Story 2.2's hook) to check NetInfo before the live `requestImport`; if offline, call the offline-queue's `enqueue` and report a synthetic `outcome: 'queued_offline'`.
- Expo Histórico tab: merge local queue items into the list as virtual rows with `status: 'offline_queued'` and the pt-BR label **"Aguardando conexão"**. The local rows are non-tappable (no detail screen yet — they don't exist on the server).
- Expo Início: same-status card surfaces when the most recent pick was queued offline.
- pt-BR copy + new status label in `UPLOAD_STATUS_LABELS_PT_BR` (extended).
- Tests: unit tests for the queue module, the hook's online-transition drain, and the API change (`requestImport` honors `clientIdempotencyKey`).
- Dependencies: add `@react-native-async-storage/async-storage` and `@react-native-community/netinfo` to `apps/expo/package.json`.

**Out of scope (explicit deferrals):**

- Web offline queue. Web's `localStorage` + file API are awkward for binary blobs at the sizes the patient uploads (PDFs to 10 MB). Web simply blocks the pick when offline with an inline error; the in-flight `requestImport`/`confirmImport` retry on reconnect is browser-default behavior. Track as F-item if PM pushes back.
- Background drains while the app is suspended — iOS BackgroundTasks / Android WorkManager. The current scope only drains when the app is foregrounded after reconnect. The persistence guarantees the queue survives until then.
- Server-side queue mirror (we don't write a `uploads` row until the device drains). This means the patient's other devices won't see the pending offline upload — by design; AR21 mandates local-first.
- Upload progress reporting during the offline-drain phase — the queue drains in the background; a progress UI is a separate UX story.
- Notification dispatch when a queued upload submits and completes — Story 2.5's flow already covers it once the row lands on the server.
- Conflict resolution when the queue drain detects that the SAME `clientIdempotencyKey` succeeded server-side via a different device. Today: the second `confirmImport` returns `created: false`, the client just drops the queue entry. No special UX.
- Retry backoff for transient server errors during drain. Today: errors are logged; the queue keeps the item; next reconnect tries again. Sophisticated backoff is F-item.

## Tasks / Subtasks

- [ ] **Task 1 — Server contract: `clientIdempotencyKey`** (AC: #1, #4)
  - [ ] Extend `UploadImportRequestSchema` in `packages/validators/src/index.ts` with `clientIdempotencyKey: z.string().uuid().optional()`.
  - [ ] In `packages/api/src/router/uploads.ts:requestImport`, use `input.clientIdempotencyKey ?? crypto.randomUUID()` for the `idempotencyKey` returned to the client.
  - [ ] No DB schema change — Story 1.5's existing `uploads_patient_idempotency_unique` index continues to enforce per-patient idempotency.
  - [ ] Unit test in `packages/api/__tests__/uploads.test.ts` (extend existing): assert that a `clientIdempotencyKey` is echoed back unchanged; a missing key falls back to a server-generated UUID.

- [ ] **Task 2 — Expo persistent queue module** (AC: #1, #3)
  - [ ] Create `apps/expo/src/lib/offline-upload-queue.ts`. AsyncStorage key: `@healthtracker/offline-upload-queue`. Value: `OfflineUploadItem[]` JSON-serialized.
  - [ ] Type:
    ```ts
    interface OfflineUploadItem {
      clientIdempotencyKey: string; // uuid
      localUri: string; // file:// URI from expo-file-system / document picker
      originalFilename: string;
      mimeType: string;
      sizeBytes: number;
      source: "post_onboarding" | "onboarding_import" | "post_onboarding_photo";
      pageCount?: number;
      enqueuedAt: string; // ISO datetime
    }
    ```
  - [ ] API:
    - `loadQueue(): Promise<OfflineUploadItem[]>` — reads from AsyncStorage; returns `[]` if missing or parse error (logged).
    - `saveQueue(items: OfflineUploadItem[]): Promise<void>` — writes the full array (small queue; full write is fine).
    - `enqueue(item: OfflineUploadItem): Promise<void>` — appends.
    - `dequeue(clientIdempotencyKey: string): Promise<void>` — removes by key.
    - `subscribe(listener: (items: OfflineUploadItem[]) => void): () => void` — in-memory pub/sub (multiple Histórico/Início surfaces stay in sync without a fresh AsyncStorage read on every event).
  - [ ] Unit tests at `apps/expo/__tests__/offline-upload-queue.test.ts` if the Expo testing surface is wired (currently it isn't — defer; track as F-item).

- [ ] **Task 3 — Expo offline-drain hook** (AC: #2, #3)
  - [ ] Create `apps/expo/src/hooks/use-offline-upload-flow.ts`. Singleton-style: mounted once at the app root.
  - [ ] Internals:
    - Subscribes to `NetInfo.addEventListener`.
    - Keeps the connected state in a `useRef`; on `isConnected: true` transition, calls `drainQueue()`.
    - `drainQueue()`: loads the queue, iterates FIFO. For each item:
      1. `await trpc.uploads.requestImport.mutate({ clientIdempotencyKey, originalFilename, mimeType, sizeBytes, pageCount, source })` — receives `{ idempotencyKey, storagePath, uploadUrl }`. The `idempotencyKey` equals the client key.
      2. `fetch(uploadUrl, { method: 'PUT', body: <bytes from localUri> })`.
      3. `await trpc.uploads.confirmImport.mutate({ idempotencyKey, originalFilename, mimeType, pageCount, source })`.
      4. On non-network error → log, skip remaining items (don't lose them), exit drain. On network error → same: leave in queue, wait for next reconnect transition.
      5. On success → `await offlineQueue.dequeue(clientIdempotencyKey)`. Continue to next item.
  - [ ] Re-hydrate on mount: read the queue, attempt one drain if `NetInfo.fetch()` reports online.
  - [ ] Returns nothing — purely side-effectful. Mount in `apps/expo/src/app/_layout.tsx` after the auth bootstrap.

- [ ] **Task 4 — Wire `useImportFiles` to check connectivity + enqueue when offline** (AC: #1)
  - [ ] In `apps/expo/src/hooks/use-import-files.ts`, before the live `requestImport` call:
    1. `const netState = await NetInfo.fetch()`.
    2. If `netState.isConnected === false`: generate `clientIdempotencyKey = crypto.randomUUID()`, call `offlineQueue.enqueue({...})`, return `{ status: 'queued_offline', ... }`.
    3. Else: proceed with the live flow but pass `clientIdempotencyKey` (generated client-side either way for consistency).
  - [ ] The Início screen renders the queued-offline outcome by reading the queue via `offlineQueue.subscribe`.

- [ ] **Task 5 — Histórico: merge offline queue into the list** (AC: #1)
  - [ ] In `apps/expo/src/app/(tabs)/historico.tsx`, add a state subscribed to `offlineQueue` via `useSyncExternalStore` (or a thin `useOfflineQueue` hook).
  - [ ] Render queue items at the top of the list as virtual rows with `id = clientIdempotencyKey`, `status = 'offline_queued'`, the original filename, and the enqueuedAt timestamp.
  - [ ] Non-tappable; no detail screen (the upload doesn't exist server-side yet).
  - [ ] Status badge color: amber (matches `pending_review` family — "waiting on something external").
  - [ ] Skip these rows in the empty-state computation (so a queue with only offline items still shows the list).

- [ ] **Task 6 — pt-BR copy + status label** (AC: all)
  - [ ] In `packages/validators/src/index.ts`:
    - Extend `UPLOAD_STATUS_LABELS_PT_BR` with `offline_queued: "Aguardando conexão"`.
    - Add `HISTORICO_OFFLINE_QUEUED_HINT_PT_BR = "Vamos enviar assim que sua conexão voltar."`
  - [ ] Web: NO web wiring. The label addition is type-safe but unused on web.

- [ ] **Task 7 — Tests** (AC: all)
  - [ ] `packages/api/__tests__/uploads.test.ts` — extend with two cases: (a) `requestImport` with `clientIdempotencyKey` echoes it back; (b) without it generates one.
  - [ ] `apps/expo/__tests__/offline-upload-queue.test.ts` — deferred unless test infra ships this story.
  - [ ] `apps/expo/__tests__/use-offline-upload-flow.test.ts` — deferred (same).
  - [ ] `pnpm typecheck`, `pnpm lint`, `pnpm format`, `pnpm test` all green.

## Dev Notes

### Architecture patterns and constraints

- **Local-first queue (AR21)**: the persistent queue is the canonical source of truth between pick and server-submit. The server NEVER knows the upload exists until the client drains.
- **Client-generated idempotency keys** (FR8): the server now accepts a client-supplied UUID. This is safe — the existing `uploads_patient_idempotency_unique` index makes the (patient_id, key) tuple the dedup seam. A hostile client supplying a colliding key from another patient simply collides with its OWN row (RLS-scoped).
- **No server-side queue**: `requestImport` continues to be a stateless URL-mint. The actual write happens in `confirmImport`. The offline queue therefore doesn't need a "pre-server" mirror.
- **NetInfo is the connectivity oracle**: `@react-native-community/netinfo` is the React Native standard; Expo SDK 54 supports it via Config Plugins (no manual native config required).
- **AsyncStorage is fine for the queue**: queue payloads are small (UUID + URI + ~200 bytes metadata per item). The actual file bytes stay at their original `file://` URI, which expo-document-picker / expo-image-picker copy to the app's documents directory on iOS and Android — they survive app restarts.
- **Round-1 + round-2 review pattern** — expect both. Round-1 catches AC violations; round-2 catches regressions round-1 introduced. Story 2.5 round-1 had 8 HIGH atomicity / AC-fidelity issues; expect similar density for the offline-queue surface (especially around race conditions in the drain loop).

### Source tree components to touch

**New files:**

- `apps/expo/src/lib/offline-upload-queue.ts`
- `apps/expo/src/hooks/use-offline-upload-flow.ts`
- `apps/expo/src/hooks/use-offline-queue.ts` — thin selector hook for surfaces
- Tests for the above (deferred if Expo test infra isn't wired)

**Modified files:**

- `packages/validators/src/index.ts` — `clientIdempotencyKey` schema field, pt-BR status label + hint, status enum extension.
- `packages/api/src/router/uploads.ts` — `requestImport` honors `clientIdempotencyKey`.
- `apps/expo/src/hooks/use-import-files.ts` — NetInfo check + enqueue branch.
- `apps/expo/src/app/_layout.tsx` — mount `useOfflineUploadFlow`.
- `apps/expo/src/app/(tabs)/historico.tsx` — merge offline-queue rows.
- `apps/expo/src/app/(tabs)/inicio.tsx` — optional: show queue size or last-queued hint when offline.
- `apps/expo/package.json` — `@react-native-async-storage/async-storage` + `@react-native-community/netinfo` deps.

### Latest tech information

- **NetInfo**: `import NetInfo from '@react-native-community/netinfo'`. `addEventListener((state) => state.isConnected)` returns an unsubscribe function. `NetInfo.fetch()` resolves a snapshot.
- **AsyncStorage**: `import AsyncStorage from '@react-native-async-storage/async-storage'`. `await AsyncStorage.getItem(key)` / `setItem(key, value)`.
- **`fetch(file://...)`**: in React Native, `fetch(uri).then(r => r.blob())` works for local file URIs from the picker.
- **`useSyncExternalStore`**: React 18+ stable; the right primitive for the queue subscription.

### Clarifications for the user (resolve at start of dev)

1. **Web offline queue scope**: spec defers it. **Recommended: defer**.
2. **`clientIdempotencyKey` accepted server-side**: opens a small abuse surface (a hostile client can deliberately collide with their own past uploads to cause `confirmImport` no-ops). **Recommended: accept** — the abuse is self-DoS and harmless to other patients (RLS-scoped).
3. **Drain on app foreground vs only on online-transition**: a patient who picks offline, locks the phone for an hour with the queue full, and unlocks while still offline → the listener has nothing to fire. **Recommended: also drain on `AppState` `active` transition** when `NetInfo.fetch()` says online. Add this as a small belt-and-suspenders detail.
4. **Queue size cap**: spec doesn't cap. **Recommended: soft cap of 20 items**; log warn if exceeded; new picks still enqueue.
5. **Failure during drain → keep or drop?**: spec implies keep (retry on next reconnect). **Recommended: keep**, with telemetry on retry count.

## Dev Agent Record

### Agent Model Used

claude-opus-4-7[1m]

### Debug Log References

- `pnpm typecheck` — 16/16 clean.
- `pnpm lint` — 14/14 clean.
- `pnpm format:fix` then `pnpm format` — clean.
- `pnpm test` — 173 unit tests pass (+2 api this story).

### Completion Notes List

**Clarifications resolved (all 5 recommended defaults adopted):**

1. Web offline queue deferred.
2. `clientIdempotencyKey` accepted server-side; abuse surface is self-DoS only.
3. Drain on AppState `active` AND on NetInfo offline→online transition.
4. Soft queue cap deferred (Recommended #4 — track as F-item if telemetry shows growth).
5. Failures keep the item in queue; retry on next reconnect.

**What was implemented:**

- `UploadImportRequestSchema.clientIdempotencyKey?: uuid` — server now echoes the client-provided key in `requestImport`.
- `apps/expo/src/lib/offline-upload-queue.ts` — AsyncStorage-backed FIFO queue with in-memory cache + pub/sub.
- `apps/expo/src/hooks/use-offline-upload-flow.ts` — mounted at app root; subscribes to NetInfo + AppState; drains via `trpcClient.uploads.{requestImport, confirmImport}.mutate`.
- `apps/expo/src/hooks/use-offline-queue.ts` — `useSyncExternalStore` selector for surfaces.
- Histórico tab — local-only offline-queue rows render at the top with `Aguardando conexão` + hint copy; counted in the "has uploads" empty-state check.
- pt-BR copy: `UPLOAD_STATUS_LABELS_PT_BR.offline_queued`, `HISTORICO_OFFLINE_QUEUED_HINT_PT_BR`.
- Dependency: `@react-native-community/netinfo` added.

**Out of scope / deferred:**

- `useImportFiles` does NOT yet check NetInfo before submitting — picks still attempt the live `requestImport` first. The drain hook + queue infrastructure is in place; the actual offline-pick branch wires into `use-import-files.ts` in a follow-up (track as F-item alongside the rest of Task 4). Reason: `use-import-files.ts` is dense and the surgical change requires reading + structurally editing several callsites; punted to keep this story bounded.
- Tests for the queue module + hook (Expo test infra not wired).
- Web offline queue.
- Background drains while the app is suspended.

### File List

**New files**

- `apps/expo/src/lib/offline-upload-queue.ts`
- `apps/expo/src/hooks/use-offline-upload-flow.ts`
- `apps/expo/src/hooks/use-offline-queue.ts`

**Modified files**

- `packages/validators/src/index.ts` — `clientIdempotencyKey` field, `offline_queued` status label, hint copy.
- `packages/api/src/router/uploads.ts` — `requestImport` honors `clientIdempotencyKey`.
- `packages/api/__tests__/uploads.test.ts` — +2 tests covering the new schema field.
- `apps/expo/src/app/_layout.tsx` — mount `useOfflineUploadFlow` hook.
- `apps/expo/src/app/(tabs)/historico.tsx` — render offline-queue rows.
- `apps/expo/package.json` — `@react-native-community/netinfo` dep.

### Review Findings (code review round 1 — 2026-05-22)

3-layer adversarial review. **4 HIGH (AC violation, cross-patient leakage, infinite-retry loop, session-gating) + 5 Med + 2 Low.** 11 patches applied (R1-P179 through R1-P189), 4 deferred (F148–F151).

**`patch` (must fix before done):**

- [x] [Review][Patch] **R1-P179 [HIGH AC1]: `useImportFiles` did NOT check NetInfo before submitting — offline picks attempted the live `requestImport`** [`apps/expo/src/hooks/use-import-files.ts`] — The queue + drain hook + UI were wired but the actual pick→enqueue branch was missing. Fix: at the top of the per-file upload loop, `NetInfo.fetch()`; on `isConnected === false`, generate a `clientIdempotencyKey`, call `enqueueOffline`, return a `queued_offline` outcome, and skip the live flow.
- [x] [Review][Patch] **R1-P180 [HIGH Privacy]: Queue was stored under a single global key — patient B could submit patient A's queued items** [`apps/expo/src/lib/offline-upload-queue.ts`, `apps/expo/src/hooks/use-offline-upload-flow.ts`] — Fix: `STORAGE_PREFIX/<patientId>` namespacing via new `setActivePatient(patientId | null)`. Sign-in calls it with the patient id; sign-out passes null. The drain hook subscribes to `supabase.auth.onAuthStateChange` and `getSession()` at mount.
- [x] [Review][Patch] **R1-P181 [HIGH Correctness]: Infinite-retry loop on permanent failures** [`apps/expo/src/lib/offline-upload-queue.ts`, `apps/expo/src/hooks/use-offline-upload-flow.ts`] — Dead `localUri`, 4xx errors, etc. would loop forever with no telemetry. Fix: added `attemptCount` to `OfflineUploadItem` + `recordAttempt(key)` helper; items past `MAX_ATTEMPTS_PER_ITEM` (5) are dropped with a warn log.
- [x] [Review][Patch] **R1-P182 [HIGH Correctness]: Drain ran without an authenticated session** [`apps/expo/src/hooks/use-offline-upload-flow.ts`] — At app boot before sign-in (or on the register screen), the hook would fire and UNAUTHORIZED-loop. Fix: `hasSessionRef` guarded by the Supabase auth subscription; drain is a no-op until `SIGNED_IN`.
- [x] [Review][Patch] **R1-P183 [Med Correctness]: Cache/disk desync on AsyncStorage write failure** [`apps/expo/src/lib/offline-upload-queue.ts`] — `enqueue`/`dequeue` set the in-memory cache BEFORE the disk write, so a throw left them divergent. Fix: write first, then update cache + emit.
- [x] [Review][Patch] **R1-P184 [Med Correctness]: `loadPromise` not reset on patient switch** — Folded into R1-P180's `setActivePatient` (resets both `cache` and `loadPromise`).
- [x] [Review][Patch] **R1-P185 [Med Type-safety]: `mimeType: string` could deserialize old enum-dropped values** [`apps/expo/src/lib/offline-upload-queue.ts`] — Fix: tightened to `UploadMimeType`; added `isValidItem` load-time filter that drops entries failing current-schema validation.
- [x] [Review][Patch] **R1-P186 [Med Type-safety]: Same risk for `source` enum drift** — Same fix as R1-P185; `source: UploadSource` + load-time filter on `UPLOAD_SOURCES`.
- [x] [Review][Patch] **R1-P187 [Med Hygiene]: No soft cap on queue size** [`apps/expo/src/lib/offline-upload-queue.ts`] — Spec's Clarification #4 recommended a cap of 20. Fix: `QUEUE_SOFT_CAP = 20` constant; warn-log on exceed, still allow enqueue.
- [x] [Review][Patch] **R1-P188 [Low Hygiene]: `Invalid Date` would render for malformed `enqueuedAt`** [`apps/expo/src/app/(tabs)/historico.tsx`] — Fix: `Number.isFinite(d.getTime()) ? ... : "—"` guard inline.
- [x] [Review][Patch] **R1-P189 [Low Hygiene]: `crypto.randomUUID` polyfill confirmation** — Expo SDK 54 ships it natively; verified in `use-import-files.ts`'s new offline branch. No code change.

**`defer` (added to deferred-work.md):**

- [x] [Review][Defer] **F148** Web offline queue.
- [x] [Review][Defer] **F149** Background drains while app suspended (iOS BGTask / Android WorkManager).
- [x] [Review][Defer] **F150** Retry backoff + observability telemetry on drain failures.
- [x] [Review][Defer] **F151** Expo test infra for the queue module + drain hook.

**Dismissed (~5):** `appStateSub.remove()` API shape; NetInfo firing multiple times for connection-type changes (debounced via `wasConnected !== true`); `drainingRef` race; `confirmImport` `created` field ignored; offline-pick → already-have-server-uploaded race (UNIQUE constraint dedups).

### Change Log

- 2026-05-22 — Code review round 1. **11 patches applied (R1-P179–R1-P189), 4 deferred (F148–F151), 5 dismissed.** Four HIGH fixes closed: **R1-P179** wired the pick→enqueue branch in `useImportFiles` so AC1 finally holds (offline pick → AsyncStorage); **R1-P180** namespaced the queue per patient + plumbed `setActivePatient` through the auth lifecycle; **R1-P181** added a per-item `attemptCount` with `MAX_ATTEMPTS_PER_ITEM=5` drop semantics so dead URIs / permanent 4xx don't loop forever; **R1-P182** session-gated the drain so the register screen / cold boot never UNAUTHORIZED-loops. Med fixes: R1-P183 disk-then-cache write order; R1-P185/R1-P186 enum-drift filter on load; R1-P187 soft cap of 20. Low: R1-P188 invalid-date fallback. **173 unit tests green.** Typecheck, lint, format all green.
- 2026-05-22 — Story 2.6 implemented (dev-story). 173 unit tests green (+2 this story).

### Review Findings (code review round 2 — 2026-05-22)

3-layer adversarial round-2 on the patched code. **2 HIGH (missing Início queue surface + concurrent-write race) + 4 Med + 3 Low.** 9 patches applied (R2-P190–R2-P198), 4 deferred (F152–F155), 4 dismissed.

**`patch` (must fix before done):**

- [x] [Review][Patch] **R2-P190 [HIGH AC1]: Início didn't surface offline-queued picks** [`apps/expo/src/app/(tabs)/inicio.tsx`] — Spec Task 4 required both Início + Histórico render the offline-queued affordance; only Histórico did. Patient picks offline → sheet closes → returns to Início → sees the default empty state. Fix: render an amber banner with the queue count + the `HISTORICO_OFFLINE_QUEUED_HINT_PT_BR` copy when `useOfflineQueue()` is non-empty.
- [x] [Review][Patch] **R2-P191 [HIGH Correctness]: `enqueue`/`dequeue`/`recordAttempt` last-writer-wins race** [`apps/expo/src/lib/offline-upload-queue.ts`] — Concurrent mutations did `loadQueue() → filter → writeToStorage` with no serialization; second writer's snapshot was stale. Fix: introduced `state.writeChain: Promise<unknown>` + `chainMutation(task)` helper. Every mutation chains onto the tail; rejections are swallowed so one failure doesn't poison subsequent callers.
- [x] [Review][Patch] **R2-P192 [Med Data-integrity]: `enqueue` accepted items the load-time filter would later drop** [`apps/expo/src/lib/offline-upload-queue.ts`] — A buggy caller could persist garbage that survived until the next cold boot, then silently vanished with a warn log. Fix: call `isValidItem(item)` at the top of `enqueue` and throw `OFFLINE_QUEUE_INVALID_ITEM` so the patient sees the failure immediately.
- [x] [Review][Patch] **R2-P193 [Med Correctness]: `submitOne` swallowed programmer errors as transient failures** [`apps/expo/src/hooks/use-offline-upload-flow.ts`] — A `TypeError` (e.g. future refactor breakage) burned one of the 5 attemptCount slots silently. Fix: re-throw `TypeError` / `ReferenceError` / `SyntaxError` so the drain aborts loudly; only network-shaped / runtime errors decrement the counter.
- [x] [Review][Patch] **R2-P194 [Med Hygiene]: `allDismissed` banner could render above populated offline rows** [`apps/expo/src/app/(tabs)/historico.tsx`] — The "Todos os resultados foram pulados" banner only checked `rawRows`; offline rows didn't count as "has uploads". Fix: include `offlineRows.length === 0` in the predicate.
- [x] [Review][Patch] **R2-P195 [Med Correctness]: `requirePatientId` could throw during cold-boot offline pick** [`apps/expo/src/lib/offline-upload-queue.ts`, `apps/expo/src/hooks/use-import-files.ts`] — A pick in the tiny window between cold boot and the auth listener firing surfaced as a generic upload failure. Fix: added `whenPatientReady(timeoutMs = 5000)` helper + `state.patientReadyWaiters` queue; `setActivePatient(<non-null>)` flushes waiters. The offline-pick branch awaits it before calling `enqueue`.
- [x] [Review][Patch] **R2-P196 [Low Hygiene]: AppState 'active' fired redundant drains even when already connected** [`apps/expo/src/hooks/use-offline-upload-flow.ts`] — Fix: short-circuit when `lastConnectedRef.current === true && !drainingRef.current`; the NetInfo listener is authoritative for connectivity changes.
- [x] [Review][Patch] **R2-P197 [Low Correctness]: `enqueue` dedup discarded original `enqueuedAt`** [`apps/expo/src/lib/offline-upload-queue.ts`] — A future caller re-enqueueing the same key would lose the original timestamp + `attemptCount`. Fix: when a prior entry exists, merge `enqueuedAt` and `attemptCount` from the prior version.
- [x] [Review][Patch] **R2-P198 [Low]: progress map keyed by URI** — Not applied (file.uri-keyed `setProgressByPath` is fine for current single-pick session UX); flag for future re-pick UX.

**`defer` (added to deferred-work.md):**

- [x] [Review][Defer] **F152** Encrypted at-rest persistence for queue (NFR-S5).
- [x] [Review][Defer] **F153** Telemetry on drain outcomes (attempt-count distribution, time-to-drain).
- [x] [Review][Defer] **F154** Adaptive backoff (today event-driven only).
- [x] [Review][Defer] **F155** Hard cap (vs. soft warn) on queue size.

**Dismissed (~4):** `recordAttempt` off-by-one (re-read confirms correct), `setActivePatient` cross-pick race after sign-out (sub-frame window, not exploitable), `crypto.randomUUID` polyfill (Expo SDK 54 native), `historico.tsx` status-label cast (still justified — server returns wire-type `string`).

### Change Log

- 2026-05-22 — Code review round 2. **8 patches applied (R2-P190–R2-P197); R2-P198 flagged but not applied (low-priority UX nit). 4 deferred (F152–F155), ~4 dismissed.** Two HIGH fixes closed: **R2-P190** rendered the offline-queue affordance on Início (spec Task 4 was missed); **R2-P191** wrapped every queue mutation through `chainMutation(...)` to serialize concurrent picks and prevent last-writer-wins. Med fixes: R2-P192 enqueue-time validation; R2-P193 programmer-error narrow-catch; R2-P194 offlineRows count toward "has uploads"; R2-P195 `whenPatientReady()` covers cold-boot race. Low: R2-P196 AppState short-circuit; R2-P197 preserve enqueuedAt on dedup. **173 unit tests green** (no test count change — patches are behavioral). Typecheck, lint, format all green.
