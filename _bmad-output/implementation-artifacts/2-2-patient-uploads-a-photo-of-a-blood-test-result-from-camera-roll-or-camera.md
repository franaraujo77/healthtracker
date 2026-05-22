# Story 2.2: Patient uploads a photo of a blood test result from camera roll or camera

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a patient,
I want to upload a photo of my printed lab result from my camera roll or by taking a photo directly,
so that I can add results I received via WhatsApp or photographed at the lab, without needing a PDF.

## Acceptance Criteria

**AC1 — Camera-roll image upload from the post-onboarding sheet**
**Given** I am on the Início tab and tap the upload CTA,
**When** the upload sheet now offers "Arquivo PDF", "Foto da galeria", and "Tirar foto" (the photo rows are no longer disabled — Story 2.1 stubbed them with the "Em breve" affordance),
**Then** picking "Foto da galeria" opens the system photo picker via `expo-image-picker.launchImageLibraryAsync`; selecting a JPEG, PNG, or HEIC image that passes client-side validation (≤ 5 MB, allowed mime) inserts a `uploads` row via `uploads.requestImport` + `uploads.confirmImport` with `source = 'post_onboarding'`, `status = 'queued'`, no `pageCount` (the field is PDF-only — the Zod refinement requires it only when `mimeType === 'application/pdf'`), and the `ExtractionPulse` component renders on Início with the same patience-pattern copy and reduced-motion behavior Story 2.1 ships.

**AC2 — Camera capture follows the same pipeline**
**Given** I tap "Tirar foto" instead of "Foto da galeria",
**When** I capture a photo of a lab report via `expo-image-picker.launchCameraAsync`,
**Then** the captured image is fed through the same `useImportFiles.uploadFiles` flow as a camera-roll image — same request/confirm two-step, same `source: 'post_onboarding'`, same idempotency-key contract, same `extraction.document` enqueue. No additional client-side validation steps. iOS requires `NSCameraUsageDescription` in `app.config.ts`; Android handles the runtime permission via `expo-image-picker`'s `requestCameraPermissionsAsync`.

**AC3 — Brazilian-format extraction (Story 2.3 territory; not implemented here)**
**Given** the image is a photograph of a printed Brazilian lab report with decimal-comma separators,
**When** AWS Textract in `sa-east-1` processes the image,
**Then** the extracted value is correctly parsed (e.g., `"2,4"` → `2.4`) and the LOINC normalization step produces a valid `loinc_code`. **Story 2.2 does NOT implement this** — the extraction worker (Story 2.3) owns AWS Textract integration and the decimal-comma normalization (UX-DR12). Story 2.2's responsibility is to enqueue the image upload through the existing pipeline so Story 2.3 picks it up.

**AC4 — `failed` state via `upload-transitions.ts` (Story 2.3 territory; helper contract is already in place)**
**Given** image OCR produces no readable text (blurry, rotated, or non-lab image),
**When** the extraction pipeline returns confidence scores all below 0.01,
**Then** the upload enters the `failed` state via `applyDeadLetter(db, { uploadId })` from `packages/api/src/upload-transitions.ts` (the helper Story 2.1 shipped), the patient sees a specific failure reason (not a generic "algo deu errado") with 3 recovery options: "Tirar nova foto", "Enviar PDF", "Inserir manualmente". **Story 2.2 does NOT implement the worker side** — it ships the recovery-options copy and the post-failure UI surface on the upload card. The worker-side `applyDeadLetter` call lands in Story 2.3.

**Requirements:** FR2, FR3, FR4, FR5, FR10, AR8, AR14, NFR-I2, NFR-R3, UX-DR12, UX-DR20

## Tasks / Subtasks

- [ ] **Task 1 — Extend `pickImages` to support library + camera modes** (AC: #1, #2)
  - [ ] Story 1.5 shipped `pickImages` as photo-library-only. Add a parameter: `pickImages({ source: 'library' | 'camera' })` and route to `ImagePicker.launchImageLibraryAsync` vs `ImagePicker.launchCameraAsync`. Both paths share the post-pick validation pipeline (`validatePicked` — size, mime). Page-count gate (`applyPageCountGate`) is PDF-only and stays bypassed for images.
  - [ ] Camera mode: call `ImagePicker.requestCameraPermissionsAsync()` BEFORE `launchCameraAsync()`. If denied, return `{ files: [], rejected: [{ uri: 'permission-denied', name: '', mimeType: '', size: 0, validationError: CAMERA_PERMISSION_PT_BR }] }` — mirror Story 1.5 P43's photo-library pattern.
  - [ ] Library mode: continue to use `requestMediaLibraryPermissionsAsync()` (unchanged).
  - [ ] Both modes return the same `PickResult` shape so the caller doesn't branch.
  - [ ] **HEIC handling**: iOS captures may return HEIC by default. `expo-image-picker` exposes a `mediaTypes: ['images']` option (already used) plus `quality: 1`. HEIC files >5 MB are rejected by the existing `UPLOAD_MAX_BYTES` check; smaller HEIC files go straight through (allowlist already includes `image/heic`).
  - [ ] **Multi-select**: library mode keeps `allowsMultipleSelection: true`. Camera mode is single-capture by design (no `allowsMultipleSelection`).

- [ ] **Task 2 — Add `NSCameraUsageDescription` to `app.config.ts`** (AC: #2)
  - [ ] Append to `ios.infoPlist`: `NSCameraUsageDescription: "Permita o acesso à câmera para fotografar resultados de exames."` (pt-BR per UX-DR20, 8th-grade reading level, names the action — not just "this app").
  - [ ] Native module rebuild required (same family as Story 1.5 F48). Document in PR notes.

- [ ] **Task 3 — Update `UploadSourceSheet` to expose 3 active rows** (AC: #1, #2)
  - [ ] Story 2.1 shipped the sheet with PDF active + photo disabled ("Em breve"). Story 2.2 replaces the single disabled "Foto ou câmera" row with TWO active rows: "Foto da galeria" and "Tirar foto". The PDF row stays.
  - [ ] Drop `UPLOAD_SHEET_PHOTO_DISABLED_LABEL_PT_BR` usage from the sheet (still exported from validators in case other surfaces want it).
  - [ ] New props on `UploadSourceSheetProps`: `onPickImageFromLibrary: () => void` and `onPickImageFromCamera: () => void`. The Photo-related rows are visible-and-active only when these callbacks are provided (so onboarding consumers can stay PDF-only if they want — though we're enabling them everywhere this story).
  - [ ] Update `UPLOAD_SHEET_*` copy: `UPLOAD_SHEET_PHOTO_LIBRARY_LABEL_PT_BR = "Foto da galeria"`, `UPLOAD_SHEET_PHOTO_CAMERA_LABEL_PT_BR = "Tirar foto"`. Keep `UPLOAD_SHEET_PHOTO_LABEL_PT_BR` deprecated-but-exported for one transition cycle.
  - [ ] A11y: each row is a real `<Button>` with `accessibilityHint` naming the action ("Abre o seletor de fotos do dispositivo" / "Abre a câmera para fotografar um exame"). Story 2.1 P57's "real disabled Button" pattern reaffirmed — no XStack-as-fake-button.

- [ ] **Task 4 — Wire camera + library branches into Expo Início** (AC: #1, #2)
  - [ ] In `apps/expo/src/app/(tabs)/inicio.tsx`: add `handlePickImageLibrary` and `handlePickImageCamera` handlers. Both wrap `pickImages` then `uploadFiles` exactly like `handlePickPdf` (Story 2.1 R2-P69 pattern: close the sheet in `finally`, `isPickingRef` guard, no per-source ref because the user can't trigger two pickers concurrently with the sheet closing on press).
  - [ ] Pass both callbacks to `<UploadSourceSheet>`.
  - [ ] The existing `ExtractionPulse` render condition keys off `progressByPath` — same for images as for PDFs, no change.
  - [ ] **`pickDocumentsAccept`**: currently locked to PDF-only on Início. Story 2.2 does NOT widen this — the PDF row stays PDF-only via DocumentPicker, the image rows go through ImagePicker. The two pickers don't share a backend, so the `accept` array is irrelevant for image flows.

- [ ] **Task 5 — Wire camera + library branches into Expo onboarding `/onboarding/import`** (AC: #1, #2 — resolves F60)
  - [ ] Story 1.5 F60 deferred this — `pickImages` was exported by the hook but the onboarding screen only wired `pickDocuments`. Story 2.2 resolves F60.
  - [ ] In `apps/expo/src/app/onboarding/import.tsx`: replace the single "Escolher arquivos" button with the same `UploadSourceSheet` pattern (open sheet → choose PDF / library / camera). OR keep the existing button and add two siblings ("Foto da galeria" / "Tirar foto"). Recommended: introduce the sheet here too for visual consistency with Início.
  - [ ] The onboarding hook call already uses `useImportFiles({ source: 'onboarding_import' })`. No source change. The onboarding picker should accept all four allowed mime types for PDF (it currently passes the full `UPLOAD_ALLOWED_MIME_TYPES` to `pickDocuments`); the image rows route via `pickImages` independently.

- [ ] **Task 6 — Web post-onboarding: extend `inicio-empty-state.tsx` to accept images** (AC: #1; AC2 N/A on web — no native camera capture beyond `<input capture>`)
  - [ ] Web currently restricts `<input type="file" accept="application/pdf">` to PDF on the post-onboarding entry. Extend to accept the full image allowlist: `accept="application/pdf,image/jpeg,image/png,image/heic"`.
  - [ ] Sheet update: same 3-row pattern, but the camera row uses `<input type="file" accept="image/*" capture="environment">` — works on mobile browsers, falls back to the file picker on desktop. Document the fallback in the row's `accessibilityHint`.
  - [ ] `validateClientSide` on web: drop the PDF-only check; allow any mime in `UPLOAD_ALLOWED_MIME_TYPES`. The PDF page-count gate (`gatePdfPageCount`) already short-circuits for non-PDF mime types — keep that.
  - [ ] **Decision deferred to clarification**: do we ship the camera row on web at all in 2.2, or wait? Recommended: ship — the `capture` attribute is a one-line addition and the mobile-browser case is genuinely useful (some patients won't install the app).

- [ ] **Task 7 — Update Story 2.1 ExtractionPulse `complete` / `review-needed` copy for the image-failure path** (AC: #4)
  - [ ] Story 2.1 shipped `EXTRACTION_PULSE_COMPLETE_PT_BR = "Pronto"` and `EXTRACTION_PULSE_REVIEW_NEEDED_PT_BR = "Um resultado precisa da sua confirmação"`. Story 2.2 adds a new `failed` UI surface for images that hit the dead-letter path (Story 2.3 will fire `applyDeadLetter` from the worker; Story 2.2 ships the patient-facing copy + 3 recovery options).
  - [ ] Add validator strings: `UPLOAD_IMAGE_OCR_FAILED_PT_BR = "Não conseguimos ler este exame. Tente uma destas opções abaixo."`, `UPLOAD_RECOVERY_RETAKE_PT_BR = "Tirar nova foto"`, `UPLOAD_RECOVERY_UPLOAD_PDF_PT_BR = "Enviar PDF"`, `UPLOAD_RECOVERY_MANUAL_PT_BR = "Inserir manualmente"`.
  - [ ] Extend `ExtractionPulseState` with `'failed'` and add three optional `onRetake` / `onUploadPdf` / `onManualEntry` callbacks. When state is `failed`, render a static gray circle + the failure copy + a 3-button stack. Reuse the existing pure-function copy mapper pattern.
  - [ ] **Story 2.2 ships the ExtractionPulse `failed` state ONLY**. The actual `applyDeadLetter` trigger from the worker is Story 2.3. For 2.2 hand-test: pass `state="failed"` from a temporary feature flag or storybook surface.
  - [ ] **`onUploadPdf` callback** wires the post-onboarding sheet back open in PDF mode. `onRetake` re-opens the camera picker. `onManualEntry` is Story 2.7 (manual BIA entry); leave the prop optional and don't render the button if undefined for now.

- [ ] **Task 8 — Validators + shared pt-BR copy** (AC: all)
  - [ ] All new strings listed in Tasks 2–7 above. Centralized as constants per Story 1.5 / 2.1 pattern.
  - [ ] `CAMERA_PERMISSION_PT_BR = "Permita o acesso à câmera para fotografar o seu exame."`
  - [ ] `UPLOAD_SHEET_PHOTO_LIBRARY_HINT_PT_BR = "Abre o seletor de fotos do dispositivo"`
  - [ ] `UPLOAD_SHEET_PHOTO_CAMERA_HINT_PT_BR = "Abre a câmera para fotografar um exame"` (web variant: `"Abre a câmera no celular, ou o seletor de arquivos no desktop"`)

- [ ] **Task 9 — Tests** (AC: #1, #2)
  - [ ] Extend `useImportFiles` test coverage (currently no tests for the hook — Story 1.5 deferred). For Story 2.2 add a small test in `packages/api/__tests__/` (validators-pdf-helpers.test.ts is fine, or a new `image-picker-helpers.test.ts` if a pure-function seam emerges) for:
    - `pickImages({ source: 'library' })` — permission denied → returns the permission rejection shape.
    - `pickImages({ source: 'camera' })` — same.
    - Validation: a non-PDF image with `pageCount` set is correctly omitted from the mutation payload (the conditional spread `...(file.pageCount !== undefined ? ... : {})` already does this; verify with a test).
  - [ ] No new `uploads.test.ts` tests needed unless the router changes (it shouldn't — image flow uses the same `requestImport`/`confirmImport`).
  - [ ] Hand-test matrix (no Vitest infra for picker UIs):
    1. Cold-start Início → tap CTA → sheet shows 3 active rows.
    2. Tap "Foto da galeria" → grant permission → pick a 2 MB JPEG → upload starts → ExtractionPulse renders → row appears `queued` on server.
    3. Tap "Tirar foto" → grant camera permission → capture → same outcome.
    4. Deny camera permission → see `CAMERA_PERMISSION_PT_BR` inline (handled by `useImportFiles` rejection path).
    5. Pick a 10 MB image → `UPLOAD_FILE_TOO_LARGE_PT_BR` pre-transmission.
    6. Pick a HEIC image → uploaded successfully (allowlist includes HEIC).
    7. Onboarding flow: same sheet pattern works on `/onboarding/import` post-F60 fix.
    8. Web post-onboarding: tap "Foto da galeria" → file picker accepts images; tap "Tirar foto" on mobile browser → camera opens; on desktop browser → fallback file picker.
  - [ ] `pnpm typecheck`, `pnpm lint`, `pnpm format`, `pnpm test` all green. No regressions in the 85 existing tests from Story 2.1.

## Dev Notes

### Architecture patterns and constraints

- **Story 2.1 shipped 90% of the infrastructure.** `useImportFiles` (with `source` + `startedAtByPath` + page-count gate), `UploadSourceSheet` (with PDF active + photo disabled), `ExtractionPulse` (3 states: processing / review-needed / complete), `uploads.requestImport` + `confirmImport` (with the Zod refinement requiring `pageCount` only when `mimeType === 'application/pdf'` — images flow through without it), and the upload-transitions.ts state-machine helper (with `applyDeadLetter` for AC4) are all in place. Story 2.2 enables the photo branches and adds the `failed` ExtractionPulse state.
- **AC3 + AC4 are split deliberately.** AC3 (decimal-comma parsing) is Story 2.3 worker territory; AC4's worker-side `applyDeadLetter` invocation is Story 2.3 as well. Story 2.2 ships the patient-facing UI for the `failed` state (the ExtractionPulse failed state + recovery copy) so Story 2.3 can wire the call sites without UI work. If a reviewer asks "where does `applyDeadLetter` actually fire?", the answer is: not until Story 2.3.
- **AR21 (idempotency)**: unchanged. Images use the same `idempotency_key UNIQUE` seam.
- **`upload_source_enum` = post_onboarding** for the Início entry, `onboarding_import` for the onboarding screen — same as Story 2.1.
- **Image file sizes**: HEIC compresses well; JPEG/PNG can balloon. The 5 MB `UPLOAD_MAX_BYTES` cap holds for images too. Some camera captures (12+ MP) exceed it; document the limit in the camera-permission usage string indirectly.
- **AWS Textract** is the planned extraction backend for images per architecture.md (sa-east-1 region for NFR-S8). Story 2.2 does NOT touch Textract — that's Story 2.3's wiring.
- **F60 resolution**: Story 1.5 F60 deferred wiring `pickImages` into the onboarding screen. Story 2.2 Task 5 resolves it.
- **F86 follow-up**: Story 2.1 R2 deferred verifying that `role="status"` cleanly forwards to RN. ExtractionPulse's new `failed` state inherits the same a11y pattern — no new attribute concerns.

### Requirement texts

- **FR2:** Patient can upload a blood test result as an image (JPEG/PNG/HEIC) from camera roll or direct camera capture. [prd.md:475]
- **FR3:** System extracts biomarker values with per-field confidence scores. — _Story 2.3 territory._
- **FR4:** System normalizes extracted values to LOINC codes. — _Story 2.3._
- **FR5:** System stores extracted observations. — _Story 2.3._
- **FR10:** Idempotency key. — Story 1.5 shipped the seam; Story 2.2 uses it unchanged.
- **AR8 / AR14:** Signed-URL storage, per-patient prefixed paths. — Story 1.5 / 2.1 shipped.
- **NFR-I2:** Confidence ≥0.85 auto-publishes; <0.85 routes to review. — _Story 2.3._
- **NFR-R3:** Failure recovery via retry / manual entry. — Story 2.2 ships the patient-facing recovery options copy; Story 2.3 wires the worker side.
- **UX-DR12:** Brazilian decimal-comma normalization. — _Story 2.3 (extraction)._
- **UX-DR20:** pt-BR copy, 8th-grade reading level, ANVISA-compliant.

### Source tree components to touch

**Modified files:**

- `packages/validators/src/index.ts` — new strings: `UPLOAD_SHEET_PHOTO_LIBRARY_LABEL_PT_BR`, `UPLOAD_SHEET_PHOTO_CAMERA_LABEL_PT_BR`, `UPLOAD_SHEET_PHOTO_LIBRARY_HINT_PT_BR`, `UPLOAD_SHEET_PHOTO_CAMERA_HINT_PT_BR`, `CAMERA_PERMISSION_PT_BR`, `UPLOAD_IMAGE_OCR_FAILED_PT_BR`, `UPLOAD_RECOVERY_RETAKE_PT_BR`, `UPLOAD_RECOVERY_UPLOAD_PDF_PT_BR`, `UPLOAD_RECOVERY_MANUAL_PT_BR`.
- `packages/ui/src/upload-source-sheet.tsx` — new 3-row layout, new props (`onPickImageFromLibrary`, `onPickImageFromCamera`).
- `packages/ui/src/extraction-pulse.tsx` — new `'failed'` state + 3 recovery callbacks. Pure-function extension of `pulseCopyForState`.
- `apps/expo/src/hooks/use-import-files.ts` — `pickImages({ source: 'library' | 'camera' })` signature. Camera permission handling.
- `apps/expo/src/app/(tabs)/inicio.tsx` — two new handlers; pass to sheet.
- `apps/expo/src/app/onboarding/import.tsx` — replace single picker button with the `UploadSourceSheet` pattern (F60 fix).
- `apps/expo/app.config.ts` — add `NSCameraUsageDescription` to `ios.infoPlist`.
- `apps/web/src/app/inicio/inicio-empty-state.tsx` — widen `accept` to images; add 3-row sheet with camera-capture file input.
- `apps/web/src/app/onboarding/import/import-flow.tsx` — already accepts the full allowlist; no change unless the sheet pattern is also extracted here (likely Story 2.5 territory; F83 / F71 reaffirmed).

**No new files expected** beyond possibly one small image-picker test seam (Task 9). All UI components extend existing files.

### Testing standards summary

- Same conventions as Story 2.1 / 1.5: Vitest at `packages/api/__tests__/`; mocked DB chains; pure-function extraction wherever testable.
- Picker UI tested by hand (F11 family deferred).
- Camera capture: hand-test on a physical device or simulator with camera. EAS dev-client rebuild required (native module config change — `NSCameraUsageDescription`).
- `pnpm typecheck`, `pnpm lint`, `pnpm format`, `pnpm test` all green; no regressions in the 85 tests from Story 2.1.

### Previous story intelligence (1.1–2.1)

- **`useImportFiles({ source })` is the single sanctioned entry to the upload flow** (Story 2.1). Don't reimplement; extend `pickImages` instead.
- **Picker re-entry guard pattern** (Story 2.1 R2-P59 / R2-P65 / R2-P69): `isPickingRef` ref + `try { ... } finally { isPickingRef.current = false; setSheetOpen(false); }`. Apply identically to the new camera + library handlers.
- **`UploadSourceSheet` rows are real `<Button>`s** (Story 2.1 P57). Don't render disabled rows as XStacks; either ship the button (active) or omit it.
- **`ExtractionPulse` state-driven props** (Story 2.1): new states extend the union; the elapsed-ms-to-copy mapper is a pure function with snapshot tests. Match the pattern.
- **Camera permission rejection surface** (Story 1.5 P43): return a `rejected` entry with `validationError` set to the pt-BR permission string. The rendering surface (Início / onboarding) already displays rejections; no UI change needed for permission-denied.
- **No HEIC parsing on the client** (Story 1.5 / 2.1): images go straight to storage; AWS Textract handles them server-side. Don't add HEIC → JPEG conversion in Story 2.2.
- **The `failed` ExtractionPulse state ships in 2.2 BUT no worker fires it yet** — Story 2.3 wires the trigger. Document this explicitly in the dev notes for the implementer and in the change log so future devs don't think it's dead code.
- **Round-2 review caught real bugs every time in Epic 1 + Story 2.1** — plan for two rounds. The camera flow is platform-specific (iOS, Android, web with `capture` attribute) and adversarial review historically catches platform-edge bugs (e.g., R2-P65's web `cancel` event).

### Git intelligence

Recent commits (`git log --oneline -3`):

```
cc0e6cf feat(uploads): story 2.1 — patient uploads PDF post-onboarding
45818c4 Epic 1: Patient onboarding (account → consent → biometric → import → Início) (#5)
835e934 chore(prep): resolve Epic 0 retro prep items before Epic 1
```

Conventional Commits with scopes. Use `feat(uploads):` for Story 2.2 work; `feat(ui):` for ExtractionPulse / UploadSourceSheet extensions. PR title: `feat(uploads): story 2.2 — patient uploads photo (camera roll + camera)`.

### Latest tech information

- **`expo-image-picker` v17** (already installed). API surface:
  - `requestMediaLibraryPermissionsAsync()` — photo library permission.
  - `requestCameraPermissionsAsync()` — camera permission.
  - `launchImageLibraryAsync({ mediaTypes: 'images', allowsMultipleSelection: true, quality: 1 })`.
  - `launchCameraAsync({ mediaTypes: 'images', quality: 1 })` — single-capture by design.
  - Both return `{ canceled, assets: [{ uri, fileName, mimeType, fileSize, ... }] }`.
- **`expo-image-picker` Info.plist requirements** (already documented):
  - `NSPhotoLibraryUsageDescription` (already in `app.config.ts`).
  - `NSCameraUsageDescription` — **Story 2.2 adds this**.
- **Android camera permission**: `expo-image-picker` registers `android.permission.CAMERA` automatically via the config plugin. No manifest edit required.
- **Web `<input type="file" capture="environment">`**: triggers the device camera on iOS Safari + Android Chrome; ignored on desktop browsers (falls back to file picker). One-line attribute, zero JS.
- **HEIC support**: iOS native; Android requires `expo-image-manipulator` to round-trip (we don't transform — Textract handles HEIC server-side). No client work.

### Project Structure Notes

- **Worktree**: Story 2.2 should branch from `main` after Story 2.1 merges. For now, this story file lives on the `worktree-story-2-1` branch; the dev step will likely move to a new `worktree-story-2-2` branch.
- **`packages/ui` flat structure** still in force (`packages/ui/src/upload-source-sheet.tsx` etc., no nested `components/` dir).
- **Onboarding flow ordering unchanged** by Story 2.2.
- **`/onboarding/import` URL still reachable directly** post-2.2 (Story 2.1 maintained backward compat; Story 2.2 changes the screen's picker UI but not the route).
- **No new external dependencies**: `expo-image-picker` v17 ships `launchCameraAsync` out of the box. No `expo-camera` needed (that's a heavier API for custom camera UIs).
- **Native rebuild required**: adding `NSCameraUsageDescription` is an Info.plist change → `pnpm expo prebuild --clean` or a fresh EAS dev-client build. F48 family reminder.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story-2.2] — story text, ACs, requirement tags. Lines 671–697.
- [Source: _bmad-output/planning-artifacts/architecture.md] — AWS Textract integration (L451, L457, L464); image extraction is Story 2.3.
- [Source: _bmad-output/planning-artifacts/ux-design-specification.md] — `ExtractionPulse` patience pattern (L1090–1094); UX-DR20 pt-BR conventions.
- [Source: _bmad-output/planning-artifacts/prd.md] — FR2 (L475).
- [Source: _bmad-output/implementation-artifacts/2-1-patient-uploads-a-pdf-blood-test-result.md] — Story 2.1 dev notes; F60 / F86 follow-up context; UploadSourceSheet + ExtractionPulse + useImportFiles contracts.
- [Source: _bmad-output/implementation-artifacts/deferred-work.md#F60] — "wire `pickImages` into the onboarding screen" — Story 2.2 resolves.
- [Source: packages/api/src/upload-transitions.ts] — `applyDeadLetter(db, { uploadId })` for AC4's worker call site (Story 2.3 implementation, Story 2.2 documents the contract).
- [Source: apps/expo/src/hooks/use-import-files.ts:255] — current `pickImages` implementation (library-only; Story 2.2 extends).
- [Source: packages/ui/src/upload-source-sheet.tsx] — current 2-row layout (PDF active, photo disabled); Story 2.2 expands to 3 rows.
- [Source: apps/expo/app.config.ts] — `ios.infoPlist` location for new `NSCameraUsageDescription`.

### Clarifications for the user (resolve before/at start of dev)

1. **Sheet layout: 3 rows vs nested action sheet.** AC1's "Foto ou câmera" wording reads as a single entry that fans out into Library/Camera. The spec drafts 3 flat rows (PDF / Library / Camera) for simplicity — fewer modals, one tap to the picker. Recommended: 3 flat rows. Confirm — and if the user prefers the nested pattern, expect a second modal/sheet implementation.
2. **Web camera capture (Task 6).** Ship the `<input type="file" capture="environment">` row on web in 2.2, or wait for a desktop-vs-mobile decision in Story 2.5? Recommended: ship now — it's a one-line attribute that works on mobile browsers and harmlessly falls back to the file picker on desktop. Confirm.
3. **ExtractionPulse `failed` state (Task 7)**: Story 2.2 ships the UI but no real trigger until Story 2.3's worker calls `applyDeadLetter`. Acceptable for v1, or block on Story 2.3 first? Recommended: ship the UI; document as "no live trigger until Story 2.3" in the change log. Confirm.
4. **Onboarding screen redesign (Task 5)**: do we replace the current 2-button onboarding picker UI with the same `UploadSourceSheet` for consistency, or keep onboarding's existing UI and just wire the `pickImages` button alongside it? Recommended: extract sheet for consistency. Confirm — extra UI work but pays back in maintenance.
5. **`UPLOAD_SHEET_PHOTO_LABEL_PT_BR` cleanup**: Story 2.1 shipped this as the disabled row's label. Story 2.2 doesn't use it anymore. Deprecate-export-only, or delete? Recommended: delete — no current consumer; if a future caller needs it, restore.
6. **Multi-capture for camera**: `launchCameraAsync` is single-capture. AC2 doesn't require multi-capture. Confirm we're shipping single-capture (one photo per "Tirar foto" tap).
7. **Image rotation / orientation**: photographs from camera roll may have EXIF orientation metadata. Server-side extraction (Story 2.3 Textract) handles rotation natively; the client doesn't need to transform. Confirm we're NOT adding `expo-image-manipulator` for client-side rotation.
8. **HEIC bundle size / quality**: `expo-image-picker` `quality: 1` preserves original quality. For HEIC files >5 MB the user sees `UPLOAD_FILE_TOO_LARGE_PT_BR` — acceptable, or do we transparently downscale to fit under 5 MB? Recommended: do NOT downscale (lossy; user will be surprised). Confirm — and the patient-facing escape is "tap PDF or manual entry" via the failed-state recovery copy.

## Dev Agent Record

### Agent Model Used

claude-opus-4-7[1m]

### Debug Log References

### Completion Notes List

### File List
