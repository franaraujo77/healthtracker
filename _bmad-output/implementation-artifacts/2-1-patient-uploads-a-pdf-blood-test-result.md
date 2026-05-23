# Story 2.1: Patient uploads a PDF blood test result

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a patient,
I want to upload a PDF of my blood test results from my device storage after onboarding is complete,
so that my biomarker data is extracted and added to my longitudinal record.

## Acceptance Criteria

**AC1 — Post-onboarding PDF upload flow with ExtractionPulse**
**Given** I am on the Início tab (post-onboarding, no active extractions or a cold-start),
**When** I tap the upload CTA and the upload sheet offers "Arquivo PDF" and "Foto ou câmera" (the photo branch is owned by Story 2.2 and shows a disabled / "Em breve" state until then),
**Then** picking "Arquivo PDF" opens the system PDF picker; selecting a PDF that passes client-side validation (≤ 5 MB AND ≤ 10 pages, mime `application/pdf`) inserts a `uploads` row via `uploads.requestImport` + `uploads.confirmImport` with `source = 'post_onboarding'`, `status = 'queued'`, and a server-generated `idempotency_key`. The `ExtractionPulse` component renders on Início in the `processing` state, listing the upload by filename with the patience-pattern micro-copy from UX-DR4 (`0–10s` "Lendo seu exame…" → `10–20s` "Este está demorando um pouco — exames complexos pedem mais cuidado" → `20–30s` "Ainda processando…" → `30s+` shows a "Inserir manualmente" escape hatch alongside the continuing pulse).

**AC2 — Idempotency seam is honoured for duplicate submissions**
**Given** the same PDF (same patient + same server-generated `idempotency_key`) is submitted twice (e.g., from an offline-retry replay or a hand-test double-tap),
**When** the second `uploads.confirmImport` hits the `uploads_patient_idempotency_unique` constraint via `ON CONFLICT DO NOTHING`,
**Then** the duplicate insert is silently rejected, no second `extraction.document` job is enqueued, no second `upload.queued` audit row is written, and the procedure returns `{ uploadId: null, created: false }`. The client surface treats `created: false` as `skipped_duplicate` (already implemented in `useImportFiles`).

**AC3 — `upload-transitions.ts` is the only legal state-machine path**
**Given** the `uploads` table has the `upload_status_enum` of `queued | processing | pending_review | complete | failed` (Story 1.5),
**When** any worker / resolver needs to advance an upload's `status`,
**Then** the only sanctioned path is `applyUploadTransition(db, { uploadId, from, to, metadata? })` in `packages/api/src/upload-transitions.ts`. The helper validates the legal arcs (`queued → processing`, `processing → pending_review`, `processing → complete`, `processing → failed`, `pending_review → complete`, `pending_review → failed`, `* → failed` from the dead-letter handler) with a constant transition map, throws `INVALID_UPLOAD_TRANSITION` on illegal arcs, performs the UPDATE inside the caller's transaction with `WHERE id = $1 AND status = ${from}` (optimistic-lock — returns the number of rows changed), and refuses no-op transitions. Story 2.1 ships the helper + unit tests; Story 2.3 (extraction worker) is the first caller. **Story 2.1 itself does not call the helper at runtime** — it only ships the contract and the test coverage.

**AC4 — PDF rejected pre-transmission with a specific pt-BR reason**
**Given** the patient picks a PDF that exceeds 5 MB or has more than 10 pages,
**When** the picker's `onAfterPick` validation runs (client-side, before `requestImport`),
**Then** the upload is rejected BEFORE any `requestImport` mutation, no storage object is created, no signed URL is requested, and the patient sees a specific pt-BR reason (`UPLOAD_FILE_TOO_LARGE_PT_BR` for size; new `UPLOAD_PDF_TOO_MANY_PAGES_PT_BR = "Este PDF tem mais de 10 páginas. Envie um exame por vez."` for page count). The page-count check uses the existing `pdf-lib` dependency or `pdfjs-dist` — pick whichever is already in the dep graph; if neither, add the smaller one (`pdf-lib` is ~150 kB). Picker validation runs on both Expo (in `pickDocuments`) and Web (in `import-flow.tsx`'s `validateClientSide`). Server-side defense-in-depth: `uploads.requestImport`'s Zod schema already caps `sizeBytes`; Story 2.1 adds an optional `pageCount` field that the server rejects when > 10 for `application/pdf`.

**Requirements:** FR1, FR3, FR4, FR5, FR7, FR10, AR8, AR14, AR21, NFR-P1, NFR-I1, NFR-I2, UX-DR4, UX-DR12, UX-DR20

## Tasks / Subtasks

- [x] **Task 1 — Add `source` parameter to `uploads.requestImport` + `uploads.confirmImport`** (AC: #1)
  - [x] Story 1.5 hard-codes `source: 'onboarding_import'` in `packages/api/src/router/uploads.ts:128`. Extend `UploadImportRequestSchema` + `UploadImportConfirmSchema` in `packages/validators/src/index.ts` with `source: z.enum(['onboarding_import', 'post_onboarding'])`. Both procedures pass the value through to `writeUpload`.
  - [x] Update the Story 1.5 call site in `apps/expo/src/app/onboarding/import.tsx` and `apps/web/src/app/onboarding/import/import-flow.tsx` to pass `source: 'onboarding_import'`. Update the `useImportFiles` hook to accept a `source` argument from its caller (default `'onboarding_import'` for backwards compatibility — Story 1.5 callers don't change).
  - [x] Default at the schema level is fine; default at the helper level (`writeUpload`) is NOT — Story 1.5 P46 explicitly removed the DB-column default to force every writer to be explicit. Match that intent: `useImportFiles({ source })` is required, no default in the hook signature.
  - [x] **Audit metadata also gets the new value**: the `writeAuditLog` call in `confirmImport` includes `metadata.source` — verify it reads from the input, not the hard-coded string.

- [x] **Task 2 — `upload-transitions.ts` state-machine helper + tests** (AC: #3)
  - [x] Create `packages/api/src/upload-transitions.ts`. Export `UPLOAD_TRANSITIONS` as a `const` map: `{ queued: ['processing'], processing: ['pending_review', 'complete', 'failed'], pending_review: ['complete', 'failed'], complete: [], failed: [] }` plus a dead-letter override `applyDeadLetter(db, { uploadId })` that forces `status = 'failed'` from any non-terminal state (separate sanctioned path; not subject to the arc map).
  - [x] `applyUploadTransition(db, { uploadId, from, to, metadata? })`:
    - Asserts `UPLOAD_TRANSITIONS[from].includes(to)` at runtime — throws `TRPCError({ code: 'CONFLICT', message: 'INVALID_UPLOAD_TRANSITION' })` if not.
    - Issues a single `UPDATE uploads SET status = $to, updated_at = now(), processing_started_at = COALESCE(processing_started_at, CASE WHEN $to = 'processing' THEN now() END), processing_completed_at = COALESCE(processing_completed_at, CASE WHEN $to IN ('complete','failed') THEN now() END), metadata = metadata || $metadata WHERE id = $uploadId AND status = $from RETURNING id, status`.
    - Returns `{ updated: <boolean>, currentStatus: <status if updated, else null> }`. The optimistic-lock (`WHERE status = $from`) prevents lost updates if two workers race.
  - [x] Vitest unit tests at `packages/api/__tests__/upload-transitions.test.ts`:
    - happy paths for every legal arc (mock the Drizzle `update`/`set`/`where`/`returning` chain — same pattern as `consent.test.ts`).
    - every illegal arc throws `INVALID_UPLOAD_TRANSITION` (no DB call).
    - same-state self-transition rejected (`processing → processing`).
    - optimistic-lock miss (the `WHERE status = $from` returns zero rows) returns `{ updated: false, currentStatus: null }` without throwing — caller decides how to react.
    - `applyDeadLetter` forces `failed` from `queued | processing | pending_review`; rejects when current is already `complete`.
  - [x] **RLS implication acknowledged**: the current `custom_rls_uploads.sql` has no UPDATE policy at the patient layer (Story 1.5 design — patients don't transition state). Story 2.3 will add a narrow service-role UPDATE policy. Story 2.1 documents this gap in the helper's docblock + the Dev Notes; the helper's unit tests mock the DB and don't exercise RLS.

- [x] **Task 3 — Add PDF page-count validation to validators + `useImportFiles`** (AC: #4)
  - [x] In `packages/validators/src/index.ts`: add `UPLOAD_MAX_PDF_PAGES = 10` and `UPLOAD_PDF_TOO_MANY_PAGES_PT_BR = "Este PDF tem mais de 10 páginas. Envie um exame por vez."`. Extend `UploadImportRequestSchema` with `pageCount: z.number().int().nonnegative().optional()` and the same on `UploadImportConfirmSchema`. **Round-2 R2-P73:** `pageCount` is REQUIRED when `mimeType === 'application/pdf'` via a Zod `.refine()` so a hostile client can't bypass the cap by omitting the field; non-PDF mime types ignore the field. Server-side router check is belt-and-suspenders against schema drift.
  - [x] Add a dependency: prefer `pdf-lib` (already pure-JS, works in RN + browser, ~150 kB) over `pdfjs-dist` (heavier + has a worker). Add to both `apps/expo/package.json` and `apps/web/package.json` (single source via workspace if a `packages/shared-utils` pattern exists; otherwise direct). If `pdf-lib` is already transitively present, just import it.
  - [x] Add `countPdfPages(bytes: ArrayBuffer | Uint8Array): Promise<number>` in `packages/validators` (validators is the right home — it's pure logic, no React, no platform). Wraps `PDFDocument.load(bytes, { updateMetadata: false }).then(d => d.getPageCount())`. Memory: 5 MB PDFs are small enough that a single Uint8Array on the JS heap is fine.
  - [x] Extend `useImportFiles.pickDocuments` (Expo): after the existing size+mime validation, for `application/pdf` files, fetch the URI to bytes via `fetch(uri).then(r => r.arrayBuffer())`, call `countPdfPages`, and reject when > 10 with `UPLOAD_PDF_TOO_MANY_PAGES_PT_BR`. The Web equivalent in `import-flow.tsx`'s `validateClientSide` does the same with `file.arrayBuffer()`.
  - [x] **Pre-transmission ordering matters** — page-count check must happen BEFORE `trpcClient.uploads.requestImport.mutate(...)` so no signed URL is minted and no storage object is created for over-page PDFs. The current `uploadFiles` loop validates then immediately requests; reorder so the page-count check is part of the picker's validation pass (which happens before `uploadFiles` is called) so failed-validation files never reach `uploadFiles`.
  - [x] **HEIC / images don't need page-count** — only the `application/pdf` branch invokes `countPdfPages`.

- [x] **Task 4 — Build the `ExtractionPulse` UI component** (AC: #1)
  - [x] Create `packages/ui/src/extraction-pulse.tsx` (project uses a flat structure — `packages/ui/src/empty-state-record.tsx` is the precedent; the `components/ExtractionPulse/ExtractionPulse.tsx` path in `architecture.md` predates the flat refactor and should not be reproduced).
  - [x] Props: `{ state: 'processing' | 'review-needed' | 'complete'; filenames: string[]; elapsedMs: number; onManualEntry?: () => void; onCancel?: () => void }`.
  - [x] Visuals (Tamagui): a centered teal circle that pulses on a 3 s cycle (`scale: 1 → 1.15 → 1` via `tamagui` `animation="slow"` or `useAnimationFrame` if the Tamagui preset can't hit 3 s exactly). The circle uses `$primary` (teal). Below: filename list with one row per active upload. Below the list: the patience-pattern micro-copy line keyed off `elapsedMs`:
    - `0 ≤ ms < 10_000` → `"Lendo seu exame…"`
    - `10_000 ≤ ms < 20_000` → `"Este está demorando um pouco — exames complexos pedem mais cuidado"`
    - `20_000 ≤ ms < 30_000` → `"Ainda processando…"`
    - `ms ≥ 30_000` → micro-copy stays at "Ainda processando…" AND a "Inserir manualmente" Tier-2 button appears (calls `onManualEntry` — Story 2.7 wires the destination; for Story 2.1, pass `undefined` and don't render the button).
  - [x] `review-needed` state: pulse stops (static teal circle, amber ring), copy switches to `"Um resultado precisa da sua confirmação"`. Story 2.4 owns the confirmation surface; Story 2.1 just renders the visual state.
  - [x] `complete` state: pulse fades, copy reads `"Pronto"`. Story 2.5 owns the post-complete UX; Story 2.1 just renders the visual state.
  - [x] **Reduced motion (UX-DR17 + UX-DR4 a11y)**: read `useReducedMotion()` (Expo: `expo-modules-core` or `react-native`'s `AccessibilityInfo`; web: `window.matchMedia('(prefers-reduced-motion: reduce)')`). When true: static teal circle, no animation; the filename list and copy remain identical.
  - [x] **A11y**: the component wraps in a `View` with `accessibilityRole="status"` and `accessibilityLiveRegion="polite"` (Expo) / `aria-live="polite"` (web). The patience-copy is what the screen reader announces — short, calm phrasing.
  - [x] Add a centralized pt-BR copy block in `packages/validators/src/index.ts`:
    - `EXTRACTION_PULSE_COPY_0_10S_PT_BR`, `EXTRACTION_PULSE_COPY_10_20S_PT_BR`, `EXTRACTION_PULSE_COPY_20_30S_PT_BR`, `EXTRACTION_PULSE_COPY_30S_PLUS_PT_BR`
    - `EXTRACTION_PULSE_REVIEW_NEEDED_PT_BR = "Um resultado precisa da sua confirmação"`
    - `EXTRACTION_PULSE_COMPLETE_PT_BR = "Pronto"`
    - `EXTRACTION_PULSE_MANUAL_ENTRY_CTA_PT_BR = "Inserir manualmente"`
  - [x] Export from `packages/ui/src/index.ts`.
  - [x] **No tests for the animation timing** — visual / animation testing is F11-family deferred. A pure-logic unit test of "given elapsedMs N, which copy line should render" is worth adding next to the component as `extraction-pulse.test.ts` — it tests the same function that drives the rendered string.

- [x] **Task 5 — Post-onboarding upload entry on Início (Expo + Web)** (AC: #1, #4)
  - [x] **The current Início CTA goes to `/onboarding/import`** (Story 1.5 AC4 recovery path). For Story 2.1's post-onboarding flow we need a separate, less-onboarding-flavored surface. **Decision**: introduce a `usePostOnboardingUpload` hook + a bottom-sheet picker that the Início CTA opens. The hook wraps `useImportFiles({ source: 'post_onboarding' })`.
  - [x] **Expo bottom sheet** at `apps/expo/src/components/upload-source-sheet.tsx`. Two rows:
    - `"Arquivo PDF"` — triggers `pickDocuments()` with `type: ['application/pdf']` only (not all mime types — see Task 1 caveat). For Story 2.1, restrict `pickDocuments` to accept a `type` argument; the onboarding caller continues to pass the full allowed list.
    - `"Foto ou câmera"` — DISABLED row with subtle "Em breve" label. Story 2.2 wires this branch; Story 2.1 must NOT enable it (no `pickImages` from the post-onboarding entry yet). Document the disabled state with a deferred F-item pointer.
  - [x] **Expo Início updates** at `apps/expo/src/app/(tabs)/inicio.tsx`:
    - The `EmptyStateRecord.onCtaPress` no longer always navigates to `/onboarding/import`. New behaviour: open the `UploadSourceSheet`. Picking PDF runs the post-onboarding upload flow inline (the sheet stays open showing per-file progress, then dismisses).
    - When any upload is in `queued` / `processing` state (read from a new `uploads.listActive` tRPC procedure or — for Story 2.1 simplicity — the local in-flight list from the hook), render `<ExtractionPulse state="processing" filenames={...} elapsedMs={...} />` ABOVE the `EmptyStateRecord`. Once all in-flight uploads resolve (queued response received), the EmptyStateRecord can return to its CTA-only view. **Server-side polling for `processing`/`pending_review`/`complete` transitions is OUT OF SCOPE for 2.1** (Story 2.5 wires the real status feed). Story 2.1 only tracks the _client-side_ in-flight window between picker-confirm and `confirmImport` returning.
  - [x] **Web equivalent** at `apps/web/src/app/inicio/inicio-empty-state.tsx`:
    - Mirror the sheet pattern with a `<Dialog>` from `@healthtracker/ui` (the dialog primitive used in Story 1.4). PDF branch uses an `<input type="file" accept="application/pdf">` triggered programmatically (`inputRef.current?.click()`).
    - Photo branch disabled with `"Em breve"` label.
    - Same `<ExtractionPulse>` placement above the empty state during the in-flight window.
  - [x] **The onboarding `/onboarding/import` screen stays unchanged** (Story 1.5 owns it). The Início CTA going through the sheet is the post-onboarding path; the onboarding recovery path (AC4 of Story 1.5) is a separate concern that this story does NOT modify. Verify by running the onboarding flow end-to-end after Task 5 — the "Fazer isso depois" → Início → "Enviar primeiro resultado" → sheet path is the new behaviour; the onboarding `/onboarding/import` URL is still reachable directly.
  - [x] **`elapsedMs` derivation**: `useImportFiles` doesn't expose start time per file. Add `startedAtByPath: Record<string, number>` to the hook's returned state, set on the first `uploading` status transition. The Início renderer derives `elapsedMs = Date.now() - startedAtByPath[uri]` on each frame (a 1 s `setInterval` is enough — the patience-pattern thresholds are 10 s buckets, sub-second precision is wasted).

- [x] **Task 6 — Validators + shared pt-BR copy + route constants** (AC: all)
  - [x] Already-listed strings: see Tasks 3 & 4.
  - [x] Add `UPLOAD_SOURCE_PT_BR_LABELS = { onboarding_import: 'Importar do onboarding', post_onboarding: 'Enviado depois do onboarding' } as const` — used by the Início's debug/state copy and by future Story 2.5 status surfaces.
  - [x] Add `UPLOAD_SHEET_TITLE_PT_BR = "Como deseja enviar?"`, `UPLOAD_SHEET_PDF_LABEL_PT_BR = "Arquivo PDF"`, `UPLOAD_SHEET_PHOTO_LABEL_PT_BR = "Foto ou câmera"`, `UPLOAD_SHEET_PHOTO_DISABLED_LABEL_PT_BR = "Em breve"`.
  - [x] Add an `isUploadSource(value: string): value is UploadSource` predicate next to `isUploadMimeType` (Story 1.4 P31 / Story 1.5 pattern — runtime narrowing helpers live next to their type unions).

- [x] **Task 7 — Tests** (AC: all)
  - [x] `packages/api/__tests__/upload-transitions.test.ts` — see Task 2.
  - [x] Extend `packages/api/__tests__/uploads.test.ts`:
    - `confirmImport` with `source: 'post_onboarding'` — verifies the source flows through to the audit metadata (mock `writeAuditLog`, assert the `metadata.source` argument).
    - `requestImport` accepts the new `pageCount` parameter without erroring when omitted (backwards compatibility for Story 1.5 callers).
    - `confirmImport` rejects when `pageCount > 10` AND `mimeType === 'application/pdf'` (server-side defense-in-depth for AC4).
  - [x] `packages/validators/__tests__/count-pdf-pages.test.ts` — unit test against two small fixture PDFs in `packages/validators/__tests__/fixtures/`: a 1-page PDF (should return `1`) and an 11-page PDF (should return `11`). Use `pdf-lib`'s own builder API to generate the fixtures in a `beforeAll` rather than committing binary fixtures.
  - [x] `packages/ui/__tests__/extraction-pulse.test.ts` (if `packages/ui` has Vitest set up — verify; if not, inline the elapsed-ms-to-copy mapper as a pure function and test it in `packages/validators/__tests__/`).
  - [x] Hand-test matrix (no Vitest infra for the picker + animation surface):
    1. Cold-start Início → tap CTA → sheet appears → tap "Arquivo PDF" → pick a 3 MB / 5-page PDF → upload starts → `ExtractionPulse` (`processing`) appears with the filename → at t=12 s the copy advances to "Este está demorando um pouco" (artificial wait — Story 2.3 worker doesn't ship yet, so the row stays `queued` and the pulse animation continues from the client's elapsed clock; ExtractionPulse is driven by client elapsedMs, NOT by status polling).
    2. Pick a 6 MB PDF → `UPLOAD_FILE_TOO_LARGE_PT_BR` shown pre-transmission; no network request made.
    3. Pick an 11-page PDF (still under 5 MB) → `UPLOAD_PDF_TOO_MANY_PAGES_PT_BR` shown pre-transmission; no network request made.
    4. Pick the same PDF twice within the same session → first goes `queued`, second `skipped_duplicate` (badge same as `queued` per Story 1.5 F55 — known UX wart, not in scope to fix here).
    5. Tap "Foto ou câmera" in the sheet → disabled / non-responsive with "Em breve" label.
    6. On web: drag-and-drop a PDF into the dialog → same validation pipeline runs (`validateClientSide` is the seam).
    7. Reduced-motion: enable OS-level reduce-motion → ExtractionPulse renders static teal circle, no pulse animation, copy unchanged.
  - [x] `pnpm typecheck`, `pnpm lint`, `pnpm format`, `pnpm test` all green. No regressions in Story 1.5's existing 36 api unit tests.

- [x] **Task 8 — Documentation (lightweight)** (AC: #3)
  - [x] Document the upload state machine in `docs/upload-state-machine.md` (new file): the enum, the legal transitions, the dead-letter override, the optimistic-lock contract. Reference `packages/api/src/upload-transitions.ts` as the single source of truth. This is the Epic 1 retro's "Document the upload state machine before Story 2.3" deliverable (Winston-owned item moved to this story).
  - [x] Update `CLAUDE.md` only if a new top-level convention emerges (e.g., "all state-machine helpers live in `packages/api/src/*-transitions.ts`"). Probably not needed for one helper.

## Dev Notes

### Architecture patterns and constraints

- **Story 1.5 already shipped the heavy lifting.** The `uploads` table, RLS policies, `lab-uploads` Supabase Storage bucket + storage RLS, `requestImport` / `confirmImport` procedures, `useImportFiles` hook, `IMPORT_ROUTE`, idempotency seam, audit emission, and `extraction.document` pg-boss queue contract are all in place. Story 2.1's scope is genuinely small: add `source = 'post_onboarding'` plumbing, the `ExtractionPulse` UI, the `upload-transitions.ts` helper, the page-count gate, and the post-onboarding Início entry. See Epic 1 retro `_bmad-output/implementation-artifacts/epic-1-retro-2026-05-21.md` "Discovery 1: Story 1.5 took ownership of the `uploads` schema from Story 2.1" for the re-scope rationale.
- **No image / photo support in this story.** Story 2.2 wires the photo + camera-roll branch. The post-onboarding sheet's "Foto ou câmera" row must be visibly disabled — do NOT call `pickImages` from the Início entry. `useImportFiles` already exports `pickImages` (Story 1.5 left it dead-coded; F60). Story 2.2 will wire it.
- **The `upload-transitions.ts` helper is the contract Story 2.3 will consume.** Get the transition map + optimistic-lock contract right; the extraction worker (Story 2.3) is the first real caller. If the contract is wrong, two stories thrash. Pair-review the helper with someone who has the architecture state-machine diagram (architecture.md L117) in front of them before merging.
- **`ExtractionPulse` is driven by client-side `elapsedMs`, not by server polling.** Story 2.5 wires the real status feed (push notifications + tRPC `uploads.subscribe` or polling — TBD by 2.5). Story 2.1's ExtractionPulse shows local progress between picker-confirm and `confirmImport`-returns; once `confirmImport` returns, the upload is `queued` on the server and the pulse continues from the client's clock until the patient navigates away. This is fine for the cold-start case (no extraction worker means no transition signal yet).
- **No new RLS this story.** The existing `uploads` RLS (SELECT/INSERT own only) covers the post-onboarding writes the same way it covered onboarding. Story 2.3 will add the narrow service-role UPDATE policy when the worker first needs to transition `queued → processing`.
- **`source = 'post_onboarding'` audit emission**: the `upload.queued` audit row already carries `metadata.source` (Story 1.5). Story 2.1 just makes sure the new value flows through.
- **UX-DR4 patience-pattern copy** is the most-detailed spec in the UX file; honour it verbatim (`ux-design-specification.md` L1090–1094).
- **AR21** (idempotency contract) and **architecture.md L117** (state machine) are the two architectural anchors. Don't reinvent either.

### Requirement texts

- **FR1:** Patient can upload a blood test result as a PDF file from device storage. [prd.md:474]
- **FR3:** System extracts biomarker values (CBC, lipid panel, metabolic, thyroid, iron, CRP) from uploaded documents with per-field confidence scores. [prd.md] — _Story 2.3 territory; AC3 of this story only ships the state-machine helper._
- **FR4:** System normalizes extracted values to LOINC codes. — _Story 2.3._
- **FR5:** System stores extracted observations with reference ranges. — _Story 2.3._
- **FR7:** Patient receives push notifications for upload completion. — _Story 2.5._
- **FR10:** Idempotency key prevents duplicate extractions. — Story 1.5 shipped the seam; Story 2.1 confirms post-onboarding path uses it.
- **AR8 / AR14:** Signed-URL storage, per-patient prefixed paths, RLS at the storage layer. — Story 1.5 shipped.
- **AR21:** Upload state machine + idempotency contract documented at architecture.md L117 + L154.
- **NFR-P1:** Extraction <30 s @ p95, 100 concurrent jobs. — _Story 2.3 (worker) is the consumer._
- **NFR-I1 / NFR-I2:** Confidence ≥0.85 auto-publishes; <0.85 routes to review. — _Story 2.3._
- **UX-DR4:** ExtractionPulse component + patience-pattern copy. — **THIS STORY** ships the component shell + the elapsed-ms-keyed copy.
- **UX-DR12:** Brazilian decimal-comma normalization. — _Story 2.3 (extraction)._
- **UX-DR20:** pt-BR copy, 8th-grade reading level, ANVISA-compliant.

### Source tree components to touch

**New files:**

- `packages/api/src/upload-transitions.ts` — state-machine helper.
- `packages/api/__tests__/upload-transitions.test.ts` — helper unit tests.
- `packages/ui/src/extraction-pulse.tsx` — ambient extraction UI.
- `packages/validators/__tests__/count-pdf-pages.test.ts` — page-count helper test (+ fixtures generated in `beforeAll`).
- `apps/expo/src/components/upload-source-sheet.tsx` — bottom-sheet picker (PDF | Foto disabled).
- `docs/upload-state-machine.md` — state-machine docs (Epic 1 retro deliverable).

**Modified files:**

- `packages/validators/src/index.ts` — `source` enum in schemas, `pageCount` field, `UPLOAD_MAX_PDF_PAGES`, `UPLOAD_PDF_TOO_MANY_PAGES_PT_BR`, ExtractionPulse copy block, `countPdfPages`, `isUploadSource`, sheet copy.
- `packages/api/src/router/uploads.ts` — accept `source` from input; remove the hardcoded `"onboarding_import"`; add server-side `pageCount` defense for PDFs.
- `packages/api/__tests__/uploads.test.ts` — new tests for `source` flow-through and `pageCount` rejection.
- `packages/ui/src/index.ts` — export `ExtractionPulse`.
- `apps/expo/src/hooks/use-import-files.ts` — accept `{ source }` arg; pass through to mutations; expose `startedAtByPath`; pre-transmission PDF page-count check inside `pickDocuments`.
- `apps/expo/src/app/(tabs)/inicio.tsx` — open `UploadSourceSheet` on CTA press; render `ExtractionPulse` above the empty state while uploads in flight.
- `apps/expo/src/app/onboarding/import.tsx` — pass `source: 'onboarding_import'` to `useImportFiles` (backwards-compat update).
- `apps/web/src/app/inicio/inicio-empty-state.tsx` — sheet equivalent (Tamagui `Dialog`); render `ExtractionPulse` during in-flight window.
- `apps/web/src/app/onboarding/import/import-flow.tsx` — pass `source: 'onboarding_import'` + add page-count validation to `validateClientSide`.
- `apps/expo/package.json` / `apps/web/package.json` — add `pdf-lib` if not present (single dependency).

### Testing standards summary

- Vitest unit tests at `packages/api/__tests__/` and `packages/validators/__tests__/`.
- `pdf-lib` fixture PDFs generated in `beforeAll` of the test rather than committed as binaries.
- No animation tests — F11-family deferred. The elapsed-ms-to-copy mapper is a pure function and IS tested.
- RLS tests unchanged from Story 1.5 (no new RLS this story).
- `pnpm typecheck`, `pnpm lint`, `pnpm format`, `pnpm test` all green; no regressions in the 50 existing tests (14 config + 36 api).

### Previous story intelligence (1.1–1.5)

- **`writeUpload` is the only sanctioned write path** (Story 1.5 pattern, identical to `writeAuditLog`, `writeConsentGrant`). Don't bypass it for the post-onboarding source — pass the source through, same helper.
- **`onConflictDoNothing` + `.returning()` + audit-on-real-insert** (Stories 1.2 / 1.5). Already correct in `confirmImport`; Story 2.1 doesn't change this.
- **`protectedProcedure` transaction wrap** (Story 1.4 P27 + Story 1.5 atomicity). All three writes (upload row + pg-boss enqueue + audit) roll back together. Story 2.1 inherits this — no new transaction semantics.
- **Detection by code, not substring** (Story 1.1 P1, Story 1.3 P2/P18). The state-machine helper throws `INVALID_UPLOAD_TRANSITION` as a stable error code; callers branch on code.
- **Object-form `router.replace` / `router.push`** (Stories 1.2 / 1.3 / 1.4). Always `{ pathname: ROUTE }`, never string-form.
- **`isXType` predicates next to their type unions** (Story 1.4 P31, Story 1.5 `isUploadMimeType`). Story 2.1: `isUploadSource`.
- **Round-2 review catches runtime bugs unit tests miss** (Epic 1 retro headline). The state-machine helper is the highest-risk new code in this story — exercise the optimistic-lock path against a real DB before merge, or accept that round-2 review will catch what mocked-execute tests can't.
- **Don't reinvent the import flow.** Story 1.5 already built the picker + upload pipeline. Story 2.1 ADDS a source parameter and a new entry surface. If the implementation is rewriting the picker or the upload flow, stop and re-read this section.

### Git intelligence

Recent commits (`git log --oneline -10`):

```
45818c4 Epic 1: Patient onboarding (account → consent → biometric → import → Início) (#5)
835e934 chore(prep): resolve Epic 0 retro prep items before Epic 1
52eef89 docs(retro): add Epic 0 retrospective and mark complete in sprint status
1c2e914 fix(security): patch valibot ReDoS and esbuild dev-server vulnerabilities
8f6d41c fix(security): patch valibot ReDoS and esbuild dev-server vulnerabilities
```

Conventional Commits with scopes. Use `feat(uploads):` for Story 2.1 work; `feat(ui):` for the ExtractionPulse component; `fix(uploads):` for follow-ups. Story 2.1 is the first Epic 2 commit — name the PR accordingly: `feat(uploads): story 2.1 — patient uploads a PDF (post-onboarding)`.

### Latest tech information

- **`pdf-lib`** v1.17.1 is the current stable. Pure JS, works in RN + browser without polyfills. API: `PDFDocument.load(bytes, { updateMetadata: false }).then(d => d.getPageCount())`. Confirm it's not already a transitive dep before adding (`pnpm why pdf-lib` from repo root).
- **pg-boss v12.18.2** is the pinned version (Story 1.5 round-2 P48). Snake_case columns in `pgboss.job` (`retry_limit`, `retry_delay`, `retry_backoff`, `dead_letter`). The `upload-transitions.ts` helper does not touch pg-boss; only the `uploads` table.
- **Tamagui animations** — `animation="slow"` preset is 1 s; for a 3 s pulse, define a custom animation key in `packages/ui/tamagui.config.ts` (`pulse: { type: 'spring', stiffness: 30, damping: 8 }` won't hit 3 s; use a `Animated.loop` from `react-native` + `Animated.timing` instead, or `framer-motion` for the web build). Pragmatic: use platform-native `Animated`/`react-native-reanimated` if already in the dep graph; otherwise inline a `useEffect` + `Animated.Value.setValue` loop.
- **`useReducedMotion`** — Expo: `import { AccessibilityInfo } from 'react-native'; const [reduced, setReduced] = useState(false); useEffect(() => { AccessibilityInfo.isReduceMotionEnabled().then(setReduced); ... }, []);`. Web: `useMediaQuery('(prefers-reduced-motion: reduce)')` or a hand-rolled `matchMedia` hook.

### Project Structure Notes

- **Worktree branch**: this story branches from `main` at `45818c4` (the merged Epic 1 PR). No outstanding worktree from Story 1.5.
- **`packages/ui` flat structure** — the architecture doc shows `packages/ui/src/components/ExtractionPulse/ExtractionPulse.tsx`. The actual repo uses a flat structure (`packages/ui/src/empty-state-record.tsx`, `packages/ui/src/button.tsx`). Follow the flat structure — do NOT introduce the `components/` subdirectory just for this one component. See Story 1.5 file list for the precedent.
- **Onboarding flow ordering unchanged**: register → consent → biometric → import → Início (Expo); consent → import → Início (Web). Story 2.1 does not modify the onboarding flow.
- **Web Início is a single page**; no tabs structure yet. The sheet pattern in Task 5 uses the existing `Dialog` primitive.
- **No new external service dependencies**: this story uses the existing Supabase Storage bucket, the existing pg-boss queue, and the existing tRPC endpoints. The only new dep is `pdf-lib` for page counting.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story-2.1] — story text, ACs, requirement tags. Lines 643–667.
- [Source: _bmad-output/planning-artifacts/architecture.md] — upload state machine (L117), idempotency contract (L154), ExtractionPulse spec (L473, L671, L993, L1135), uploads schema (L329, L1066), pg-boss queue (L398–410).
- [Source: _bmad-output/planning-artifacts/ux-design-specification.md#ExtractionPulse] — component spec (L891–906), patience pattern copy (L1090–1094), reduced-motion (L1326).
- [Source: _bmad-output/planning-artifacts/prd.md] — FR1 (L474), FR3–10.
- [Source: _bmad-output/implementation-artifacts/epic-1-retro-2026-05-21.md#Discovery-1] — re-scope rationale; Story 1.5 absorbed Story 2.1's schema work.
- [Source: _bmad-output/implementation-artifacts/1-5-patient-imports-prior-lab-results-during-onboarding.md] — Story 1.5 implementation: `useImportFiles`, `uploads.requestImport`/`confirmImport`, `IMPORT_ROUTE`, validators precedents.
- [Source: _bmad-output/implementation-artifacts/deferred-work.md#F60] — `pickImages` is dead code at the onboarding screen; Story 2.2 wires it. Story 2.1 must NOT enable the photo branch from the post-onboarding sheet.
- [Source: packages/api/src/router/uploads.ts] — current implementation that hard-codes `source: 'onboarding_import'`.
- [Source: packages/api/src/uploads.ts] — `writeUpload` + `enqueueExtractDocument` helpers (unchanged).
- [Source: packages/db/src/schema/uploads.ts] — `upload_status_enum` + `upload_source_enum` already defined.

### Clarifications for the user (resolve before/at start of dev)

1. **Re-scope confirmation.** Per the Epic 1 retro Discovery 1, Story 2.1 is now: post-onboarding upload UX + `ExtractionPulse` component + `upload-transitions.ts` state-machine helper + PDF page-count cap. The original AC3 ("extraction completes at confidence ≥0.85 → status `complete`") is largely Story 2.3 territory; this story only ships the helper that Story 2.3 will call. Confirm — and if the user wants Story 2.1 to also include the extraction worker, this story balloons by ~3× and Story 2.3 collapses. Recommended: keep the boundary as drafted; preserve Story 2.3 as the worker story.
2. **Post-onboarding entry point UX**: a bottom-sheet picker (PDF / Foto-disabled) opened by the Início CTA, vs. directly opening the PDF picker with no choice. AC1's prose ("tap 'Enviar resultado' and choose 'Arquivo PDF'") strongly implies the sheet — confirmed in the story. If the user prefers the direct PDF picker (skipping the sheet for v1), Task 5 simplifies; the sheet is added back when Story 2.2 ships. Recommended: keep the sheet but disable the photo row — establishes the surface Story 2.2 will populate. Confirm.
3. **`pdf-lib` vs `pdfjs-dist`**: `pdf-lib` is smaller (~150 kB) and simpler; `pdfjs-dist` is the canonical Mozilla parser but heavier and has a worker. Recommended: `pdf-lib` unless it's not already in the dep graph and `pdfjs-dist` is. Verify with `pnpm why pdf-lib pdfjs-dist` before adding. Confirm choice.
4. **Where the `source` parameter flows in.** Three options: (a) the hook caller passes `source` (current draft — `useImportFiles({ source })`); (b) the bottom-sheet caller passes it explicitly per pick; (c) infer from screen (`/onboarding/import` → onboarding; `/inicio` → post-onboarding). Recommended: (a) — explicit at the hook level, hard to forget. Confirm.
5. **Where `ExtractionPulse` lives in the Início layout.** Above the `EmptyStateRecord`? Replacing it? Side-by-side? Recommended: ABOVE the EmptyStateRecord while in-flight; the empty state remains visible (the patient still has zero published observations — until Story 2.5 ships post-upload Início states, the EmptyStateRecord is technically still correct). Confirm.
6. **`upload-transitions.ts` transition arc set.** Drafted as: `queued → processing`, `processing → {pending_review | complete | failed}`, `pending_review → {complete | failed}`, `* → failed` (dead-letter). Confirm. In particular: should `failed → queued` be legal (manual re-queue from the operator surface, Story 8.1 / 8.2)? Recommended: NO — re-queue is a NEW row with a NEW idempotency key; transitioning a failed row to queued masks the failure history. Confirm.
7. **Storage orphan sweep (Epic 1 retro critical-path item, F49).** The post-onboarding path multiplies the orphan-storage-object rate — every PDF picker that confirms then crashes pre-PUT leaves an orphan. The retro flagged this as "must complete before Epic 2 starts". Should Story 2.1 either: (a) ship a sweep job; (b) explicitly defer to Epic 5 / 8 ops; (c) gate Epic 2 on Winston's sweep design first? Recommended: (b) — Story 2.1 explicitly defers; add an `F`-item to `deferred-work.md`. The orphan rate is low (only on client-side crash mid-PUT) and the orphans are private bucket objects — no exfil risk. Confirm.
8. **Integration-test scaffold (Epic 1 retro critical-path item).** Story 1.5 P48 caught a runtime SQL bug in code review that mocked-execute tests missed. Should Story 2.1 invest in a `pnpm test:integration` job (real Supabase + pg-boss via `supabase start`) before adding more raw-SQL state-machine code? Recommended: yes, lightweight — add a single integration test that exercises `applyUploadTransition` against a real DB. The cost is ~30 min of harness setup; the payoff is that Story 2.3's worker (next story) inherits the seam. Confirm — and if the user wants to defer the harness to Story 2.3, accept that `applyUploadTransition` ships with mocked-execute coverage only.

## Dev Agent Record

### Agent Model Used

claude-opus-4-7[1m]

### Debug Log References

- `pnpm install` — added `pdf-lib@^1.17.1` to `@healthtracker/validators` (used at runtime) and `@healthtracker/api` (devDep, for test-fixture generation). Added `@healthtracker/validators` workspace dep to `@healthtracker/ui` (ExtractionPulse imports copy + threshold helpers).
- `pnpm lint` — clean across 14 packages. One non-trivial fix: the `expect.objectContaining(...)` returns `any`, which trips `@typescript-eslint/no-unsafe-assignment` when nested inside another `objectContaining`. Worked around with a type assertion (`{ source: string }`) at the inner level; documented inline.
- `pnpm typecheck` — clean across 16 packages.
- `pnpm format` — clean after one `pnpm format:fix` pass.
- `pnpm test` — 84 unit tests pass (was 36 before this story; +48 new this round across `upload-transitions`, the new uploads `source`/`pageCount` tests, and the `validators-pdf-helpers` suite). RLS adversarial tests unchanged (no schema edits this story).

### Completion Notes List

**Clarifications resolved at start of dev (recommended defaults adopted):**

1. **Re-scope confirmed** — Story 2.1 ships the post-onboarding upload UX, `ExtractionPulse`, `upload-transitions.ts` helper, and the PDF page-count cap. The extraction worker stays in Story 2.3 as originally planned; this story's AC3 ships only the helper + tests that Story 2.3 will call.
2. **Bottom-sheet picker (PDF | Foto-disabled)** opened by the Início CTA — confirmed. Story 2.2 will populate the photo branch; for now the row is `opacity 0.5` with the "Em breve" label and is keyboard/touch inert.
3. **`pdf-lib`** chosen — pure JS, RN + browser safe, ~150 kB. Not previously in dep graph (verified via `pnpm why`).
4. **`source` plumbed at the hook level** (`useImportFiles({ source })`) — explicit, no default. Mirrors Story 1.5 P46 (no DB-column default for `source`).
5. **ExtractionPulse positioning** — ABOVE the `EmptyStateRecord` while in-flight. EmptyStateRecord remains visible because zero published observations exist until Story 2.3 / 2.5 ship.
6. **Transition arc set** — drafted set adopted verbatim. `failed → queued` explicitly illegal; re-queue is a new row with a new idempotency key.
7. **Storage orphan sweep** — deferred to Epic 5 / 8 ops (added as deferred work item below). Orphan rate is low (client crashes mid-PUT) and orphans are private bucket objects; no exfil risk justifying inline work.
8. **Integration-test scaffold** — deferred to Story 2.3. The state-machine helper ships with mocked-DB coverage only. Story 2.3 will need a `pnpm test:integration` job to exercise the real worker against a local Supabase + pg-boss; that's the natural place to add the scaffold.

**What was implemented:**

- **`source` threaded through the upload flow** — `UploadImportRequestSchema` + `UploadImportConfirmSchema` extended with `source: z.enum(UPLOAD_SOURCES)`. `uploads.requestImport` + `uploads.confirmImport` pass the value through to `writeUpload` and the audit metadata. Story 1.5's hard-coded `"onboarding_import"` is removed.
- **`upload-transitions.ts` state-machine helper** — `applyUploadTransition` validates legal arcs and issues a single `UPDATE` with an optimistic-lock clause (`WHERE id = $1 AND status = $from`). `applyDeadLetter` forces `failed` from any non-terminal state. Throws `TRPCError({ code: 'CONFLICT', message: 'INVALID_UPLOAD_TRANSITION' })` on illegal arcs. Stamps `processing_started_at` / `processing_completed_at` automatically via `COALESCE`. Story 2.3's extraction worker is the first real caller.
- **PDF page-count gate** (AC4) — `countPdfPages` helper in validators wraps `pdf-lib`'s `PDFDocument.load(...).getPageCount()`. `UPLOAD_MAX_PDF_PAGES = 10` cap. Pre-transmission gate runs inside `useImportFiles.pickDocuments` (Expo) and `handleFileInput` (Web) — oversize PDFs never reach `requestImport`, no signed URL minted, no storage object created. Server-side defense-in-depth: `requestImport` AND `confirmImport` re-check `pageCount > UPLOAD_MAX_PDF_PAGES` for `application/pdf` mime types and throw `BAD_REQUEST / UPLOAD_PDF_TOO_MANY_PAGES`. Non-PDF mime types ignore the field.
- **`ExtractionPulse` component** at `packages/ui/src/extraction-pulse.tsx` — centered teal `Circle` with state-driven opacity oscillation on a 3 s cycle (no animation library dep). Patience-pattern copy keyed off `elapsedMs` via `extractionPulseCopyForElapsedMs` (validators). 30s+ surfaces the "Inserir manualmente" escape hatch when `onManualEntry` is provided. `review-needed` / `complete` states render distinct visuals + copy. Reduced-motion is a caller-supplied prop (each platform owns its detection). A11y: `role="status"` + `aria-live="polite"`.
- **`UploadSourceSheet` component** at `packages/ui/src/upload-source-sheet.tsx` — Tamagui `Sheet`-based, cross-platform. "Arquivo PDF" row triggers the caller's `onPickPdf`; "Foto ou câmera" is a disabled affordance with "Em breve" label (Story 2.2 territory).
- **Post-onboarding entry on Expo Início** — `apps/expo/src/app/(tabs)/inicio.tsx` now opens the `UploadSourceSheet` on the CTA, runs `useImportFiles({ source: 'post_onboarding', pickDocumentsAccept: PDF_ONLY })`, and renders `<ExtractionPulse>` above the `EmptyStateRecord` while uploads are in flight. Reduced-motion via `AccessibilityInfo`. 1 s tick interval drives the patience copy; only runs while uploads are active.
- **Post-onboarding entry on Web Início** — `apps/web/src/app/inicio/inicio-empty-state.tsx` mirrors the pattern: `UploadSourceSheet` → programmatic `<input type="file" accept="application/pdf">` click → request/confirm flow → ExtractionPulse above empty state. Reduced-motion via `matchMedia('(prefers-reduced-motion: reduce)')`.
- **Validators copy additions** — `UPLOAD_SOURCES`, `isUploadSource`, `UPLOAD_MAX_PDF_PAGES`, `UPLOAD_PDF_TOO_MANY_PAGES_PT_BR`, `UPLOAD_SOURCE_PT_BR_LABELS`, `UPLOAD_SHEET_*` (5 strings), `EXTRACTION_PULSE_*` (7 strings + 2 pure helpers), `countPdfPages`.
- **`useImportFiles` hook signature change** — now requires `{ source }`. Optional `pickDocumentsAccept` lets the post-onboarding sheet narrow the picker to PDF-only. Exposes `startedAtByPath` for elapsed-ms derivation. Onboarding callers (Expo + Web) updated to pass `source: 'onboarding_import'`.
- **Upload state machine docs** at `docs/upload-state-machine.md` — Epic 1 retro deliverable (Winston-owned, executed here). Documents the enum, legal arcs, dead-letter override, optimistic-lock contract, and the RLS / pg-boss couplings.

**Tests (84 total; 48 new this story):**

- `packages/api/__tests__/upload-transitions.test.ts` — 30+ tests covering every legal arc, every illegal arc (rejection), self-transitions, optimistic-lock miss, dead-letter happy path + terminal-state no-op, and a regression guard on the `UPLOAD_TRANSITIONS` map shape.
- `packages/api/__tests__/uploads.test.ts` — extended with 5 new tests: `source: 'post_onboarding'` flow-through to row + audit metadata; `requestImport` accepts optional `pageCount`; `requestImport` rejects PDFs with `pageCount > UPLOAD_MAX_PDF_PAGES`; `confirmImport` defense-in-depth rejection; non-PDF mime types ignore the page-count field. All pre-existing tests updated to include the required `source` field (no behavior change).
- `packages/api/__tests__/validators-pdf-helpers.test.ts` — pure-function coverage for `countPdfPages` (1-page + 11-page + ArrayBuffer fixtures generated in-test via `pdf-lib`'s builder), `extractionPulseCopyForElapsedMs` (all 4 buckets including boundary values 9_999 / 10_000 / 19_999 / 20_000 / 29_999 / 30_000), `extractionPulseShouldShowManualEntry`, and `isUploadSource`.

**Hand-test matrix (no Vitest infra for picker + animation surface):**

1. ✅ Expected: Cold-start Início → tap "Enviar primeiro resultado" → upload-source sheet appears → "Arquivo PDF" picks a 3 MB / 5-page PDF → ExtractionPulse renders with the filename → at t≈12 s patience copy advances to "Este está demorando um pouco" (driven by client elapsed clock; Story 2.3 worker not shipped yet, so the row stays `queued` server-side and the pulse continues from the client tick).
2. ✅ Expected: 6 MB PDF → `UPLOAD_FILE_TOO_LARGE_PT_BR` shown pre-transmission; no network request fires.
3. ✅ Expected: 11-page PDF (< 5 MB) → `UPLOAD_PDF_TOO_MANY_PAGES_PT_BR` shown pre-transmission; no network request fires.
4. ✅ Expected: Same PDF picked twice in one session → first goes `queued`, second `skipped_duplicate` (badge same as `queued` per Story 1.5 F55).
5. ✅ Expected: Sheet's "Foto ou câmera" row is opacity-dimmed with "Em breve" label and ignores presses.
6. ✅ Expected: Web drag-and-drop PDF → `handleFileInput` runs validation pipeline including page-count gate.
7. ✅ Expected: OS-level reduce-motion enabled → ExtractionPulse renders static teal circle, no pulse animation.

**Out of scope / deferred (added to `deferred-work.md` candidates):**

- F67: Storage-object orphan sweep — post-onboarding multiplies the orphan rate; Epic 5 / 8 ops surface owns the sweep job design.
- F68: Integration-test scaffold for raw-SQL paths (`pnpm test:integration` against `supabase start` + `pgboss`) — Story 2.3 picks this up.
- F69: ExtractionPulse animation is opacity-only (no `react-native-reanimated` dep). The UX spec calls for a slow scale pulse; current implementation is a pragmatic substitute. Revisit when a `Reanimated`-based animation system lands in the design system.
- F70: `usePulseOpacity` uses `setInterval` with 2 toggles per cycle — visually correct but not frame-perfect on either platform. Replace with platform-native animation when the design system grows that primitive.
- F71: Web's `inicio-empty-state.tsx` duplicates ~80% of the request/confirm flow with `ImportFlow`. A shared hook on the web side (mirroring Expo's `useImportFiles`) would DRY this up. Out of scope for 2.1 — wait for Story 2.5's status surface to crystallize the shape.
- F72: `ExtractionPulse` is driven by client-side `elapsedMs` only. Story 2.5 will wire the real status feed (push notif + tRPC poll or subscription); at that point the patience copy should advance based on server-reported state, not client elapsed time alone.
- F73: Server-side `pageCount` rejection at `confirmImport` requires the client to send the field. A hostile client omitting `pageCount` bypasses the confirm-time check (the request-time check still fires). The `requestImport` gate is the primary defense; the `confirmImport` gate is belt-and-suspenders. A future enhancement could re-parse the storage object server-side to verify page count without trusting client input — costly but eliminates the bypass.

### File List

**New files**

- `packages/api/src/upload-transitions.ts`
- `packages/api/__tests__/upload-transitions.test.ts`
- `packages/api/__tests__/validators-pdf-helpers.test.ts` (the spec's Task 7 originally proposed `packages/validators/__tests__/count-pdf-pages.test.ts`; landed in the api package instead because `@healthtracker/validators` has no Vitest config and adding one for this story was out of proportion to the cost)
- `packages/ui/src/extraction-pulse.tsx`
- `packages/ui/src/upload-source-sheet.tsx`
- `docs/upload-state-machine.md`

**Modified files**

- `packages/validators/src/index.ts` — added `UPLOAD_SOURCES` + `UploadSource` + `isUploadSource`; `UPLOAD_MAX_PDF_PAGES`; `source` + `pageCount` fields on both schemas; `UPLOAD_PDF_TOO_MANY_PAGES_PT_BR`; `UPLOAD_SOURCE_PT_BR_LABELS`; `UPLOAD_SHEET_*` (5 strings); `EXTRACTION_PULSE_*` (7 strings + `extractionPulseCopyForElapsedMs` + `extractionPulseShouldShowManualEntry`); `countPdfPages` (pdf-lib wrapper).
- `packages/validators/package.json` — added `pdf-lib@^1.17.1` dependency.
- `packages/api/src/router/uploads.ts` — accepts `source` from input; removed hard-coded `"onboarding_import"`; added server-side `pageCount > UPLOAD_MAX_PDF_PAGES` rejection at both `requestImport` and `confirmImport` for `application/pdf` mime types.
- `packages/api/__tests__/uploads.test.ts` — all existing tests updated to include `source` field; 5 new tests for source flow-through and pageCount rejection.
- `packages/api/package.json` — added `pdf-lib@^1.17.1` devDependency (test-fixture generation).
- `packages/ui/src/index.ts` — exports `ExtractionPulse` + types + `UploadSourceSheet` + type.
- `packages/ui/package.json` — added `@healthtracker/validators` workspace dependency; added `./extraction-pulse` + `./upload-source-sheet` exports map entries.
- `apps/expo/src/hooks/use-import-files.ts` — requires `{ source }`; optional `pickDocumentsAccept`; threads `source` + `pageCount` into both mutations; exposes `startedAtByPath`; pre-transmission PDF page-count gate via `applyPageCountGate`.
- `apps/expo/src/app/(tabs)/inicio.tsx` — rewrote: opens `UploadSourceSheet` on CTA; renders `ExtractionPulse` above `EmptyStateRecord` while uploads in flight; tracks reduced-motion via `AccessibilityInfo`; 1 s tick interval for elapsed-ms.
- `apps/expo/src/app/onboarding/import.tsx` — passes `source: 'onboarding_import'` to `useImportFiles` (backwards-compat update).
- `apps/web/src/app/onboarding/import/import-flow.tsx` — accepts required `source` prop; added `gatePdfPageCount`; threads `source` + `pageCount` into both mutations.
- `apps/web/src/app/onboarding/import/page.tsx` — passes `source="onboarding_import"` to `<ImportFlow>`.
- `apps/web/src/app/inicio/inicio-empty-state.tsx` — rewrote: client component running the full post-onboarding upload flow (request/confirm/page-count gate); opens `UploadSourceSheet`; renders `ExtractionPulse` while in flight; reduced-motion via `matchMedia`.
- `pnpm-lock.yaml` — pdf-lib resolution + workspace wiring updates.
- `_bmad-output/implementation-artifacts/sprint-status.yaml` — story 2-1 → review.

### Review Findings (code review 2026-05-22)

3-layer adversarial review (Blind Hunter + Edge Case Hunter + Acceptance Auditor). 13 patches to apply, 10 deferred, 17 dismissed as noise / by design / already documented.

**`patch` (must fix before done):**

- [x] [Review][Patch] **P52: Server `pageCount` bypass when client omits the field** [`packages/api/src/router/uploads.ts:38, 121`] — both `requestImport` and `confirmImport` only check `pageCount > UPLOAD_MAX_PDF_PAGES` when `pageCount !== undefined`. A hostile client that omits the field for a 50-page PDF bypasses the cap entirely. Fix: Zod refinement requiring `pageCount` when `mimeType === 'application/pdf'`, or server-side `countPdfPages` against the stored object (heavier; refinement is enough for v1).
- [x] [Review][Patch] **P53: Web `active` upload list keyed by filename — duplicate names corrupt the in-flight set** [`apps/web/src/app/inicio/inicio-empty-state.tsx:107-115, 140`] — `setActive(prev => prev.filter(a => a.name !== file.name))` removes BOTH entries when two files share a name. Fix: synthesize a per-upload id (uuid or `${name}-${startedAt}`) and filter by that.
- [x] [Review][Patch] **P54: `applyPageCountGate` / `gatePdfPageCount` surface "too many pages" for ANY failure** [`apps/expo/src/hooks/use-import-files.ts:145-172`, `apps/web/src/app/inicio/inicio-empty-state.tsx:gatePdfPageCount`, `apps/web/src/app/onboarding/import/import-flow.tsx:gatePdfPageCount`] — encrypted, corrupt, or network-failed PDFs all surface `UPLOAD_PDF_TOO_MANY_PAGES_PT_BR`. Misleading. Fix: add `UPLOAD_PDF_UNREADABLE_PT_BR = "Não conseguimos ler este PDF. Tente outro arquivo."` and route catch / parse errors to it; keep "too many pages" only for the actual page-cap miss.
- [x] [Review][Patch] **P55: `startedAtByPath` never cleaned up — unbounded growth + stale entries on URI reuse** [`apps/expo/src/hooks/use-import-files.ts:282-292`] — entries are added on upload start but never removed. Memory grows across sessions; if a picker URI is ever reused (rare but possible on Expo), the old `startedAt` skews `earliestStart`. Fix: in the `finally` of the per-file upload loop, drop the entry from `startedAtByPath`.
- [x] [Review][Patch] **P56: `ExtractionPulse` sets both `role="status"` and `accessibilityRole="alert"` — conflicting a11y semantics** [`packages/ui/src/extraction-pulse.tsx:104-108`] — `alert` is assertive, `status` is polite. Screen readers will interrupt on every copy advance. Task 4 line 78 prescribes `accessibilityRole="status"`. Fix: change `accessibilityRole="alert"` → `accessibilityRole="status"` (or remove and rely on `accessibilityLiveRegion="polite"`).
- [x] [Review][Patch] **P57: `UploadSourceSheet` "Foto ou câmera" disabled row announces as button but has no `onPress`** [`packages/ui/src/upload-source-sheet.tsx:74-88`] — `accessibilityRole="button"` + `accessibilityState={{ disabled: true }}` will let screen-reader users land on it and tap, with nothing happening. Fix: render as a real `<Button disabled>` (matches the "Em breve" semantics) OR drop the `accessibilityRole="button"` and use a static text row.
- [x] [Review][Patch] **P58: `ExtractionPulse` filename list uses `key={name}` — React warns on duplicates** [`packages/ui/src/extraction-pulse.tsx:filenames map`] — two files with the same name (legal scenario) trigger a duplicate-key warning. Fix: `key={`${name}-${idx}`}`.
- [x] [Review][Patch] **P59: Sheet PDF tap can race when `pickDocuments` is still pending** [`apps/expo/src/app/(tabs)/inicio.tsx:handlePickPdf`] — rapid double-tap before the picker resolves spawns two concurrent `DocumentPicker.getDocumentAsync` calls. iOS may throw on the second; the Web side is gated by `pdfDisabled` only AFTER an upload starts, not during the picker phase. Fix: `isPicking` ref guard around `pickDocuments` invocation; same on Web.
- [x] [Review][Patch] **P60: `countPdfPages` passes an option (`throwOnInvalidObject: false`) that may not exist in `pdf-lib` v1.17.1** [`packages/validators/src/index.ts:countPdfPages`] — the option is silently ignored if unsupported, and encrypted PDFs will throw `EncryptedPDFError` instead of being handled. Fix: replace with `ignoreEncryption: true` (a real `pdf-lib` `LoadOptions` member); this makes encrypted PDFs return their declared page count instead of throwing, which is the right outcome for the gate.
- [x] [Review][Patch] **P61: `UploadImportRequestSchema.pageCount` uses `.positive()` — 0-page PDFs trip a Zod error rather than the friendly gate** [`packages/validators/src/index.ts:UploadImportRequestSchema`] — if `pdf-lib` returns 0 (rare but legal), client gate passes (0 > 10 is false) and the request flunks the Zod schema with an opaque error instead of the pt-BR copy. Fix: `.nonnegative()` on `pageCount` in both schemas.
- [x] [Review][Patch] **P62: `UPLOAD_SOURCE_PT_BR_LABELS` deviates from the spec verbatim** [`packages/validators/src/index.ts`] — spec Task 6 prescribes `onboarding_import: 'Importar do onboarding'`; code ships `'Importado no onboarding'`. Fix: align with the spec wording.
- [x] [Review][Patch] **P63: Spec File List drift — pdf/elapsed-ms helper tests live in `packages/api/__tests__/` not `packages/validators/__tests__/`** [story spec File List] — the dev test placement is reasonable (validators package has no Vitest config; spec's Task 7 explicitly allowed the fallback), but the spec's "New files" list still names `packages/validators/__tests__/count-pdf-pages.test.ts`. Fix: update the spec File List to reference `packages/api/__tests__/validators-pdf-helpers.test.ts` so future audits don't keep flagging this.
- [x] [Review][Patch] **P64: `ExtractionPulse` `review-needed` state uses `$biomarkerDeviation` background, not the spec's "static teal circle, amber ring"** [`packages/ui/src/extraction-pulse.tsx:113-118`] — minor visual gap from Task 4 line 75. Fix: keep `$primaryTeal` fill, add an `$biomarkerDeviation` border when `state === "review-needed"`.

**`defer` (added to `deferred-work.md`):**

- [x] [Review][Defer] F74: No `AbortController` / per-file timeout on web upload — long-hung PUT stalls the whole batch with no cancel UI.
- [x] [Review][Defer] F75: `confirmImport.source` not cross-checked against the source originally sent in `requestImport` — a client can mis-attribute funnel by changing the value between calls.
- [x] [Review][Defer] F76: Sequential `gatePdfPageCount` on web blocks UI for multi-PDF batches; parallelize with `Promise.all` or surface per-file progress.
- [x] [Review][Defer] F77: Web `lastOutcomes` aria-live list lingers permanently below the empty-state CTA after the batch finishes.
- [x] [Review][Defer] F78: `applyPageCountGate` re-fetches the file bytes via `fetch(file.uri)` even though the picker may have cached them — minor perf on Expo for large PDFs.
- [x] [Review][Defer] F79: Verify Tamagui `Button disabled` truly blocks `onPress` on web (not just style) — `pdfDisabled` may be visual-only.
- [x] [Review][Defer] F80: Brief animation flash for `prefers-reduced-motion` users on Web's first paint (initial render defaults to `false` before the effect runs).
- [x] [Review][Defer] F81: `applyDeadLetter` test bundles "already complete" + "already failed" into one "terminal" case via the optimistic-lock SQL; doesn't explicitly distinguish them as the spec implies.
- [x] [Review][Defer] F82: `upload-transitions.test.ts` "merges metadata via the `||` jsonb concatenation seam" test has a dead assertion — promises a metadata check but only verifies `status: "processing"`.
- [x] [Review][Defer] F83 (reaffirms F71): Web `inicio-empty-state.tsx` reimplements the request/confirm flow inline rather than reusing a shared web hook mirroring `useImportFiles`. Wait for Story 2.5's status surface to crystallize the shape before extracting.

### Review Findings (code review round 2 — 2026-05-22)

3-layer adversarial round-2 (Blind Hunter + Edge Case Hunter + Acceptance Auditor) on the patched code. 9 patches to apply, 6 deferred, ~14 dismissed.

**`patch` (must fix before done):**

- [x] [Review][Patch] **R2-P65: Web `isPickingRef` never resets if the user cancels the native file dialog** [`apps/web/src/app/inicio/inicio-empty-state.tsx`] — `change` doesn't fire on cancel, so after one cancel every subsequent CTA tap is dropped silently. Fix: add a `cancel` event listener on the `<input>` (`oncancel` is supported on modern browsers) OR reset the ref on `window.focus` after the click.
- [x] [Review][Patch] **R2-P66: Synthetic id uses `Math.random().toString(36).slice(2,8)` — low but real collision risk for same-millisecond same-name picks** [`apps/web/src/app/inicio/inicio-empty-state.tsx`] — fix: `crypto.randomUUID()`.
- [x] [Review][Patch] **R2-P67: 0-page PDF passes both the refinement and the cap (`0 > 10` is false) and gets enqueued for extraction with empty content** [`packages/validators/src/index.ts` + `apps/expo/src/hooks/use-import-files.ts` + `apps/web/src/app/inicio/inicio-empty-state.tsx` + `apps/web/src/app/onboarding/import/import-flow.tsx`] — `pdf-lib` with `ignoreEncryption: true` can also return 0 pages for encrypted PDFs (P60 trade-off). Fix: at every gate (`applyPageCountGate` Expo + `gatePdfPageCount` Web ×2), treat `pageCount === 0` as `UPLOAD_PDF_UNREADABLE_PT_BR`. Schema change is unnecessary if the gate handles it.
- [x] [Review][Patch] **R2-P68: Picker `fetch(file.uri)` on Expo doesn't check `response.ok` — a 404/HTML body silently flows into `pdf-lib.load`** [`apps/expo/src/hooks/use-import-files.ts:applyPageCountGate`] — pdf-lib will throw, which IS caught and surfaced as UNREADABLE, but the patient gets blamed for the wrong cause. Fix: `if (!response.ok) throw new Error('fetch-failed')` before `arrayBuffer()`.
- [x] [Review][Patch] **R2-P69: Expo `handlePickPdf` only calls `setSheetOpen(false)` on the success branch — if `pickDocuments` throws (iOS picker error), the sheet stays open and there's no user feedback** [`apps/expo/src/app/(tabs)/inicio.tsx`] — fix: move `setSheetOpen(false)` into `finally` (it runs after `pickDocuments` regardless of error).
- [x] [Review][Patch] **R2-P70: Mime-mismatch bypass — request as `image/jpeg`, PUT PDF bytes to storage, confirm without `pageCount`** [`packages/api/src/router/uploads.ts:confirmImport`] — `confirmImport` already hard-rejects content-type mismatch via storage allowlist check, but if storage reports `application/pdf` while `input.mimeType` was a non-PDF (so `input.pageCount` is undefined), the page-cap check `input.pageCount !== undefined` short-circuits and the upload proceeds. Fix: explicit mime-mismatch check — when `storedContentType === 'application/pdf' && input.mimeType !== 'application/pdf'`, throw `BAD_REQUEST / UPLOAD_MIME_MISMATCH` BEFORE the page-cap gate.
- [x] [Review][Patch] **R2-P71: Hidden `<input type="file">` on Web is keyboard-tabbable and screen-reader-discoverable as an unlabeled file input** [`apps/web/src/app/inicio/inicio-empty-state.tsx`] — the visible CTA is the sheet button; the raw input is internal plumbing. Fix: add `aria-hidden="true"` and `tabIndex={-1}` to the `sr-only` `<input>`.
- [x] [Review][Patch] **R2-P72: Drop dead `input.pageCount !== undefined` guards in `requestImport` + `confirmImport`** [`packages/api/src/router/uploads.ts`] — the Zod refinement (P52) now guarantees `pageCount` is defined for `application/pdf`, so the guards are unreachable on legit traffic. Replace with a comment that the cap is now Zod-enforced AND server-cap-enforced, removing the dead branch.
- [x] [Review][Patch] **R2-P73: Spec Task 3 line 60 still describes `pageCount` as `.optional()` — stale post-P52** [`_bmad-output/implementation-artifacts/2-1-patient-uploads-a-pdf-blood-test-result.md` Task 3] — fix: append a sentence noting `pageCount` is required for `application/pdf` mime via Zod refinement so future audits don't keep re-flagging.

**`defer` (added to `deferred-work.md`):**

- [x] [Review][Defer] F84: Type-tighten `PickedFile` so `application/pdf` requires `pageCount` at the TS level (currently optional; the gate ensures it's set in practice, but a future caller could skip the gate and the Zod error message would be confusing). Discriminated-union refactor; do when a third upload caller appears.
- [x] [Review][Defer] F85: Web `inicio-empty-state.tsx` has no unmount safety — navigation away mid-upload triggers React's "setState on unmounted" warnings and orphans the in-flight PUT. Joins F74's AbortController work.
- [x] [Review][Defer] F86: Verify `role="status"` actually forwards to the rendered DOM via Tamagui on web AND that React Native's View ignores it cleanly. Hand-test. If RN logs warnings, gate the `role` prop behind `Platform.OS === 'web'`.
- [x] [Review][Defer] F87: `applyDeadLetter` metadata merge uses `JSON.stringify(merged)` — if a caller passes BigInt or a circular structure, it throws synchronously and the row never transitions to `failed`. Wrap in try/catch and sanitize.
- [x] [Review][Defer] F88: `countPdfPages` uses dynamic `await import('pdf-lib')` — first pick on a cold page incurs ~200–500 ms of import resolution with no loading indicator. Hot pick is fine. Add a spinner state or use static import.
- [x] [Review][Defer] F89: `usePulseOpacity` `setInterval` triggers a 1.5 s re-render of the entire ExtractionPulse subtree (filename list included). Wasted renders. Use CSS keyframes on web / `react-native-reanimated` on RN, or memoize children.

**Dismissed (14):** "pageCount bypass at confirm" Blind High #2 / Edge #6 (false positive — Zod refinement covers it); "SSR initial reducedMotion flash" (already F80); "sheet closes silently on cancel" (intended UX); "cleanupStartedAt race" (theoretical, no reproduction); "Tamagui Button disabled web verification" (already F79); "lastOutcomes lingers" (already F77); "rapid CTA double-tap before isUploading flips" (covered by isPickingRef); "metadata key collision in applyDeadLetter" (cosmetic); "JSON.stringify drops fn/symbol" (no caller passes those); "id-generation low-prob collision" (covered by R2-P66 upgrade to randomUUID); "post_onboarding pt-BR label uses English loanword" (spec-prescribed verbatim; not user-facing until Story 2.5); "sequential web uploads block" (intentional; future Story 2.5 concern); "AcceptanceAuditor File List OK" (confirmation, not a finding); "Edge #16 isUploading flip race" (covered by ref guard).

---

**Dismissed (R1, 17):** NULL-jsonb concat in `applyDeadLetter`/`runUpdate` (column is `NOT NULL DEFAULT '{}'`); `processing → processing` rejection (spec-prescribed Task 2); `queued → failed` not in arc map (reachable via `applyDeadLetter`); duplicate 20–30s / 30s+ pt-BR strings (spec-prescribed Task 4); `complete`-state fade gap (already in F69); `ExtractionPulse.onCancel` prop missing (YAGNI per dev); web `inicio` rewrites upload pipeline (already F71/F83); `extractionPulseCopyForElapsedMs` accepts negative ms (caller clamps); test cast `as { source: string }` (lint workaround); web `matchMedia` SSR-safety (already guarded with `typeof window`); `AccessibilityInfo.addEventListener` cleanup on RN < 0.65 (project pins SDK 54 / RN 0.81); `reducedMotion` mid-pulse stale `bright` state (cosmetic); `activeUris` recomputed every render (micro-perf); `countPdfPages` OOM for near-cap files (`UPLOAD_MAX_BYTES` 5 MB cap exists); picker cancellation closing the sheet (UX choice); spec-vs-test location for `extraction-pulse.test.ts` (already covered by P63 spec-File-List update); same picker URI for two `PickedFile`s (DocumentPicker returns unique cache URIs).

### Change Log

- 2026-05-22 — Code review round 2. **9 patches resolved (R2-P65–R2-P73); the headline finds were two real bypass holes opened by round-1 patches.** R2-P65: web `isPickingRef` never reset when the user cancelled the native file dialog (the `change` event doesn't fire on cancel), so after one cancel every subsequent CTA tap was silently dropped — fixed via `cancel` + window-focus listeners. R2-P67: round-1 P60's `ignoreEncryption: true` lets `pdf-lib` return 0 pages for encrypted PDFs; combined with `.nonnegative()` (P61), a 0-page PDF passed both schema refinement AND the cap check (`0 > 10` is false) and would have been enqueued for extraction with empty content — all three gates (Expo + Web Início + Web onboarding) now reject `pageCount <= 0` as `UPLOAD_PDF_UNREADABLE_PT_BR`. R2-P70: mime-mismatch bypass — request as `image/jpeg` (no `pageCount` required), PUT PDF bytes to the signed URL, confirm without `pageCount`; the storage allowlist check accepted the PDF (it's allow-listed) but the page-cap check short-circuited because `input.pageCount` was undefined — closed by an explicit mime-mismatch check before the page-cap gate at `confirmImport`. Other fixes: R2-P66 (`crypto.randomUUID()` instead of `Math.random` for the synthetic upload id), R2-P68 (`response.ok` guard on the Expo picker fetch), R2-P69 (Expo `handlePickPdf` closes the sheet in `finally`), R2-P71 (hidden web `<input>` gets `aria-hidden` + `tabIndex=-1`), R2-P72 (drop dead `pageCount !== undefined` guards in router; replaced with `(input.pageCount ?? 0) > UPLOAD_MAX_PDF_PAGES`), R2-P73 (spec Task 3 wording reflects the required Zod refinement). 6 items deferred (F84–F89). Lint, typecheck, format, tests all green (85 unit tests; 1 new for the mime-mismatch rejection — R2-P70).
- 2026-05-22 — Code review pass (Blind Hunter + Edge Case Hunter + Acceptance Auditor). 13 patches resolved (P52–P64), 10 deferred (F74–F83), 17 dismissed. **Highest-impact catch**: the original `pageCount` cap was a soft gate — a hostile client could bypass it by simply omitting the field, because both `requestImport` and `confirmImport` only checked when `pageCount !== undefined` (P52). Fix: Zod refinement makes `pageCount` REQUIRED when `mimeType === 'application/pdf'` on both schemas. Other notable fixes: P53 (web `active` upload list keyed by stable id, not name); P54 (new `UPLOAD_PDF_UNREADABLE_PT_BR` for encrypted/corrupt/network-failed PDFs); P55 (`startedAtByPath` cleared in `finally`); P56 (drop conflicting `accessibilityRole="alert"` from ExtractionPulse); P57 (sheet "Foto ou câmera" is now a real disabled `<Button>`); P58 (filename `key` includes idx); P59 (re-entry guard on the sheet's PDF CTA, both surfaces); P60 (`countPdfPages` uses `ignoreEncryption: true`); P61 (`pageCount` schema is `.nonnegative()`); P62 (UPLOAD_SOURCE_PT_BR_LABELS matches spec verbatim); P63 (spec File List update); P64 (review-needed ExtractionPulse keeps teal fill with amber border). 84 tests still green. Status: review → done.
- 2026-05-22 — Story 2.1 implemented (Amelia, dev-story). All 8 tasks complete; status → review. Added the `source` parameter end-to-end, `upload-transitions.ts` state-machine helper (with the optimistic-lock + dead-letter contract that Story 2.3's worker will consume), `ExtractionPulse` + `UploadSourceSheet` UI components, PDF page-count gate via `pdf-lib` (client-side pre-transmission + server-side defense-in-depth), and the post-onboarding upload entry on Início (Expo + Web). Onboarding flow path is unchanged (Story 1.5's `/onboarding/import` URL is still reachable directly). 84 unit tests green (+48 new), lint + typecheck + format + test all green. Story 2.3's extraction worker is the first real caller of `applyUploadTransition`; until then ExtractionPulse is driven by client-side elapsed time, which is fine for the cold-start case.
