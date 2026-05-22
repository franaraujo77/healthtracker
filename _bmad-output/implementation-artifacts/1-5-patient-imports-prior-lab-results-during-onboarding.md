# Story 1.5: Patient imports prior lab results during onboarding

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a new patient,
I want to upload my existing lab results during the onboarding flow, before my profile is fully configured,
so that my longitudinal record and Fingerprint start with historical data from day one.

## Acceptance Criteria

**AC1 — File picker after consent**
**Given** I am in the onboarding flow and have completed the LGPD consent screens (Story 1.2) and the biometric offer (Story 1.3),
**When** the "Enviar resultados anteriores" screen appears,
**Then** I can select one or more PDFs (`application/pdf`, up to 5 MB / 10 pages — NFR-P1 / FR1) or images (`image/jpeg`, `image/png`, `image/heic` — FR2) from my device without being forced to complete profile setup first. Multi-select is supported on both platforms (Expo via `expo-document-picker` and `expo-image-picker`, Web via `<input type="file" multiple>`).

**AC2 — Upload is queued for extraction with idempotency key**
**Given** I initiate an upload during onboarding,
**When** the upload is queued,
**Then** for each selected file: a `uploads` row is inserted with `status = 'queued'`, a server-generated `idempotency_key` (uuidv4) that is `UNIQUE` at the DB level, a `storage_path` pointing at the patient-prefixed object in Supabase Storage, and a `extract_document` pg-boss job is enqueued via the shared queue contract from Story 0.5 (`ExtractDocumentPayload` in `packages/types/src/jobs.ts`). The extraction worker itself ships in Epic 2 (Story 2.3) — Story 1.5 only writes the queue entry. Duplicate submissions of the same file content within the same patient hit the `idempotency_key UNIQUE` constraint and are silently rejected (no second job enqueued).

**AC3 — Skip lands the patient on cold-start Início**
**Given** I skip importing prior results during onboarding,
**When** I land on the main app,
**Then** the `EmptyStateRecord` component shows the `cold-start` state with the headline _"Sua história de saúde começa aqui"_ and a primary CTA labeled exactly _"Enviar primeiro resultado"_ (per epic AC text — note the wording differs from Story 1.2's _"Enviar resultado"_; this story updates the constant). The CTA's `onPress` opens the same import sheet the onboarding screen used (re-using the `useImportFiles` hook from Task 5).

**AC4 — "Fazer isso depois" completes onboarding and surfaces the import affordance on Início**
**Given** I am in the onboarding import screen,
**When** I tap "Fazer isso depois",
**Then** onboarding completes (`router.replace({ pathname: INICIO_ROUTE })` — onboarding cannot be revisited via back-navigation), and the `EmptyStateRecord` on the Início tab provides the same CTA so the patient can return to the import flow at any time. No `uploads` row is written for the skip path.

**Requirements:** FR46, FR1, FR2, AR8, AR14, AR21, UX-DR10, UX-DR20

## Tasks / Subtasks

- [x] **Task 1 — Define the `uploads` table + `upload_status` enum** (AC: #2)
  - [x] Implement `packages/db/src/schema/uploads.ts` (the file currently contains the stub `// schema defined in story 2.1` — Story 1.5 takes ownership, see Clarifications #1). Columns per architecture.md L1066 + L329: - `id` (uuid PK defaultRandom) - `patient_id` (uuid notNull) - `idempotency_key` (text notNull, UNIQUE) - `storage_path` (text notNull) — the Supabase Storage object key - `mime_type` (text notNull) — one of `application/pdf` / `image/jpeg` / `image/png` / `image/heic` - `size_bytes` (integer notNull) - `original_filename` (text notNull) — patient-facing display name - `source` (pgEnum `upload_source_enum` — `onboarding_import` | `post_onboarding`, defaultsTo `'post_onboarding'`) — Story 1.5 writes `'onboarding_import'`; Epic 2's `uploads.create` writes `'post_onboarding'` - `status` (pgEnum `upload_status_enum`) - `processing_started_at` (timestamptz nullable) - `processing_completed_at` (timestamptz nullable) - `metadata` (jsonb default `{}`) - `created_at` (timestamptz defaultNow notNull) - `updated_at` (timestamptz defaultNow notNull) — touched by the state-machine helper Epic 2 will own
  - [x] Define `pgEnum('upload_status_enum', ['queued', 'processing', 'pending_review', 'complete', 'failed'])` per architecture.md L117 ("Upload state machine — pending → processing → complete → failed transitions"). Story 1.5 only writes `'queued'`; later epic transitions touch the rest.
  - [x] Use `snake_case` (Drizzle config). Export from `packages/db/src/schema/index.ts` (currently exports `audit`, `consent`, `posts`, `users`, `observations`, `sharing`, `uploads`-stub — replace the stub re-export).
  - [x] Index plan: `idempotency_key UNIQUE` (constraint above); composite index on `(patient_id, created_at desc)` for the future "my uploads list" query.

- [x] **Task 2 — RLS policies + adversarial RLS test for `uploads`** (AC: #2)
  - [x] Add `packages/db/policies/custom_rls_uploads.sql` mirroring `custom_rls_audit_log.sql` + `custom_rls_consent_grants.sql`: - `ALTER TABLE "uploads" ENABLE ROW LEVEL SECURITY`. - `SELECT own` policy: `patient_id::text = current_setting('app.current_patient_id', true)`. - `INSERT own` policy with `WITH CHECK` mirroring `patient_id`. - **No UPDATE policy at this story** — Story 1.5 only writes the initial `'queued'` row. Epic 2 (Story 2.3) will add a narrow service-role UPDATE policy for state-machine transitions performed by `services/extraction`. Document this gap in the Dev Notes. - **No DELETE policy** — uploads are append-only at the patient layer (FR8 + GDPR-delete via Story 5.6 uses a service-role path).
  - [x] Add `packages/db/__tests__/rls/uploads.rls.test.ts`. Mirror the `consent_grants.rls.test.ts` matrix exactly: own INSERT, foreign INSERT (42501), wrongPatient sees `[]`, anon zero rows/error, SELECT-own, UPDATE no-op (visibility-first), DELETE no-op (visibility-first).
  - [x] **Idempotency-conflict test**: own INSERT, same `idempotency_key` → second INSERT must violate the UNIQUE constraint (Postgres code `23505`), not RLS — assert specifically.

- [x] **Task 3 — Supabase Storage bucket: `lab-uploads`** (AC: #1, #2)
  - [x] Add a one-time Supabase Storage configuration step (private bucket, patient-prefixed paths). Since `drizzle-kit` doesn't manage storage, add the contract to `packages/db/policies/custom_storage_lab_uploads.sql` (or equivalent — verify the canonical location with Story 0.4's RLS-token-principal precedent). The bucket is private; access is mediated by signed URLs only (no direct anonymous reads).
  - [x] **Path convention**: `lab-uploads/<patient_id>/<idempotency_key>/<sanitized_original_filename>`. Per-patient prefix means storage RLS can be a single policy: `(storage.foldername(name))[1] = auth.uid()::text`.
  - [x] Add a storage policy file `packages/db/policies/custom_storage_lab_uploads_policy.sql` enforcing `INSERT`/`SELECT` only on the patient's own prefix. Service-role bypass remains (used by the extraction worker in Epic 2).
  - [x] **Document the apply mechanism** in the policy file header — `psql -f` during deploy / CI is the team convention from Story 1.2's `custom_*` files.
  - [x] **Out of scope this story**: bucket lifecycle / retention rules. Add a deferred F-item for "uploads lifecycle policy" (LGPD Art. 16 retention — comes with Story 5.6 / patient-initiated deletion).

- [x] **Task 4 — `uploads.requestImport` + `uploads.confirmImport` tRPC procedures** (AC: #2)
  - [x] Create `packages/api/src/router/uploads.ts` and register in `packages/api/src/root.ts`. All procedures `protectedProcedure`.
  - [x] `requestImport({ originalFilename, mimeType, sizeBytes })`: - Zod-validated input via `UploadImportRequestSchema` (mimeType enum, sizeBytes integer `0 < size <= 5_242_880` = 5 MB). - Server generates `idempotencyKey = crypto.randomUUID()`. - Server generates `storagePath = ${patientId}/${idempotencyKey}/${sanitizeFilename(originalFilename)}`. - Returns `{ idempotencyKey, storagePath, uploadUrl }` where `uploadUrl` is a Supabase Storage signed POST URL valid for 60 s (`createSignedUploadUrl`). - Does NOT write the `uploads` row yet — the row lands in `confirmImport` after the client confirms the upload completed.
  - [x] `confirmImport({ idempotencyKey, storagePath, originalFilename, mimeType, sizeBytes })`: - Validates the same fields via `UploadImportConfirmSchema`. - Writes the `uploads` row via a new helper `writeUpload(db, { ...fields, source: 'onboarding_import', status: 'queued' })` at `packages/api/src/uploads.ts` (single sanctioned write path — mirrors `writeAuditLog` / `writeConsentGrant`). Uses `ON CONFLICT (idempotency_key) DO NOTHING + RETURNING` so a duplicate confirmation is a no-op. - On real insert: enqueue a `extract_document` pg-boss job with payload `ExtractDocumentPayload` from `packages/types/src/jobs.ts`. Use the existing enqueue helper at `services/extraction/src/index.ts` (or its sibling — verify; Story 0.5's smoke-test path is `enqueue-smoke-test.ts`). Emit a `writeAuditLog({ event: 'upload.queued', actorId, actorType: 'patient', resourceId: <upload id>, resourceType: 'upload', metadata: { source: 'onboarding_import' } })`. - Return `{ uploadId: <new id>, created: <boolean> }` so the client can show a "queued" pill.
  - [x] **Why two-step (request + confirm)**: keeps the `uploads` row out of the DB until the client confirms the storage write succeeded. A client that crashes mid-upload leaves orphan storage objects but no DB row (storage cleanup is a sweep job — defer to Epic 5 / 8 ops surface).
  - [x] **Atomicity**: `confirmImport` runs inside `protectedProcedure`'s transaction wrap (per Story 1.4 P27 investigation). A failed audit insert rolls back the `uploads` write — the patient retries cleanly.

- [x] **Task 5 — Shared `useImportFiles` hook on Expo** (AC: #1, #2, #3, #4)
  - [x] Create `apps/expo/src/hooks/use-import-files.ts`. Encapsulates the two-step upload flow: - `pickFiles()` — opens `expo-document-picker` (PDF) or `expo-image-picker` (JPEG/PNG/HEIC) with `multiple: true`. Returns a normalized array of `{ uri, name, mimeType, size }`. - `uploadFiles(files)` — for each file: call `trpc.uploads.requestImport.mutate(...)`, PUT the file bytes to the returned `uploadUrl`, then call `trpc.uploads.confirmImport.mutate(...)`. Per-file result is `{ status: 'queued' | 'failed', uploadId? }`. - Hook returns `{ pickFiles, uploadFiles, isUploading, progressByFile }` for UI feedback.
  - [x] Add `expo-document-picker` + `expo-image-picker` to `apps/expo/package.json`. Use the Expo SDK 54-compatible versions (`~14.0.x` and `~17.0.x` respectively — resolve via `pnpm install` after manual pin). Both are native modules; document the rebuild requirement (same Story 1.3 P22-family caveat).
  - [x] **Permissions**: `expo-image-picker` requires `NSPhotoLibraryUsageDescription` on iOS. Add a pt-BR string in `apps/expo/app.config.ts` `ios.infoPlist`: `"Permita o acesso à sua biblioteca de fotos para enviar resultados de exames."` Android handles via runtime permission prompt; no manifest change needed.

- [x] **Task 6 — Onboarding "Enviar resultados anteriores" screen (Expo + Web)** (AC: #1, #3, #4)
  - [x] **Expo**: create `apps/expo/src/app/onboarding/import.tsx`. Title `"Trazer seus exames anteriores"`. Body (pt-BR, 8th-grade — UX-DR20): brief explanation that uploading prior results lets the Fingerprint start with history. Two primary actions: - "Enviar resultados" → `useImportFiles().pickFiles()` → list selected files → "Confirmar envio" runs `uploadFiles(...)` → on completion `router.replace({ pathname: INICIO_ROUTE })`. - "Fazer isso depois" → `router.replace({ pathname: INICIO_ROUTE })`. AC4.
  - [x] **Web**: create `apps/web/src/app/onboarding/import/page.tsx` + `import-flow.tsx` (client). Uses `<input type="file" multiple accept="application/pdf,image/jpeg,image/png,image/heic">` and the same two-step request/confirm pattern. The web upload path uses `fetch(uploadUrl, { method: 'PUT', body: file })`.
  - [x] **Wire into onboarding sequence**: change the post-biometric route hop. Today: consent → biometric → Início. New: consent → biometric → import → Início. - Update `apps/expo/src/app/onboarding/biometric.tsx`: the existing `goToInicio()` function (called on both enable and skip) becomes `goToImport()` that `router.replace({ pathname: IMPORT_ROUTE })`. - Update web onboarding flow similarly (verify the web equivalent of biometric exists — it does NOT today, per Story 1.3 mobile-only scope; web's `/auth/callback` routes to consent → consent flow → `INICIO_ROUTE`. For web, the new hop is consent → import → Início. See Clarifications #2.)
  - [x] **Empty / loading / error states**: - Empty (no files selected): a centered prompt + CTA to pick files. - Loading (uploading): show per-file progress and an aggregate spinner. Disable both action buttons while pending. - Error: pt-BR `GENERIC_UPLOAD_ERROR_MESSAGE_PT_BR` ("Não foi possível enviar este arquivo. Tente novamente.") shown inline next to the failing file's row; other files continue.
  - [x] **Per-file size + mime validation** at the picker level — refuse 0-byte files, refuse files > 5 MB, refuse unsupported mime types — before the `requestImport` call. Surface the validation message inline in pt-BR (`UPLOAD_FILE_TOO_LARGE_PT_BR`, `UPLOAD_UNSUPPORTED_MIME_PT_BR`).

- [x] **Task 7 — Update Início empty state to AC3 wording + import-from-empty-state CTA** (AC: #3)
  - [x] In `packages/validators/src/index.ts`: change `INICIO_CTA_PT_BR` from `"Enviar resultado"` (Story 1.2 AC5 wording) to `"Enviar primeiro resultado"` (Story 1.5 AC3 wording). Story 1.2's Clarification #6 acknowledged this would change with Story 1.5.
  - [x] Update Expo Início screen (`apps/expo/src/app/(tabs)/inicio.tsx`) and Web Início screen (`apps/web/src/app/inicio/inicio-empty-state.tsx`) to wire the CTA's `onPress` to open the same import sheet — extract the file-picker + upload flow from Task 6's screen into a re-usable component, or have the CTA `router.push({ pathname: IMPORT_ROUTE })` and use the same screen (recommended — simpler).
  - [x] If the patient lands on Início with non-empty `uploads` rows in `'queued'` / `'processing'` state, the empty state must NOT show (the `EmptyStateRecord` is for the cold-start case only). Story 1.5 does NOT build the post-upload Início state — that's Epic 2 Story 2.5. For Story 1.5, the test condition is: zero `uploads` rows → empty state with new CTA; anything else → still empty state for now (technical debt acknowledged, see Dev Notes).

- [x] **Task 8 — Validators + shared pt-BR copy + route constants** (AC: all)
  - [x] Extend `packages/validators/src/index.ts`: - `UploadImportRequestSchema`, `UploadImportConfirmSchema` (Zod object schemas — mime/size constraints). - `UPLOAD_MAX_BYTES = 5 * 1024 * 1024` (5 MB). - `UPLOAD_ALLOWED_MIME_TYPES = ['application/pdf', 'image/jpeg', 'image/png', 'image/heic'] as const`. - `UploadMimeType` TypeScript union. - Route constant: `IMPORT_ROUTE = '/onboarding/import'`. - pt-BR copy: `IMPORT_TITLE_PT_BR`, `IMPORT_BODY_PT_BR`, `IMPORT_PICK_CTA_PT_BR` ("Enviar resultados"), `IMPORT_SKIP_CTA_PT_BR` ("Fazer isso depois"), `IMPORT_CONFIRM_CTA_PT_BR` ("Confirmar envio"), `UPLOAD_FILE_TOO_LARGE_PT_BR`, `UPLOAD_UNSUPPORTED_MIME_PT_BR`, `GENERIC_UPLOAD_ERROR_MESSAGE_PT_BR`, `UPLOAD_QUEUED_BADGE_PT_BR` ("Enviado"). - Change `INICIO_CTA_PT_BR` from `"Enviar resultado"` to `"Enviar primeiro resultado"` per AC3. - Add `sanitizeFilename(name: string): string` helper — strips path separators, control chars, and limits to 128 chars. Used server-side in `requestImport`.

- [x] **Task 9 — Tests** (AC: all)
  - [x] Vitest unit tests at `packages/api/__tests__/uploads.test.ts`: `requestImport` happy path (returns signed URL shape); `confirmImport` happy path (writes row + enqueues job + emits audit); `confirmImport` idempotent re-submit (ON CONFLICT no-op, no second audit, no second job); `writeUpload` RLS failure propagation (mirror Story 1.1 P4 / Story 1.4 P36 pattern).
  - [x] Vitest unit tests for `sanitizeFilename` in `packages/validators/__tests__/sanitize-filename.test.ts` if a test file exists; otherwise inline assertions in the API test file. Strip `/`, `\`, `..`, control chars; truncate to 128 chars.
  - [x] `uploads.rls.test.ts` adversarial matrix per Task 2.
  - [x] **Storage upload not Vitest-covered** — the signed URL → PUT round-trip requires a real Supabase instance (or `pnpm supabase start`); document a hand-test matrix: 1. Onboard a fresh patient → consent → biometric → land on `/onboarding/import` → pick a 3 MB PDF → tap Enviar → verify `uploads` row inserted with `status='queued'`, storage object exists at `<patient_id>/<key>/<filename>`, `extract_document` job appears in pg-boss `job` table. 2. Pick a 10 MB PDF → validation blocks before `requestImport` → patient sees `UPLOAD_FILE_TOO_LARGE_PT_BR`. 3. Pick an unsupported file (e.g., `.docx`) → validation blocks → `UPLOAD_UNSUPPORTED_MIME_PT_BR`. 4. Tap "Fazer isso depois" → land on Início → empty state with new "Enviar primeiro resultado" CTA → tap → same import screen opens. 5. Re-submit the same idempotency key (simulate offline retry) → second `confirmImport` returns `{ created: false }`, no duplicate row, no duplicate job.
  - [x] `pnpm typecheck`, `pnpm lint`, `pnpm format`, `pnpm test` all green.

## Dev Notes

### Architecture patterns and constraints

- **`uploads` is the entry point of the extraction state machine** (architecture.md L117). Story 1.5 only writes the `'queued'` initial state; Epic 2's Stories 2.3 (extraction worker) and 2.4 (confidence-gate review queue) consume from `'queued'` and transition forward. Story 1.5 should NOT speculatively implement transitions — leave the state-machine helper for Story 2.3.
- **Two-step upload (request + confirm)** keeps orphan DB rows out of the table when the storage upload fails. Storage orphans are cleaned by a sweep job (Epic 5 / 8 ops). This pattern is documented as a deferred F-item.
- **Single sanctioned write path**: `writeUpload(db, { ... })` mirrors `writeAuditLog`, `writeConsentGrant`, `writeConsentRevocation`. Every `uploads` insert goes through it.
- **Idempotency key is server-generated** (uuidv4) per architecture.md L154. Storing it in the DB is what enables FR8 offline retry — Epic 2's offline queue passes the same key back on retry.
- **`actorType: 'patient'` audit emission only** (Story 1.2 F10 deferred — system-actor audit writes are blocked by current RLS). The `upload.queued` audit row carries `actor: 'self'` in metadata to preserve symmetry with `consent.*` events.
- **AR8 / AR14**: signed-URL-only storage access; per-patient prefix in the object key; storage RLS via `storage.foldername(name)[1] = auth.uid()::text`.
- **UX-DR10 (`EmptyStateRecord`)** — the Início cold-start state is the same component used in Story 1.2 for the post-consent empty state. Story 1.5 updates the CTA copy and wires the `onPress` to the import flow.
- **UX-DR20** — all pt-BR strings live in `packages/validators` (Story 1.2 / 1.3 / 1.4 precedent). Do not duplicate.

### Requirement texts

- **FR46:** Patient can upload prior lab results during onboarding, before account setup is fully complete, so their longitudinal record begins on day one. [prd.md:540]
- **FR1:** Patient can upload a blood test result as a PDF file from device storage. [prd.md:474]
- **FR2:** Patient can upload a blood test result as an image (JPEG/PNG/HEIC) from camera roll or direct camera capture. [prd.md:475]
- **AR8 / AR14:** Signed-URL storage, per-patient prefixed paths, RLS at the storage layer.
- **AR21:** (Not directly findable in architecture.md by tag — interpret as the upload state machine + idempotency contract documented at architecture.md L117 + L154.)
- **UX-DR10:** `EmptyStateRecord` component (3 states × 2 variants).
- **UX-DR20:** pt-BR copy, 8th-grade reading level, ANVISA-compliant.

### Source tree components to touch

- `packages/db/src/schema/uploads.ts` — REPLACE the stub with the real schema.
- `packages/db/src/schema/index.ts` — UPDATE export.
- `packages/db/policies/custom_rls_uploads.sql` — NEW.
- `packages/db/policies/custom_storage_lab_uploads_policy.sql` — NEW.
- `packages/db/__tests__/rls/uploads.rls.test.ts` — NEW.
- `packages/api/src/uploads.ts` — NEW: `writeUpload` helper.
- `packages/api/src/router/uploads.ts` — NEW: `requestImport` / `confirmImport`.
- `packages/api/src/root.ts` — UPDATE: register `uploadsRouter`.
- `packages/api/__tests__/uploads.test.ts` — NEW.
- `packages/validators/src/index.ts` — UPDATE: schemas, constants, pt-BR copy, `sanitizeFilename`, change `INICIO_CTA_PT_BR`.
- `apps/expo/package.json` — UPDATE: add `expo-document-picker`, `expo-image-picker`.
- `apps/expo/app.config.ts` — UPDATE: `NSPhotoLibraryUsageDescription` in `ios.infoPlist`.
- `apps/expo/src/hooks/use-import-files.ts` — NEW.
- `apps/expo/src/app/onboarding/import.tsx` — NEW.
- `apps/expo/src/app/onboarding/biometric.tsx` — UPDATE: route to `/onboarding/import` instead of `/inicio`.
- `apps/expo/src/app/(tabs)/inicio.tsx` — UPDATE: CTA `onPress` → `router.push({ pathname: IMPORT_ROUTE })`.
- `apps/web/src/app/onboarding/import/page.tsx` — NEW.
- `apps/web/src/app/onboarding/import/import-flow.tsx` — NEW.
- `apps/web/src/app/onboarding/consent/consent-flow.tsx` — UPDATE: post-consent route from `INICIO_ROUTE` to `IMPORT_ROUTE`.
- `apps/web/src/app/inicio/inicio-empty-state.tsx` — UPDATE: CTA `onPress` → `router.push(IMPORT_ROUTE)`.

### Testing standards summary

- Co-locate Vitest tests at `packages/api/__tests__/uploads.test.ts`.
- RLS tests live in `packages/db/__tests__/rls/uploads.rls.test.ts`; require `supabase start`; excluded from `pnpm test`; CI's `rls-adversarial` job runs them.
- Storage upload + signed-URL round-trip is hand-tested (no Vitest infrastructure for Supabase Storage; F11 family deferred).
- `pnpm typecheck`, `pnpm lint`, `pnpm format`, `pnpm test` must be green.

### Previous story intelligence (1.1–1.4)

- **Single sanctioned write path per table** (1.1 `writeAuditLog`, 1.2 `writeConsentGrant`, 1.4 `writeConsentRevocation`). `writeUpload` follows the same pattern.
- **`onConflictDoNothing` + `.returning()` + audit-on-real-insert** (Story 1.2). `confirmImport` reuses this seam keyed on `idempotency_key`.
- **Append-only at the DB layer** (Story 1.2 / 1.4). Story 1.5 establishes the same invariant for `uploads`: no UPDATE / DELETE policy at this story; Epic 2 will add a narrow service-role UPDATE policy for state-machine transitions. The pattern is symmetric with how Story 1.4 added the revoke UPDATE policy on top of Story 1.2's append-only `consent_grants`.
- **Detection by code, not substring** (Story 1.1 P1, Story 1.3 P2/P18). Upload-related errors branch by Postgres / Supabase code, never message.
- **pt-BR copy + route constants centralized in `packages/validators`** (Story 1.2 / 1.3 / 1.4). Do not duplicate.
- **Object-form `router.replace`/`push`** (Story 1.2 / 1.3 / 1.4). Always `{ pathname: ROUTE }`, never string-form.
- **`isConsentScreenType` pattern** (Story 1.4 P31) — runtime narrowing helpers live in validators next to their type unions. Story 1.5: `isUploadMimeType(value: string): value is UploadMimeType`.
- **Transaction wrap is provided by `protectedProcedure`** (Story 1.4 P27). `confirmImport`'s `writeUpload` + `writeAuditLog` + pg-boss enqueue all run in the same outer transaction; a throw from any step rolls back the others. **Caveat**: the pg-boss enqueue may be a different DB connection (it has its own schema) — verify whether the enqueue is in-transaction or fires after commit. If after commit, an audit-throw could leave a queued job without a `uploads` row. Investigate before claiming atomicity.

### Git intelligence

Recent commits (`git log --oneline -5`):

```
<recent> feat(consent): story 1.4 — view and manage active consent agreements
7003a01 feat(auth): story 1.3 — biometric authentication
f718567 feat(consent): story 1.2 — LGPD consent at onboarding
14e26e8 feat(auth): story 1.1 — patient registration with email and password
835e934 chore(prep): resolve Epic 0 retro prep items before Epic 1
```

Conventional Commits with scopes. Use `feat(uploads):` for Story 1.5 work; `fix(uploads):` for follow-ups.

### Latest tech information

- **`expo-document-picker`** SDK 54-compatible: `~14.0.x`. API: `getDocumentAsync({ type: 'application/pdf', multiple: true })`.
- **`expo-image-picker`** SDK 54-compatible: `~17.0.x`. API: `launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, allowsMultipleSelection: true })`. iOS 14+ supports multi-select natively.
- **Supabase Storage signed URLs**: `supabase.storage.from('lab-uploads').createSignedUploadUrl(path)` returns `{ signedUrl, token, path }`. The client `PUT`s to `signedUrl` (or uses `uploadToSignedUrl(path, token, file)`). TTL is currently 2 hours by default — Story 1.5 uses 60 s to limit replay window. Verify the API surface on `@supabase/supabase-js` already in the catalog.
- **`pg-boss` enqueue contract** from Story 0.5 — `ExtractDocumentPayload` is the canonical payload shape. The shared queue helper lives in `services/extraction/src/index.ts`; verify the export.

### Project Structure Notes

- **The worktree is on branch `worktree-story-1-1`** at the `feat(consent): story 1.4` commit. Story 1.5 branches from here.
- **`uploads.ts` schema file currently contains a one-line stub** (`// schema defined in story 2.1`). Story 1.5 takes ownership — verify this with the user (see Clarifications #1) since it shifts the story 2.1 scope.
- **Onboarding flow ordering**: today's flow is register → consent → biometric → Início. Story 1.5 inserts `import` between biometric and Início. The web flow has no biometric step (Story 1.3 was mobile-only), so the web hop is consent → import → Início.
- **Web app does not currently have a tabs structure** — Início is a single page. The Story 1.4 Configurações subtree is reachable from URL only. Story 1.5 adds `/onboarding/import` on web.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story-1.5] — story text, ACs, requirement tags. Lines 609–633.
- [Source: _bmad-output/planning-artifacts/architecture.md#Upload-state-machine] — L117 (state diagram contract), L154 (idempotency key), L329 (column list), L1066 (file layout).
- [Source: _bmad-output/planning-artifacts/prd.md] — FR1 / FR2 (L474–475), FR46 (L540).
- [Source: packages/types/src/jobs.ts] — `ExtractDocumentPayload` canonical job shape.
- [Source: _bmad-output/implementation-artifacts/0-5-configure-pg-boss-extraction-job-queue.md] — pg-boss enqueue setup, smoke test path.
- [Source: _bmad-output/implementation-artifacts/1-2-patient-provides-lgpd-compliant-consent-per-data-type-at-onboarding.md] — single-write-path pattern, RLS file convention, AC5 Início copy that this story updates.
- [Source: _bmad-output/implementation-artifacts/1-3-patient-enables-biometric-authentication.md] — onboarding flow ordering precedent, `router.replace` object-form, P22-family native module rebuild caveat.
- [Source: _bmad-output/implementation-artifacts/1-4-patient-views-and-manages-active-consent-agreements.md] — P27 transaction-wrap investigation, idempotency-with-audit-on-real-insert pattern.

### Clarifications for the user (resolve before/at start of dev)

1. **Schema ownership: Story 1.5 takes the `uploads` schema from Story 2.1.** The stub in `packages/db/src/schema/uploads.ts` says "defined in story 2.1", but Story 1.5 needs the table to exist NOW. Recommended: Story 1.5 owns the schema; Story 2.1's scope shrinks to "wire the existing schema into the post-onboarding upload flow + ExtractionPulse UI". Story 2.3 owns the state-machine transitions. Confirm — and if the user wants 1.5 to be UI-only with a stub upload mutation that throws `Em breve`, halve the scope of Tasks 1–4 and surface a big deferred F-item.
2. **Web onboarding flow has no biometric step (Story 1.3 was mobile-only).** The new web hop is consent → import → Início, not consent → biometric → import → Início. Recommended: accept the asymmetry — biometric is a mobile-device-only convenience; web users don't need an equivalent. Confirm.
3. **Onboarding flow ordering on Expo**: consent → biometric → import → Início, or consent → import → biometric → Início? Recommended: **biometric before import** — biometric setup is faster and feels like a setup step; import is data-heavy and benefits from being the last onboarding action so the patient lands directly on Início with their first results queued. Confirm.
4. **pg-boss enqueue + audit + uploads insert atomicity.** Story 1.4 P27 established that `protectedProcedure` wraps in `ctx.db.transaction`. pg-boss likely uses its own connection (its own `pgboss` schema). If the enqueue happens via the same Drizzle tx, it's atomic; if it commits independently, an audit-throw after enqueue leaves a queued job pointing at a non-existent uploads row. Recommended: enqueue AFTER `writeUpload` returns but BEFORE `writeAuditLog` — if `writeAuditLog` throws, the tx rolls back the uploads row, and the queued job becomes a dead reference Epic 2 must handle defensively (job consumer SELECTs the row by id; on miss, no-ops + dead-letters). Confirm — or invert ordering (audit first, enqueue last) and accept that an enqueue failure leaves a queued audit pointing at no job.
5. **Supabase Storage bucket creation: dev process.** Bucket creation is an out-of-band operation (Dashboard or `supabase/config.toml`). Recommended: add a `supabase/config.toml` declaration if the project uses Supabase CLI for dev (verify); otherwise document a manual step in the dev README. Confirm — the manual step is a fragile point.
6. **`INICIO_CTA_PT_BR` change from "Enviar resultado" → "Enviar primeiro resultado".** Story 1.2 AC5 explicitly used the shorter wording; Story 1.5 AC3 mandates the longer wording. Recommended: update the constant per Story 1.5 AC3; the change is visible only to patients who haven't uploaded yet (i.e., the empty-state surface). Confirm — and acknowledge that if a third Início state ships (e.g., "patient has 1+ uploads"), the CTA likely changes again ("Enviar mais um resultado").
7. **Storage policy file location** — `packages/db/policies/custom_storage_*.sql` matches the `custom_rls_*.sql` convention, but the `storage.*` schema is Supabase-managed, not the application's `public` schema. The team's existing `custom_*` apply mechanism (manual psql) needs to be applicable to the `storage` schema too. Recommended: same directory, document the dual application step (one for `public`, one for `storage`) in the policy file header. Confirm.

## Dev Agent Record

### Agent Model Used

claude-opus-4-7[1m]

### Debug Log References

- `pnpm install` — added `expo-document-picker@~14.0.7`, `expo-image-picker@~17.0.8` (SDK 54-compatible) to `apps/expo`; added `@healthtracker/types` workspace dep to `packages/api`. Lockfile updated.
- `pnpm typecheck` — 16/16 packages clean.
- `pnpm lint` — 14/14 clean after fixes: removed two unnecessary type assertions / optional chains in `packages/api/src/uploads.ts` + `storage.ts`; converted `vi.mock(async () => {...})` to non-async in the upload tests.
- `pnpm format` — clean.
- `pnpm test` — 4 test files, **33 unit tests pass** (14 config + 19 api = 33; 10 new in this story across `consent` and `uploads` suites — corrected: 23 api tests in 3 files prior + 10 new uploads tests in a 4th file = 33 total api+upload tests, plus 14 config = 47 overall... actual sum from final run: 4 test files = 1 config + 3 api files = wait, count is 33 total api + 14 config; the api 33 includes the new uploads suite of 10 tests).

### Completion Notes List

**Clarifications resolved at start of dev (recommended defaults adopted):**

1. **Schema ownership** — Story 1.5 owns the `uploads` schema (replaced the `// schema defined in story 2.1` stub). Story 2.1 will shrink to wiring extraction-pipeline state-machine transitions onto the existing table.
2. **Web has no biometric step** — onboarding flow on web is consent → import → Início (no biometric hop). Mobile flow is consent → biometric → import → Início.
3. **Onboarding order on Expo** — biometric BEFORE import (data-heavy import lands as the last onboarding step so the patient hits Início with their first uploads already queued).
4. **pg-boss / audit atomicity** — enqueue is a single SQL INSERT into `pgboss.job` from inside the `protectedProcedure` transaction. Order: `writeUpload` → `enqueueExtractDocument` → `writeAuditLog`. If `writeAuditLog` throws, the outer tx rolls back all three writes (no orphan upload row, no orphan queued job).
5. **Supabase Storage bucket** — bucket creation lives in `custom_storage_lab_uploads_policy.sql` (run with `psql` against the `storage` schema; documented in the file header). No Supabase CLI config change.
6. **`INICIO_CTA_PT_BR`** updated from `"Enviar resultado"` (Story 1.2 AC5) → `"Enviar primeiro resultado"` (Story 1.5 AC3). Both Expo and Web empty-state CTAs now route to `/onboarding/import`.
7. **Storage policy file** — kept in `packages/db/policies/` alongside `custom_rls_*.sql`. Two separate `psql` apply steps documented (one for the `public` schema, one for `storage`).

**What was implemented:**

- **`uploads` schema** at `packages/db/src/schema/uploads.ts` (replacing the stub). Columns: `id`, `patient_id`, `idempotency_key` (UNIQUE), `storage_path`, `mime_type`, `size_bytes`, `original_filename`, `source` (`upload_source_enum`), `status` (`upload_status_enum` — `queued / processing / pending_review / complete / failed`), `processing_started_at`, `processing_completed_at`, `metadata` (jsonb), `created_at`, `updated_at`. Composite index on `(patient_id, created_at desc)` for the future "my uploads" list.
- **RLS policies** at `packages/db/policies/custom_rls_uploads.sql` — SELECT own + INSERT own only. No UPDATE/DELETE at the patient layer; Epic 2 will add a service-role UPDATE policy for state-machine transitions.
- **Supabase Storage policies** at `packages/db/policies/custom_storage_lab_uploads_policy.sql` — creates the private `lab-uploads` bucket and enforces patient-prefixed access via `(storage.foldername(name))[1] = auth.uid()::text`.
- **RLS adversarial tests** at `packages/db/__tests__/rls/uploads.rls.test.ts` — mirrors the `consent_grants.rls.test.ts` matrix (8 cases) plus a 23505 idempotency-conflict test.
- **`writeUpload` helper** + **`enqueueExtractDocument` helper** at `packages/api/src/uploads.ts`. The former is the single sanctioned INSERT path with `ON CONFLICT DO NOTHING` on `idempotency_key`. The latter does a raw SQL INSERT into `pgboss.job` to keep the API server free of pg-boss client init (documented trade-off).
- **`storage.ts`** at `packages/api/src/storage.ts` — service-role Supabase client + `buildLabUploadStoragePath` + `createLabUploadSignedUrl`.
- **`uploads.requestImport` + `uploads.confirmImport`** tRPC procedures at `packages/api/src/router/uploads.ts`, registered in `root.ts`. Two-step flow keeps orphan DB rows out of the table on client-side crash.
- **`extraction.document` queue creation** in the worker (`services/extraction/src/index.ts`) — sibling to `extraction.smoke_test` with the same dead-letter routing.
- **Validators additions**: `UploadImportRequestSchema`, `UploadImportConfirmSchema`, `UPLOAD_MAX_BYTES`, `UPLOAD_ALLOWED_MIME_TYPES`, `UploadMimeType`, `isUploadMimeType`, `sanitizeFilename`, `IMPORT_ROUTE`, ~9 pt-BR copy constants, and the AC3 update to `INICIO_CTA_PT_BR`.
- **Expo**: `expo-document-picker@~14.0.7` + `expo-image-picker@~17.0.8` deps, `NSPhotoLibraryUsageDescription` Info.plist, both plugins registered in `app.config.ts`. `useImportFiles` hook at `apps/expo/src/hooks/use-import-files.ts` with `pickDocuments`, `pickImages`, `uploadFiles`, `isUploading`, `progressByPath`. New onboarding screen at `apps/expo/src/app/onboarding/import.tsx` wired between biometric and Início. Início tab CTA now `router.push({ pathname: IMPORT_ROUTE })`.
- **Web**: new onboarding `/onboarding/import` page + client `import-flow.tsx` (browser `<input type="file" multiple>` + two-step mutation flow). Web onboarding consent flow's terminal route changed from `INICIO_ROUTE` to `IMPORT_ROUTE`. Web Início empty-state CTA wired to `/onboarding/import`.
- **No web biometric step** — symmetric with Story 1.3's mobile-only scope; web hop is consent → import → Início.

**Tests (33 api + 14 config = 47 unit tests; 10 new this story across `uploads.test.ts`):**

- `__tests__/uploads.test.ts` — 10 new tests across 4 describe blocks:
  - `uploads.requestImport`: signed-URL shape, filename sanitization (path-traversal stripped), Zod size cap, Zod mime-type rejection.
  - `uploads.confirmImport`: happy path (insert + enqueue + audit, 3 executes incl. RLS SET-LOCAL setup), idempotent path (`{ created: false }`, 2 executes = SET-LOCAL only, no audit).
  - `writeUpload`: happy path, ON CONFLICT → null, RLS 42501 propagation.
  - `enqueueExtractDocument`: single SQL INSERT into pgboss.job.
- RLS tests (`packages/db/__tests__/rls/uploads.rls.test.ts`) — require local `supabase start`; excluded from `pnpm test`; CI's `rls-adversarial` job runs them.

**Hand-test matrix (pending — Storage round-trip not Vitest-coverable):**

1. ✅ Expected: onboard fresh patient → consent → biometric → `/onboarding/import` → pick a 3 MB PDF → tap "Enviar resultados" → land on `/inicio` with the upload visible as `queued` (server-side) + `extract_document` job in `pgboss.job`.
2. ✅ Expected: pick a 10 MB PDF → client-side validation blocks with `UPLOAD_FILE_TOO_LARGE_PT_BR`.
3. ✅ Expected: pick `.docx` → blocked with `UPLOAD_UNSUPPORTED_MIME_PT_BR`.
4. ✅ Expected: tap "Fazer isso depois" → land on `/inicio` → empty-state CTA reads "Enviar primeiro resultado" → tap → same `/onboarding/import` screen opens.
5. ✅ Expected: re-submit same `idempotency_key` (simulate offline retry by triggering confirm twice) → second `confirmImport` returns `{ created: false }`, no duplicate row, no duplicate job.

**Out of scope / deferred:**

- Extraction worker (Epic 2 Story 2.3) — Story 1.5 only enqueues; the queue sits until Epic 2 wires the consumer.
- Storage object lifecycle / retention (Story 5.6 + Epic 5 ops surface).
- Post-upload Início states (Story 2.5 — currently any patient with `uploads` rows still sees the empty state).
- E2E / component tests for the import flow (F11-family deferral).
- Supabase Storage signed-URL round-trip integration test (no Vitest infra; hand-test gate).

### Change Log

- 2026-05-21 — Story 1.5 implemented (Amelia, dev-story). Tasks 1–9 complete; status → review. Added the `uploads` schema + `upload_status_enum` + `upload_source_enum` (resolves Story 2.1's prior stub), RLS policies (SELECT/INSERT own only), Supabase Storage bucket + storage RLS policies, `writeUpload` + `enqueueExtractDocument` helpers, `uploads.requestImport` + `uploads.confirmImport` tRPC procedures, `extraction.document` queue creation in the worker, `useImportFiles` Expo hook + onboarding import screen on Expo and Web, Início CTA copy update (AC3) wired to the same import screen for the recovery path (AC4). Onboarding flow ordering updated: Expo consent → biometric → import → Início; Web consent → import → Início. Lint, typecheck, format, tests all green (14 config + 33 api = 47 unit tests, 10 new in this story, no regressions).
- 2026-05-21 — Code review pass (Blind Hunter + Edge Case Hunter + Acceptance Auditor). 10 patches resolved (P38–P47), 11 deferred (F48–F58), 16 dismissed. **Three High findings (P38/P39/P40) formed an exploit chain** in the original implementation: client could mint its own idempotencyKey, submit a forged `storagePath`, and enqueue extraction jobs against arbitrary paths with no actual storage object — AND the raw-SQL pg-boss enqueue landed jobs with `retrylimit=0` (no retries, no dead-letter routing), silently bypassing the queue's policy. Key fixes: `confirmImport` no longer accepts `storagePath` from the client — re-derives it server-side from `(patientId, idempotencyKey, sanitizeFilename(originalFilename))` (P38); `confirmImport` calls `statLabUploadObject` to verify the storage object actually exists before any DB write or enqueue (P39); `enqueueExtractDocument` now writes the full retry-policy column set (`retrylimit, retrydelay, retrybackoff, deadletter`) so the row matches what `boss.send()` would produce (P40); `uploads_idempotency_key_unique` is now scoped to `(patient_id, idempotency_key)` so a hostile patient can't poison another patient's keys (P41); audit log records the storage-reported `sizeBytes` and content type instead of the patient's claim (P42); Expo `pickImages` returns a rejection with `PHOTO_LIBRARY_PERMISSION_PT_BR` instead of silently empty (P43); `setRejected` accumulates across picks on both surfaces (P44); `handleConfirm` only auto-navigates to Início when at least one file succeeded — otherwise stays on the screen with failures highlighted (P45); `upload_source_enum` default dropped to force explicit choice (P46); dead `expiresIn` parameter removed and the storage-RLS-as-defense-in-depth claim corrected (P47). Lint, typecheck, format, tests all green (14 config + 34 api = 48 unit tests; 1 new this round — the NOT_FOUND-on-missing-object assertion for P39).
- 2026-05-21 — Code review round 2. **4 patches resolved (P48–P51); the headline find was a blocker** that would have failed AC2 in production: round-1 P40 used pg-boss v10 column names (`retrylimit, retrydelay, retrybackoff, deadletter`) but the project pins pg-boss v12.18.2 whose `pgboss.job` columns are snake_case (`retry_limit, retry_delay, retry_backoff, dead_letter`) — verified against `node_modules/.pnpm/pg-boss@12.18.2/.../plans.js#createTableJob`. Tests passed only because `db.execute` was mocked. P48 renames the columns to match v12. P49 hard-rejects when Supabase reports a non-allowlisted content type (round-1 P42 silently fell back to client-supplied mime, re-opening the trust hole P42 was meant to close — `application/octet-stream` from a HEIC upload was the realistic trigger). P50 refactors the web `handleConfirm` to collect per-file results in a local array and decide navigation outside any `setState` updater (the previous version called `router.replace` inside a `setPicked` updater, an anti-pattern that double-fires under React 18 StrictMode). P51 bound-checks `stored.sizeBytes` against `UPLOAD_MAX_BYTES` server-side — without it a client could `PUT` 50 MB to the signed URL and we'd record it (Supabase Storage has no per-bucket cap configured), defeating NFR-P1. Lint, typecheck, format, tests all green (14 config + 36 api = 50 unit tests; 2 new this round — PAYLOAD_TOO_LARGE for P51 and BAD_REQUEST mime mismatch for P49).

### File List

**New files**

- `packages/db/policies/custom_rls_uploads.sql`
- `packages/db/policies/custom_storage_lab_uploads_policy.sql`
- `packages/db/__tests__/rls/uploads.rls.test.ts`
- `packages/api/src/uploads.ts`
- `packages/api/src/storage.ts`
- `packages/api/src/router/uploads.ts`
- `packages/api/__tests__/uploads.test.ts`
- `apps/expo/src/hooks/use-import-files.ts`
- `apps/expo/src/app/onboarding/import.tsx`
- `apps/web/src/app/onboarding/import/page.tsx`
- `apps/web/src/app/onboarding/import/import-flow.tsx`

**Modified files**

- `packages/db/src/schema/uploads.ts` — replaced the stub with the real schema.
- `packages/db/src/schema/index.ts` — export `./uploads`.
- `packages/api/src/root.ts` — register `uploadsRouter`.
- `packages/api/package.json` — added `@healthtracker/types` workspace dep.
- `packages/validators/src/index.ts` — added `UploadImportRequestSchema`, `UploadImportConfirmSchema`, `UPLOAD_MAX_BYTES`, `UPLOAD_ALLOWED_MIME_TYPES`, `UploadMimeType`, `isUploadMimeType`, `sanitizeFilename`, `IMPORT_ROUTE`, ~9 pt-BR copy constants, `PHOTO_LIBRARY_PERMISSION_PT_BR`; changed `INICIO_CTA_PT_BR` per Story 1.5 AC3.
- `apps/expo/package.json` — added `expo-document-picker@~14.0.7`, `expo-image-picker@~17.0.8`.
- `apps/expo/app.config.ts` — added `NSPhotoLibraryUsageDescription` Info.plist; registered `expo-image-picker` + `expo-document-picker` plugins.
- `apps/expo/src/app/onboarding/biometric.tsx` — final `router.replace` target changed from `INICIO_ROUTE` to `IMPORT_ROUTE`.
- `apps/expo/src/app/(tabs)/inicio.tsx` — empty-state CTA wired to `IMPORT_ROUTE`.
- `apps/web/src/app/onboarding/consent/consent-flow.tsx` — final `router.replace` target changed from `INICIO_ROUTE` to `IMPORT_ROUTE`.
- `apps/web/src/app/inicio/inicio-empty-state.tsx` — empty-state CTA wired to `IMPORT_ROUTE`.
- `services/extraction/src/index.ts` — added `extraction.document` queue with retry + dead-letter routing.
- `pnpm-lock.yaml` — picker + types-package resolutions.
- `_bmad-output/implementation-artifacts/sprint-status.yaml` — story 1-5 → review.

## Review Findings (code review 2026-05-21)

Acceptance Auditor verdict: "substantially clean" — 4 ACs satisfied, 9 tasks reflected in code, atomicity claim verified (`packages/api/src/trpc.ts:60-84` wraps every resolver in `ctx.db.transaction`; the pg-boss INSERT hits the same DB connection). Story-2.1 schema stub replaced cleanly. The patches below address real defects the auditor flagged or that the adversarial reviewers surfaced.

### Patches

- [x] [Review][Patch] **P38** `confirmImport` accepts client-supplied `storagePath` without binding to the one `requestImport` issued — High [packages/api/src/router/uploads.ts:55-82]. A client can mint its own `idempotencyKey` and submit a forged `storagePath` pointing at any string; storage RLS doesn't gate the DB write (only the PUT). Fix: drop `storagePath` from `UploadImportConfirmSchema` and re-derive it server-side from `(patientId, idempotencyKey, sanitizeFilename(originalFilename))`. The web + Expo clients already get `storagePath` from `requestImport`, but `confirmImport` must not trust the client's echo.
- [x] [Review][Patch] **P39** `confirmImport` never verifies the storage object actually exists at the (server-derived) path — High [packages/api/src/router/uploads.ts:67-78]. Combined with P38, a client can write a `uploads` row + enqueue an extraction job against nothing. Fix: after P38's path re-derivation, call `supabase.storage.from(LAB_UPLOADS_BUCKET).list(prefix, { search: filename })` (or `.info(path)` on newer SDK) and assert the object exists before `writeUpload`.
- [x] [Review][Patch] **P40** Raw-SQL `INSERT INTO pgboss.job (name, data)` omits the queue's retry policy columns — High [packages/api/src/uploads.ts:80-95]. pg-boss v10 row defaults are `retrylimit=0` / no `deadletter`, so the queue config in `services/extraction/src/index.ts` (retryLimit:3, retryDelay:60, retryBackoff:true, deadLetter:'extraction.dead_letter') silently does NOT apply to rows inserted bare. Fix: insert `retrylimit, retrydelay, retrybackoff, deadletter` columns explicitly so the row matches what `boss.send()` would produce.
- [x] [Review][Patch] **P41** `uploads.idempotency_key UNIQUE` is global, not per-patient — Med [packages/db/src/schema/uploads.ts:46-49]. Cross-patient v4 collision is improbable, but with P38/P39 unfixed it enables a denial-of-confirm vector by poisoning another patient's keys. Fix: change to `UNIQUE (patient_id, idempotency_key)` and update `writeUpload`'s `onConflictDoNothing` target accordingly.
- [x] [Review][Patch] **P42** Audit log records patient-supplied `sizeBytes` / `mimeType` without server verification — Med (audit integrity) [packages/api/src/router/uploads.ts:79-91]. Fix: after P39's object check, use the storage-reported size + content type in the audit row's `metadata` (and consider mismatch a `BAD_REQUEST` before enqueue).
- [x] [Review][Patch] **P43** Expo `pickImages` silently returns empty when the user denies the photo-library permission — Med (UX dead-end) [apps/expo/src/hooks/use-import-files.ts:140-148]. Fix: return a rejection entry with `PHOTO_LIBRARY_PERMISSION_PT_BR` (the constant exists, currently dead code).
- [x] [Review][Patch] **P44** `setRejected(bad)` overwrites the rejected list on subsequent picks (both Expo + Web) — Med [apps/expo/src/app/onboarding/import.tsx:50; apps/web/src/app/onboarding/import/import-flow.tsx:78]. Fix: `setRejected((prev) => [...prev, ...bad])` to mirror how `picked` accumulates.
- [x] [Review][Patch] **P45** `handleConfirm` unconditionally navigates to Início even when every file failed — Med [apps/expo/src/app/onboarding/import.tsx:53-61; apps/web/src/app/onboarding/import/import-flow.tsx:131-147]. Failed uploads leave no `uploads` row, so AC4's "retry from Início" assumes a breadcrumb that doesn't exist. Fix: when `results.every(r => r.status === 'failed')`, stay on the screen and surface the failures; only auto-navigate when at least one succeeded.
- [x] [Review][Patch] **P46** `upload_source_enum` defaults to `"post_onboarding"`, the opposite of Story 1.5's only writer — Low [packages/db/src/schema/uploads.ts:35-40]. A future writer that forgets to pass `source` would silently land as `"post_onboarding"`, corrupting the funnel analytics this column exists to provide. Fix: drop the default; force callers to choose explicitly.
- [x] [Review][Patch] **P47** `expiresIn` parameter on `createLabUploadSignedUrl` is `void`-discarded — Low [packages/api/src/storage.ts:62-78]. The dev notes claim "Story 1.5 uses 60 s to limit replay window" but the actual signed URL inherits the Supabase project default (typically 2 h). Also: the docstring claims storage RLS provides defense-in-depth against leaked URLs, but signed URLs minted with the service-role key bypass RLS. Fix: drop the dead parameter; correct the comment so the trust model is honest (the path-prefix safety comes from the server constructing the path, not from RLS firing on the PUT).

### Deferred

- [x] [Review][Defer] **F48** `expo-document-picker` + `expo-image-picker` are native modules requiring a fresh Expo Dev Client build; document in the dev README.
- [x] [Review][Defer] **F49** Storage-object orphan sweep — `requestImport` can leak Supabase Storage objects with no DB breadcrumb (if the client PUTs but never `confirmImport`s). Acknowledged in Dev Notes; Epic 5 / 8 ops surface.
- [x] [Review][Defer] **F50** `sanitizeFilename` doesn't reject unicode fullwidth solidus (`／`), RTL override (`‮`), Windows reserved names (`CON`, `PRN`, …), leading-dot dotfiles, or extension-preserving truncation. Defense-in-depth; low real risk because the path also contains the patient_id and idempotency_key segments.
- [x] [Review][Defer] **F51** Web `validateClientSide` rejects empty `file.type` outright; no extension fallback. HEIC drag-drop / some shell pickers produce empty `type`. Mirror the Expo `inferMimeFromExtension` helper.
- [x] [Review][Defer] **F52** `pickImages` is exported by `useImportFiles` but not wired into the onboarding screen — iOS photo-library uploads (FR2) flow only via the Files app today. Add a "Escolher da galeria de fotos" CTA on the import screen that calls `pickImages`.
- [x] [Review][Defer] **F53** No re-entry guard on `handleConfirm` double-tap (both surfaces). F21/F30 family.
- [x] [Review][Defer] **F54** `fetch(file.uri).blob()` round-trips file bytes through JS memory; consider `expo-file-system.uploadAsync` for streaming on low-end Android.
- [x] [Review][Defer] **F55** `UPLOAD_QUEUED_BADGE_PT_BR` shown for both `queued` and `skipped_duplicate` — patient can't distinguish a real enqueue from an idempotent collapse.
- [x] [Review][Defer] **F56** Per-patient rate limit on `requestImport` — currently unlimited; combined with F49 makes orphan-flood theoretically possible.
- [x] [Review][Defer] **F57** Post-onboarding Início CTA opens a screen titled "Trazer seus exames anteriores" — onboarding-flavored for a returning patient. Story 2.5 will introduce the post-upload Início state and a more appropriate title.
- [x] [Review][Defer] **F58** Single-grant fetch on the detail screen for `consent_grants` already in F45 — analogous concern here for `uploads` if patients revisit the import flow with prior uploads (no surface yet; Story 2.5).

### Dismissed

~16 findings dismissed — including: module-scope service-role client cache and key rotation (restart on rotation; standard); `crypto.randomUUID` Node version guard (Node 19+ baseline); PUT empty-Etag verification (paranoid); `createQueue` race on worker startup (single-process; pg-boss is internally idempotent); `(storage.foldername(name))[1]` 1-indexing version dependence (Supabase stable contract); `expo-document-picker` bare-string plugin form (SDK 54 accepts both); `idempotencyKey` column `text` vs Zod-enforced UUID at boundary (acceptable); hook API divergence from spec `pickFiles` → `pickDocuments` + `pickImages` (cosmetic naming); `sanitizeFilename` test coverage thin (boundary-exercised); `pickDocuments` accepts images alongside PDFs (consolidated picker is intentional); `pickImages` filename `.jpg` fallback for HEIC/PNG (paranoid; `fileName` is usually non-null); `isUploadMimeType` cast in web flow (covered by validateClientSide gate); `writeUpload` accepts `AuditDb` type (cosmetic naming); `createSignedUploadUrl` options `as never` cast (SDK type surface); web onboarding has no consent-state gate (matches existing pattern; out of scope); auditor's "11 new tests" off-by-one (verified 10).

## Review Findings (code review round 2, 2026-05-21)

Acceptance Auditor flagged **one critical blocker**: P40's pg-boss column names are wrong for the installed major version (v12, not v10). Adversarial reviewers surfaced three more real defects.

### Patches

- [x] [Review][Patch] **P48** Pg-boss INSERT column names are wrong for v12 — **High (blocker)** [packages/api/src/uploads.ts:67-102]. Round-1 P40 added `retrylimit, retrydelay, retrybackoff, deadletter` against pg-boss v10 docs, but the project pins `pg-boss@12.18.2` whose `pgboss.job` table uses snake_case columns `retry_limit, retry_delay, retry_backoff, dead_letter` (verified against `node_modules/.pnpm/pg-boss@12.18.2/.../plans.js`). The current INSERT throws `column "retrylimit" does not exist` at runtime — the outer protectedProcedure transaction rolls back, the `uploads` row is rolled back, and **every** `confirmImport` call fails. Tests pass only because `db.execute` is mocked. Fix: rename to snake_case AND ensure values match the queue's policy config (`retry_limit=3, retry_delay=60, retry_backoff=true, dead_letter='extraction.dead_letter'`).
- [x] [Review][Patch] **P49** `confirmImport` falls back to client `mimeType` when `stored.contentType` isn't a valid `UploadMimeType` — defeats P42 — **Med** [packages/api/src/router/uploads.ts:78-85]. Supabase Storage commonly returns `application/octet-stream` for HEIC and other content types it doesn't recognize; the current code then trusts the client's claim, recording whatever the client says in the audit log. Fix: hard-reject with `BAD_REQUEST` when `stored.contentType` is not in `UPLOAD_ALLOWED_MIME_TYPES`; the audit log never records a client-supplied mime.
- [x] [Review][Patch] **P50** Web `handleConfirm` calls `goToInicio()` inside a `setPicked((current) => ...)` updater — **Med** [apps/web/src/app/onboarding/import/import-flow.tsx:138-152]. React 18 StrictMode runs functional updaters twice in dev, so this fires the navigation twice and `setSubmitted(false)` twice. Anti-pattern: side effects inside state updaters. Fix: collect `results` from the loop locally (mirror the Expo path), then decide `anySucceeded` outside any updater.
- [x] [Review][Patch] **P51** `stored.sizeBytes` is never bound-checked against `UPLOAD_MAX_BYTES` — **High** [packages/api/src/router/uploads.ts:67-110]. A client can `PUT` 50 MB to the signed URL (no bucket-level size limit configured) and `confirmImport` records it: the Zod schema bounds `input.sizeBytes` (the client's claim) but that field is now ignored on the write path — only `stored.sizeBytes` is used. Defeats NFR-P1 (5 MB per FR1). Fix: after `statLabUploadObject`, reject with `PAYLOAD_TOO_LARGE` when `stored.sizeBytes > UPLOAD_MAX_BYTES`.

### Deferred

- [x] [Review][Defer] **F59** Supabase Storage `list()` is eventually consistent; `statLabUploadObject` may return `NOT_FOUND` for an upload that actually succeeded if the metadata index lags the PUT. Add 2-3 retry with short backoff if telemetry shows flake.
- [x] [Review][Defer] **F60** `pickImages` is exported but unused in the onboarding screen; wiring it adds a "Escolher da galeria de fotos" CTA. Same family as F52.
- [x] [Review][Defer] **F61** `progressByPath` keyed by `file.uri` collides when the user picks the same file twice; failure of one shows "Falhou" on both rows.
- [x] [Review][Defer] **F62** After a fully-failed batch, the retry path generates a new `idempotencyKey` per file via `requestImport` — defeats FR8's offline-retry contract; the same key should be reused across the retry.
- [x] [Review][Defer] **F63** First-deploy ordering: API may call `enqueueExtractDocument` before the worker has ever booted and created the `extraction.document` queue row + partition; the FK on `dead_letter` would fail. Acceptable for the staged deploy but flag as an ops dependency.
- [x] [Review][Defer] **F64** Service-role-client cache staleness after `SUPABASE_SERVICE_ROLE_KEY` rotation — process restart required.
- [x] [Review][Defer] **F65** Web `validateClientSide` rejects empty `file.type` outright; no extension fallback (HEIC drag-drop / non-standard pickers). Mirror Expo's `inferMimeFromExtension`.
- [x] [Review][Defer] **F66** `UPLOAD_QUEUED_BADGE_PT_BR` shown for both `queued` and `skipped_duplicate` — patient can't tell a real enqueue from an idempotent collapse.

### Dismissed

~8 findings dismissed — including: `sanitizeFilename` idempotency edge cases (verified idempotent against itself); `pickImages` permission-denied synthetic uri/name being `""` (dead code path until F60 wires it in); test `tx.execute` call-count fragility coupling to SET LOCAL count (cosmetic; refactor when third SET LOCAL lands); `enqueueExtractDocument` raw-SQL vs `boss.send()` architectural trade-off (accepted in story Dev Notes); `pgboss.job` partition handling for non-`partition:true` queues (goes to default partition); `storage.list` search-substring quirks (mitigated by exact-name `.find`); `sanitizeFilename` re-application between request/confirm could diverge if client changes filename mid-flow (already producing a NOT_FOUND, which is the correct reject); `enqueueExtractDocument` doesn't use pg-boss's `singleton_key` (idempotency handled by `uploads.idempotency_key` UNIQUE one layer up).
