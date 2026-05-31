# Story 7.4: Patient records a voice memo at the time of upload (Vision)

Status: done

<!-- Fourth story of Epic 7. Stacks on Stories 7.1 + 7.2 + 7.3 + 7.5 / PR #59. -->
<!-- Vision-tagged in the epic spec — non-MVP-blocker. The patient's qualitative-context surface for an upload. Mirrors the personal-context table pattern established by Stories 7.1 (life_events) and 7.2 (emotional_checkins): denial-by-RLS-absence, audit kind out of `ACCESS_LOG_EVENT_KINDS`, no `apps/web/` surface. -->

## Story

As a **patient who has just uploaded a new lab result**,
I want **to record an optional voice memo (up to 30 seconds) capturing what was happening in my life when I took this test**,
so that **I have a qualitative record alongside the biomarker numbers, kept strictly private until I explicitly choose to share it with a specific doctor — which is a future Epic 7 concern, not this story**.

## Acceptance Criteria

> AC1–AC4 lifted from `_bmad-output/planning-artifacts/epics.md` lines 1693–1716. AC5–AC12 lock the implementation contract.

1. **AC1 — Voice-memo Tier-2 CTA on the upload detail screen; permission gate + 30-second recording UI.**
   **Given** I am on the upload detail screen (`apps/expo/src/app/uploads/[uploadId].tsx`) for an upload whose `status ∈ {queued, processing, pending_review, complete}` AND `hasVoiceMemo === false`,
   **When** I tap a NEW Tier-2 CTA "Adicionar memo de voz" rendered at the bottom of the screen,
   **Then** the iOS / Android microphone permission is requested via `expo-audio`'s `useAudioRecorderState` / permission hook if not yet granted. **And** when permission is granted, a recording sheet opens with: a circular Record button (large, primary), a live mm:ss timer counting up from 00:00 to 00:30 max, a stop button, a Pular link, and a small footer line "Máximo 30 segundos · Apenas para você".

2. **AC2 — Save attaches the audio to the `uploads` row via a new `voice_memos` table.**
   **Given** I record audio (any duration 0 < d ≤ 30000ms) and tap Salvar,
   **When** the upload completes,
   **Then** the audio file lands at the Supabase Storage path `voice_memos/<patient_id>/<voice_memo_id>.m4a` (private bucket) AND a row is INSERTed into NEW table `voice_memos` with `patient_id = ctx.session.user.id`, `upload_id = <screen's uploadId>`, `storage_path = '<patient_id>/<voice_memo_id>.m4a'`, `duration_ms`, `privacy_flag = 'patient_only'` (NEW pgEnum `voice_memo_privacy_enum` with single value — deferred unification with Story 7.2's enum per CLAUDE.md), `created_at`. The audio MUST never appear in any doctor RLS scope (denial-by-RLS-absence; AC8 RLS matrix locks).

3. **AC3 — Auto-stop at 30s with pt-BR limit message.**
   **Given** I am recording,
   **When** the timer reaches **30000 ms**,
   **Then** the recording auto-stops via `recorder.stop()`, the timer freezes at 00:30, and a pt-BR line surfaces inline: `"Limite de 30 segundos atingido."` (constant `VOICE_MEMO_LIMIT_REACHED_PT_BR`). The Save button remains enabled; the patient saves what they recorded or taps Pular to discard.

4. **AC4 — Pular cancels with no record + no storage object created.**
   **Given** I tap "Pular" at ANY point (before Record, during Record, or after Record before Save),
   **When** the skip handler fires,
   **Then** any in-progress recording is stopped + cleaned up via `recorder.cleanup()`, any local file URI is removed via `expo-file-system`'s `deleteAsync`, NO row is inserted into `voice_memos`, NO object lands in Storage, NO audit row is written. The sheet closes; the upload detail screen remains unchanged.

5. **AC5 — `voiceMemos.attachToUpload` resolver writes the row with FK + ownership + storage-existence validation.**
   **Given** the client uploads the file directly to Supabase Storage via the patient's authenticated client (Storage RLS scopes to `<patient_id>/...` paths) and THEN calls the resolver,
   **When** `voiceMemos.attachToUpload({ uploadId, storagePath, durationMs })` runs,
   **Then** the resolver performs (in order):
   - Ownership precondition (R1-H2 carry-forward from Story 7.2): `SELECT 1 FROM uploads WHERE id=? AND patient_id=?` → throw `NOT_FOUND/UPLOAD_NOT_FOUND` if absent.
   - Storage-path-format validation: the `storage_path` MUST start with `<patientId>/` (literal string prefix) — defense-in-depth against a forged path that would otherwise INSERT a row pointing to a different patient's folder. Throw `BAD_REQUEST/INVALID_STORAGE_PATH` if absent.
   - Duration validation: `0 < durationMs ≤ 30000` (Zod schema also enforces this; the DB CHECK constraint is the third layer).
   - Storage-existence probe via Supabase service-role client (`supabase.storage.from('voice_memos').list(...)` filtered by the basename) → throw `NOT_FOUND/STORAGE_OBJECT_MISSING` if absent (orphan-INSERT shield).
   - INSERT with narrow 23505 catch on the `(upload_id)` UNIQUE constraint (AC9) — return the existing row on idempotent retry; no second audit write.
   - Audit write `event='voice_memo.recorded'` with `metadata={ uploadId, durationMs }` (NO `storagePath` — even though path is patient-scoped, audit metadata stays minimal; mirrors Story 7.2's PII discipline).

6. **AC6 — `voice_memo.recorded` audit kind NOT in `ACCESS_LOG_EVENT_KINDS`.**
   **Given** voice memos are private patient-authored personal context with `privacy_flag = 'patient_only'`,
   **Then** `'voice_memo.recorded'` is deliberately excluded from `ACCESS_LOG_EVENT_KINDS` in `packages/validators/src/sharing.ts`. Same rationale as `life_event.created` (Story 7.1) and `emotional_checkin.recorded` (Story 7.2): personal context is not a doctor-access narrative event.

7. **AC7 — `getUploadDetailForPatient` returns `hasVoiceMemo: boolean` so the UI can gate the CTA.**
   **Given** the upload detail screen must hide the CTA after the memo is attached,
   **Then** `getUploadDetailForPatient` adds a third existence probe analogous to `hasPreEmotionalCheckIn` / `hasPostEmotionalCheckIn` (Stories 7.2 / 7.3): a `SELECT count(*) FROM voice_memos WHERE upload_id=? AND patient_id=?`. The CTA in the upload detail screen is gated on `hasVoiceMemo === false`.

8. **AC8 — Defensive RLS matrix (4 identities) locks the `voice_memos` invariant.**
   **Given** `voice_memos` is the third Epic 7 personal-context table,
   **Then** a RLS test file `packages/db/__tests__/rls/voice_memos.rls.test.ts` exercises the same 4-identity matrix established by Stories 7.1 + 7.2: `correctPatient` (1 row), `wrongPatient` (0 rows), `doctorWithAccess` (0 rows), `doctorWithoutAccess` (0 rows). The denial-by-RLS-absence pattern is the load-bearing assertion.

9. **AC9 — Composite invariants: `UNIQUE (upload_id)`, FK cascades, duration CHECK.**
   - `UNIQUE (upload_id)` — one memo per upload (a re-record would need to DELETE first; deferred to a future story).
   - `patient_id` references `users(id) ON DELETE CASCADE` (Story 5.6 LGPD discipline).
   - `upload_id` references `uploads(id) ON DELETE CASCADE` (the memo is bound to the draw; if the draw goes, so does the memo).
   - CHECK `duration_ms > 0 AND duration_ms <= 30000` — DB-layer mirror of AC3.
   - Index `(patient_id, created_at desc)` for the eventual personal-history listing (Story 7.3's `listPairs` analog; out of scope for 7.4).

10. **AC10 — pt-BR copy + `expo-audio` dependency + microphone permission strings.**
    - NEW validator constants: `VOICE_MEMO_CTA_PT_BR = "Adicionar memo de voz"`, `VOICE_MEMO_RECORDER_TITLE_PT_BR = "Conte como você está se sentindo"`, `VOICE_MEMO_RECORD_PT_BR = "Gravar"`, `VOICE_MEMO_STOP_PT_BR = "Parar"`, `VOICE_MEMO_SAVE_PT_BR = "Salvar"`, `VOICE_MEMO_SKIP_PT_BR = "Pular"`, `VOICE_MEMO_PRIVACY_HINT_PT_BR = "Máximo 30 segundos · Apenas para você"`, `VOICE_MEMO_LIMIT_REACHED_PT_BR = "Limite de 30 segundos atingido."`, `VOICE_MEMO_PERMISSION_DENIED_PT_BR = "Permita o acesso ao microfone para gravar."`, `VOICE_MEMO_SAVED_PT_BR = "Memo de voz salvo."`, `VOICE_MEMO_SAVE_ERROR_PT_BR = "Não conseguimos salvar — tente novamente."`.
    - `expo-audio` added as a dep to `apps/expo/package.json` (NOT `packages/ui` — native-only).
    - `NSMicrophoneUsageDescription` added to `apps/expo/app.config.ts` `ios.infoPlist` AND the `expo-audio` plugin's `microphonePermission` field. Android `RECORD_AUDIO` permission added via `android.permissions`.

11. **AC11 — No web app surface; no Storage bucket creation in this story.**
    - Zero changes to `apps/web/`.
    - The `voice_memos` Storage bucket creation SQL ships in Story 7.6's batched migration (`CREATE bucket + RLS policies for `<patient_id>/...` scope`). Dev path: the bucket is created manually on the dev project (one-time admin step documented in Completion Notes). The resolver's storage-existence probe gracefully treats a missing bucket as the same `STORAGE_OBJECT_MISSING` error — no separate error surface.

12. **AC12 — UI architectural seam: `VoiceMemoRecorder` component lives in `packages/ui` as a Tamagui shell + `renderRecorder` slot (Story 7.5 pattern carry-forward).**
    Same rationale as Story 7.5's `LifeEventSheet.renderDateField`: `expo-audio` is native-only and would break the web bundle. The slot prop receives `(props: { onRecordingComplete: (uri: string, durationMs: number) => void; onError: (e: Error) => void; isRecording: boolean }) => ReactNode`. The recording state + timer + auto-stop logic live inside the slot's implementation in `apps/expo/`.

**Requirements traceability:** FR51 (Vision), AR10 (audit), UX-DR20 (pt-BR + WCAG AA contrast), NFR-S2 (RLS), NFR-S4 (audit append-only).

---

## Tasks / Subtasks

- [ ] **Task 1 — Schema + RLS (AC2, AC8, AC9)**
  - [ ] 1.1 Create `packages/db/src/schema/voice_memos.ts`: pgEnum `voiceMemoPrivacyEnum` (single value `patient_only`); table `VoiceMemos` with the columns from AC9. UNIQUE on `(upload_id)` and CHECK constraint on duration.
  - [ ] 1.2 Add `export * from "./voice_memos"` to `packages/db/src/schema/index.ts`.
  - [ ] 1.3 Create `packages/db/policies/custom_rls_voice_memos.sql` with SELECT-own + INSERT-own (same shape as `custom_rls_emotional_checkins.sql`). No UPDATE/DELETE/doctor policy.
  - [ ] 1.4 Create `packages/db/__tests__/rls/voice_memos.rls.test.ts` — 4-identity matrix per AC8.

- [ ] **Task 2 — Validators (AC10)**
  - [ ] 2.1 Create `packages/validators/src/voice-memos.ts`: `VOICE_MEMO_MAX_DURATION_MS = 30000`, copy constants per AC10, `attachVoiceMemoInputSchema` (strict; `uploadId` uuid, `storagePath` non-empty string, `durationMs` int 1..30000), output schema.
  - [ ] 2.2 Add export to `packages/validators/src/index.ts`.

- [ ] **Task 3 — API helper + router + `getUploadDetail` extension (AC5, AC6, AC7)**
  - [ ] 3.1 Create `packages/api/src/voice-memos.ts`: `attachVoiceMemoToUpload(database, supabaseAdmin, patientId, input)`. Implements all AC5 steps. Storage-existence probe uses the Supabase service-role client to call `storage.from('voice_memos').list(patientId, { search: <basename> })` — service role because patient RLS may not yet permit cross-validation reads.
  - [ ] 3.2 Create `packages/api/src/router/voice-memos.ts` mounting `attachToUpload` mutation. Wire `voiceMemosRouter` into `packages/api/src/root.ts`.
  - [ ] 3.3 Extend `getUploadDetailForPatient` in `packages/api/src/uploads-review.ts` with `hasVoiceMemo: boolean` (third COUNT probe, same pattern as `hasPreEmotionalCheckIn`).
  - [ ] 3.4 Audit kind constant: inline string `'voice_memo.recorded'` (Story 7.2 precedent). DO NOT add to `ACCESS_LOG_EVENT_KINDS`.

- [ ] **Task 4 — UI: `VoiceMemoRecorder` shell + slot (AC1, AC3, AC4, AC12)**
  - [ ] 4.1 Create `packages/ui/src/components/VoiceMemoRecorder.tsx`. Tamagui-only shell. Props: `{ open, onOpenChange, onSubmit, onSkip, isSaving, renderRecorder?: ... }`. The shell handles the sheet chrome (title, pt-BR copy, Save/Pular buttons) and exposes the recorder slot for the native API integration.
  - [ ] 4.2 Re-export from `packages/ui/src/index.ts`.

- [ ] **Task 5 — Mobile wiring (apps/expo) + permissions (AC1, AC10, AC11)**
  - [ ] 5.1 `pnpm --filter @healthtracker/expo add expo-audio expo-file-system` (the latter for cleanup on skip).
  - [ ] 5.2 Add `NSMicrophoneUsageDescription` to `app.config.ts` `ios.infoPlist`. Add `expo-audio` plugin with `microphonePermission` string. Add `RECORD_AUDIO` Android permission.
  - [ ] 5.3 Build `renderVoiceMemoRecorder` slot implementation inside the upload detail screen (or a new `apps/expo/src/components/VoiceMemoSlot.tsx` for testability). Implements:
    - `useAudioRecorder` hook with format `RecordingPresets.HIGH_QUALITY` (or `.LOW_QUALITY` for size — pick based on Expo SDK 54 docs).
    - Permission check via `Audio.requestPermissionsAsync()`; if denied, render the pt-BR copy and disable Record.
    - On Record tap: start `recorder.record()`, start a 100ms interval that updates the timer state; at 30000ms, call `recorder.stop()` + set `limitReached=true`.
    - On Stop tap: `recorder.stop()`; expose the resulting URI.
    - On Save: upload the URI's bytes to Supabase Storage via the existing auth client at `<patient_id>/<crypto.randomUUID()>.m4a`, then call the `attachToUpload` mutation with `storagePath` and `durationMs`.
    - On Skip: cleanup via `FileSystem.deleteAsync(uri, { idempotent: true })`.
  - [ ] 5.4 Wire the CTA + the sheet onto `apps/expo/src/app/uploads/[uploadId].tsx`. Gate on `hasVoiceMemo === false` and any non-failed status.

- [ ] **Task 6 — Tests (AC5, AC6, AC7, AC8)**
  - [ ] 6.1 Unit tests in `packages/api/__tests__/voice-memos.test.ts`:
    - Happy path: ownership pass + path valid + storage exists + INSERT + audit row with `{uploadId, durationMs}`.
    - NOT_FOUND on foreign upload.
    - BAD_REQUEST on storage path not prefixed with `<patientId>/`.
    - NOT_FOUND on missing storage object.
    - 23505 idempotency shield returns existing row, no second audit.
  - [ ] 6.2 Validators test (extends the api emotional-checkins test file or a sibling): `'voice_memo.recorded' NOT IN ACCESS_LOG_EVENT_KINDS`.
  - [ ] 6.3 RLS test per AC8.

- [ ] **Task 7 — Quality gates**
  - [ ] 7.1 `pnpm -w typecheck`, `pnpm -w lint`, `pnpm -w format:fix`, `pnpm --filter @healthtracker/api test:unit` — all green.

- [ ] **Task 8 — Documentation**
  - [ ] 8.1 Append a "Voice memos discipline (Story 7.4)" bullet to CLAUDE.md's existing "Personal context" stanza: `voice_memos` table + UNIQUE on `(upload_id)` + storage bucket name + path-prefix validation + AC11 bucket-creation deferral to 7.6.
  - [ ] 8.2 Update the Story 7.6 migration checklist to include the `voice_memos` table + enum + RLS policies + `CREATE bucket` SQL.

---

## Dev Notes

### Reused patterns

- **Denial-by-RLS-absence** — same as Stories 7.1 / 7.2.
- **Ownership precondition + path-prefix validation** — defense-in-depth against forged inputs (Story 7.2 R1-H2 carry-forward).
- **23505 idempotency shield** — same pattern, narrow catch on the `(upload_id)` UNIQUE.
- **Audit kind out of `ACCESS_LOG_EVENT_KINDS`** — personal-context discipline.
- **UI slot for native API** — Story 7.5's `renderDateField` carry-forward; the recording API stays in apps/expo.

### Out of scope (explicit)

- **Playback** — the patient cannot listen back to their memo in 7.4. A `voiceMemos.getPlaybackUrl` resolver + a player UI is a future story.
- **Re-record / delete** — one memo per upload (`UNIQUE (upload_id)`). Editing requires a deferred mutation.
- **Sharing with doctors** — out of scope; the `privacy_flag` is metadata for a future explicit-consent surface. The doctor-zero-rows invariant holds today.
- **Storage bucket creation** — deferred to Story 7.6's batched migration. Dev path: manual creation via Supabase dashboard.

### Existing surfaces to read

- `packages/db/src/schema/emotional_checkins.ts` (Story 7.2) — the table-pattern source.
- `packages/api/src/emotional-checkins.ts` (Story 7.2 + 7.3) — ownership precondition + 23505 idempotency shield template.
- `packages/db/policies/custom_rls_emotional_checkins.sql` — the policy file template.
- `packages/ui/src/components/EmotionalCheckInSheet.tsx` (Story 7.2) — Tamagui sheet pattern.
- `apps/expo/src/app/uploads/[uploadId].tsx` — the screen being extended.
- `apps/expo/app.config.ts` — permission plugin config patterns (mirrors Story 1.5 NSPhotoLibraryUsageDescription).
- Expo SDK 54 docs for `expo-audio` — `useAudioRecorder` + `RecordingPresets`.

### Open questions for Francis

1. **Storage bucket creation timing.** Story 7.6 ships the SQL; the dev path is a manual click. If product wants automated bucket creation in this story, scope adds a Supabase Storage helper + an admin-only resolver. Defaulting to deferred per Epic 6 / 7.6 ops-note.
2. **`expo-audio` vs `expo-av`.** `expo-audio` is the new SDK 54 API; `expo-av` is being deprecated. Going with `expo-audio` for forward compatibility. If a critical API gap is found, fallback is `expo-av`.

### References

- [Source: `_bmad-output/planning-artifacts/epics.md` lines 1691–1716] Story 7.4 spec.
- [Source: Story 7.2 / 7.3 implementations] Architectural twins; this story inherits the personal-context table pattern.

## Dev Agent Record

### Agent Model Used

claude-opus-4-7 (BMad bmad-create-story workflow)

### Review Findings — R1 (2026-05-31)

Three parallel adversarial reviews. 10/12 ACs MET, 2 minor DEVIATED. **2 CRITICAL findings — Buffer-not-defined in Hermes (C1) and 30s auto-stop interval race (C2) — would have made the feature DOA on device.** All 6 HIGH/MED security-relevant findings patched in this commit.

- [x] [Review][Patch] **R1-C1 CRITICAL — `Buffer.from` is not defined in React Native / Hermes; voice-memo upload would throw `ReferenceError` on every device save** `[apps/expo/src/app/uploads/[uploadId].tsx]` — replaced `FileSystem.readAsStringAsync(base64)` + `Buffer.from` with `fetch(uri).blob()`. Supabase JS SDK accepts `Blob` natively. Also avoids 666KB base64 round-trip in memory.
- [x] [Review][Patch] **R1-C2 CRITICAL — 30s auto-stop interval can fire `stopAndFinalize` twice and `recorder.stop()` called concurrently** `[apps/expo/src/components/VoiceMemoRecorderSlot.tsx]` — added `finalizingRef` single-shot guard + `isRecordingRef` to replace stale-closure `recorderState.isRecording` reads + clear interval BEFORE calling stopAndFinalize on the auto-stop branch.
- [x] [Review][Patch] **R1-H1 HIGH — Storage orphan on resolver failure** `[apps/expo/src/app/uploads/[uploadId].tsx]` — catch block now calls `supabase.storage.remove([uploadedStoragePath])` best-effort before surfacing the error.
- [x] [Review][Patch] **R1-H2 HIGH — Retry-after-success orphan: second upload with fresh UUID after 23505 leaves first object orphan** `[apps/expo/src/app/uploads/[uploadId].tsx]` — `voiceMemoId` is now deterministic (`= uploadId`) and upload uses `upsert: true` so a retry overwrites in place.
- [x] [Review][Patch] **R1-H3 HIGH — Stale closure on `recorderState.isRecording` in interval + unmount** `[apps/expo/src/components/VoiceMemoRecorderSlot.tsx]` — folded into the C2 fix via `isRecordingRef`.
- [x] [Review][Patch] **R1-H4 HIGH — Supabase Storage `list({ search })` is substring `ILIKE` match; a same-prefix-but-different-name file satisfies existence probe** `[packages/api/src/voice-memos.ts]` — added `listed.some(o => o.name === basename)` exact-match assertion. Regression test added.
- [x] [Review][Patch] **R1-M1 MED — `isOwnVoiceMemoStoragePath` permitted `..` path traversal** `[packages/validators/src/voice-memos.ts]` — reject `..`, `\\`, and any path that is not exactly two segments (`<patientId>/<filename>`). Unit test added.
- [x] [Review][Patch] **R1-M3 MED — `auth.getUser()` null on expired session leaks the local recording URI** `[apps/expo/src/app/uploads/[uploadId].tsx]` — catch block now also `FileSystem.deleteAsync`s the local URI.
- [x] [Review][Defer] **R1-M2 — Permission denial copy stickiness** — minor UX edge; defer (retry-via-Record-tap works; copy persists harmlessly until next tap).
- [x] [Review][Defer] **R1-L1 — unmount cleanup doesn't FileSystem.deleteAsync the `savedUri`** — minor leak edge to OS temp dir.
- [x] [Review][Defer] **AC4 minor deviation — `recorder.stop()` instead of `recorder.cleanup()`** — functionally equivalent; spec wording was loose.
- [x] [Review][Defer] **AC12 minor deviation — slot signature omits `onError`/`isRecording`** — current consumer doesn't need them; future-proofing if added later.
- [x] [Review][Defer] **Integration testcontainer for the resolver absent** — Epic 6 / Rancher carry-forward; unit-test + RLS matrix coverage is the established compromise.
- [x] [Review][Dismiss] **Audit-not-in-tx (vs INSERT)** — same pattern as Stories 7.1 / 7.2 / 7.3 / Epic 5 / Epic 6; ctx.db is the protectedProcedure tx-bound handle.

### Completion Notes List

- All 8 tasks complete. Status: `in-progress → done`.
- Quality gates: typecheck (17 packages green), lint (15 packages green), format clean, **370 api unit tests pass** (+12 new for voice memo helper + validators + path traversal + fuzzy match).
- R1 review applied **8 patches autonomously** (2 CRITICAL + 4 HIGH + 2 MED) before commit. 5 deferred (UX edges, minor spec deviations, infra carry-forward). 1 dismissed (false positive on tx claim).
- AC11 bucket creation deferred to Story 7.6 batched migration — dev path is manual creation via Supabase dashboard.
- Manual run-through on real device (Task 5.5) NOT executed in this background session — user's `/verify` step.
- Stacks on Stories 7.1 + 7.2 + 7.3 + 7.5 / PR #59.

### File List

**NEW files (8):**

- `packages/db/src/schema/voice_memos.ts`
- `packages/db/policies/custom_rls_voice_memos.sql`
- `packages/db/__tests__/rls/voice_memos.rls.test.ts`
- `packages/validators/src/voice-memos.ts`
- `packages/api/src/voice-memos.ts`
- `packages/api/src/router/voice-memos.ts`
- `packages/api/__tests__/voice-memos.test.ts`
- `packages/ui/src/components/VoiceMemoRecorder.tsx`
- `apps/expo/src/components/VoiceMemoRecorderSlot.tsx`

**MODIFIED files:**

- `packages/db/src/schema/index.ts` (export `voice_memos`)
- `packages/validators/src/index.ts` (export `voice-memos`)
- `packages/api/src/root.ts` (mount `voiceMemos` router)
- `packages/api/src/uploads-review.ts` (`hasVoiceMemo` derived field)
- `packages/ui/src/index.ts` (re-export `VoiceMemoRecorder`)
- `apps/expo/package.json` (`expo-audio` + `expo-file-system` deps)
- `apps/expo/app.config.ts` (`NSMicrophoneUsageDescription` + Android `RECORD_AUDIO` + `expo-audio` config plugin)
- `apps/expo/src/app/uploads/[uploadId].tsx` (voice-memo CTA + sheet + Storage upload + mutation wiring)
- `CLAUDE.md` (Personal context stanza — voice memo discipline bullet)
- `_bmad-output/implementation-artifacts/sprint-status.yaml` (7.4 status transitions)

### File List
