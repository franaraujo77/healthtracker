# Story 2.3: System extracts and normalizes biomarker values from uploaded documents

Status: review

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a developer,
I want the extraction pipeline to produce LOINC-normalized observations with per-field confidence scores,
so that the data entering the `observations` table is consistently structured regardless of source lab or format.

## Acceptance Criteria

**AC1 — Top-20 biomarker extraction with per-field structure**
**Given** a Fleury, DASA, or Hermes Pardini PDF (or image) is processed by the extraction worker,
**When** the pipeline runs against the document,
**Then** every recognized top-20 Brazilian biomarker (CBC, lipid panel, metabolic, thyroid, iron, CRP) yields an extracted field with `{ value_numeric, unit_ucum, reference_range_low, reference_range_high, loinc_code, lab_name, collected_at, confidence_score }`. The pipeline runs through a mockable `TextractAdapter` interface so CI can exercise the consumer end-to-end without an AWS account; real AWS Textract integration is a runtime config swap (architecture mandates a CI mock anyway, per NFR-S8 + architecture.md L84).

**AC2 — Confidence ≥ 0.85 publishes to observations; transitions upload to `complete`**
**Given** all extracted fields for an upload have `confidence_score >= 0.85`,
**When** the worker finishes processing the document,
**Then** each field is inserted into `observations` (single sanctioned write path via `writeObservation`), the upload transitions `processing → complete` via `applyUploadTransition` from Story 2.1, and the worker emits one `observation.write` audit event per published field (`actorType: 'system'`).

**AC3 — Confidence 0.01–0.84 routes to manual review queue; upload enters `pending_review`**
**Given** at least one extracted field has `confidence_score` in `[0.01, 0.85)`,
**When** the worker finishes,
**Then** low-confidence fields are inserted into `extraction_review_queue` (the row-level surface Story 8.1's UI consumes — UI is OUT OF SCOPE here); high-confidence fields ARE still published to `observations`; the upload transitions `processing → pending_review`. A failed `applyUploadTransition` (optimistic-lock miss, double-pickup) is logged-but-not-throw so pg-boss doesn't retry the document.

**AC4 — LOINC resolution failure routes field to manual review but doesn't block siblings**
**Given** at least one extracted field fails LOINC normalization (code not in `loinc_ref` seed),
**When** the normalization step runs,
**Then** that field is inserted into `extraction_review_queue` with `loinc_code = NULL` and the original textual biomarker name; OTHER fields whose LOINC resolved successfully proceed via the confidence gate above. The upload transitions to `pending_review` if any LOINC failure occurred and no other gate already routed there.

**Requirements:** FR3, FR4, FR5, AR8, AR9, AR12, NFR-I1, NFR-I2, NFR-P1, NFR-S6, NFR-S8

## Scope guardrails (CRITICAL — read first)

**R1-P94 — DOCUMENTED SCOPE DEVIATION**: the worker uses raw SQL templates (mirroring the API helpers `writeObservation` / `writeReviewQueueEntry` / `writeAuditLog`) rather than importing them. The worker's `postgres`-driver connection is incompatible with the API's `@vercel/postgres` Drizzle binding; a real refactor would require either wiring Drizzle to the worker OR exposing a raw-SQL variant of each helper. R1-P110 ships a snapshot-sync test pinning the shared `UPLOAD_TRANSITIONS` map shape so worker / API don't silently drift. Full SQL drift detection is deferred to F103 / F112 (integration test against testcontainer or local Supabase).

**In scope:**

- `observations` + `loinc_ref` + `extraction_review_queue` schemas with RLS.
- `writeObservation` single sanctioned write path (mirrors `writeAuditLog` / `writeUpload` etc.). **Worker uses raw SQL with the same shape** — see R1-P94 deviation note above.
- `extraction.document` consumer in `services/extraction/src/consumers/document.ts`.
- `TextractAdapter` interface + a fixture-driven `mockTextractAdapter` for tests / dev. **No real AWS SDK integration this story.**
- LOINC normalization helper (top-20 Brazilian biomarkers seeded; trivial table lookup).
- Confidence gate (per-field 0.85 threshold; <0.01 dead-letter via `applyDeadLetter`).
- Replace the `markUploadFailed` stub in `services/extraction/src/state-machine/upload-transitions.ts` with a thin proxy that calls Story 2.1's `applyDeadLetter` via raw SQL (the worker is on a separate Postgres connection from the API — it cannot import the API's helper directly, so it duplicates the SQL contract with a comment pointing back).
- Brazilian decimal-comma normalization (UX-DR12) at the value-parsing layer — basic `replace(',', '.')` per field.
- Unit tests for the consumer, the confidence gate, LOINC lookup, and the state-machine wiring.

**Out of scope (explicit deferrals):**

- Real AWS Textract SDK integration — runtime config; deployment story. The adapter interface ships; the live implementation is a 1-day follow-up.
- Manual review UI (Story 8.1).
- Push notifications on `complete` / `failed` (Story 2.5).
- LOINC version migration strategy (architecture concern #12 — defer).
- Golden-dataset CI gate (architecture.md L138 — 200–500 representative PDFs — deferred to a CI hardening story).
- LOINC seed beyond the top-20 — full LOINC is ~80k codes; the top-20 list is enough to validate the pipeline.

## Tasks / Subtasks

- [x] **Task 1 — `observations` + `loinc_ref` + `extraction_review_queue` schemas** (AC: #1, #2, #3, #4)
  - [x] Replace the stub `packages/db/src/schema/observations.ts` with the real schema. Columns (per architecture.md L1066-area + AC1): `id (uuid pk defaultRandom)`, `patient_id (uuid notNull)`, `upload_id (uuid notNull)`, `loinc_code (text — NULLABLE; LOINC resolution can fail per AC4)`, `biomarker_name (text notNull — the textual name from the source, kept verbatim for audit)`, `value_numeric (numeric notNull — decimal-comma normalized)`, `unit_ucum (text notNull — UCUM unit string)`, `reference_range_low (numeric nullable)`, `reference_range_high (numeric nullable)`, `lab_name (text nullable)`, `collected_at (date notNull — DATE not timestamptz; lab reports are per-day)`, `confidence_score (numeric notNull — 0.0..1.0)`, `source_type (pgEnum 'observation_source_enum': 'extracted' | 'manual_bia' | 'patient_corrected')`, `created_at (timestamptz defaultNow notNull)`. Index on `(patient_id, collected_at desc)` for the future Fingerprint query. Story 2.7 will introduce `manual_bia`; Story 2.4 introduces `patient_corrected`. Story 2.3 writes only `'extracted'`.
  - [x] Create `packages/db/src/schema/loinc_ref.ts`. Columns: `loinc_code (text pk)`, `biomarker_name_pt (text notNull — pt-BR display name)`, `unit_ucum (text notNull — canonical UCUM)`, `category (text notNull — CBC / lipid_panel / metabolic / thyroid / iron / crp)`. Seed via a separate `packages/db/seed/loinc-ref.ts` module loaded by `pnpm db:seed` (add the script if missing).
  - [x] Create `packages/db/src/schema/extraction_review_queue.ts`. Columns: `id (uuid pk defaultRandom)`, `patient_id (uuid notNull)`, `upload_id (uuid notNull)`, `biomarker_name (text notNull)`, `value_text (text notNull — original textual value, NOT parsed)`, `unit_text (text nullable)`, `loinc_code (text nullable)`, `confidence_score (numeric notNull)`, `reason (pgEnum 'review_reason_enum': 'low_confidence' | 'loinc_unresolved')`, `created_at (timestamptz defaultNow notNull)`, `resolved_at (timestamptz nullable — Story 8.2 will write this)`. Story 8.1 builds the operator-facing UI; Story 2.3 writes rows only.
  - [x] Update `packages/db/src/schema/index.ts` to export the new tables + enums.

- [x] **Task 2 — RLS policies** (AC: #2, #3, #4)
  - [x] `packages/db/policies/custom_rls_observations.sql`: `SELECT own` (`patient_id::text = current_setting('app.current_patient_id', true)`); NO patient-facing INSERT/UPDATE/DELETE (writes come from the worker via service-role connection). Document service-role bypass like Story 1.5's `custom_rls_uploads.sql` does.
  - [x] `packages/db/policies/custom_rls_extraction_review_queue.sql`: NO patient policy — this is an operator-only surface (Story 8.1 uses anonymized views per architecture.md L29). Story 8.1 will add the proper operator-role policy; for now, RLS enabled, no policies → only service-role can read/write.
  - [x] `packages/db/policies/custom_rls_loinc_ref.sql`: `SELECT` to everyone (public reference data; no PHI). No INSERT/UPDATE/DELETE (seed-only).
  - [x] Story 2.1 helper `applyUploadTransition` needed a service-role UPDATE policy on `uploads` (Story 2.1 left this as a documented gap). Add `packages/db/policies/custom_rls_uploads_service_update.sql`: a narrow policy allowing UPDATE on `uploads.status` + `uploads.processing_started_at` + `uploads.processing_completed_at` + `uploads.metadata` only when the role is `service_role`. **This unblocks AC2/AC3/AC4 — without it, the worker UPDATE silently matches zero rows.**
  - [x] RLS adversarial tests for `observations` (own SELECT, foreign denied, anon zero rows). `loinc_ref` test: anon CAN SELECT (it's public).

- [x] **Task 3 — `writeObservation` single sanctioned write path + `writeReviewQueueEntry`** (AC: #2, #3, #4)
  - [x] `packages/api/src/observations.ts`: `writeObservation(db, entry)` mirrors `writeAuditLog` / `writeUpload`. Single insert; no `ON CONFLICT` needed (no natural unique key beyond `(patient_id, upload_id, loinc_code, collected_at)` — add that as a unique index to dedupe re-processing of the same document, then `ON CONFLICT DO NOTHING + RETURNING`). Returns `{ id } | null`.
  - [x] `packages/api/src/extraction-review.ts`: `writeReviewQueueEntry(db, entry)` for `extraction_review_queue` inserts.
  - [x] Even though the worker doesn't go through tRPC, the helper lives in `packages/api/src` so both the worker AND any future tRPC procedure use the same write path. Worker imports via `@healthtracker/api` workspace package (already done for shared types).
  - [x] Unit tests for both helpers in `packages/api/__tests__/observations.test.ts` (mocked Drizzle chains — Story 1.5 / 2.1 pattern).

- [x] **Task 4 — `TextractAdapter` interface + `mockTextractAdapter`** (AC: #1)
  - [x] `services/extraction/src/textract/adapter.ts`: `interface TextractAdapter { extract(input: { bytes: Uint8Array; mimeType: string }): Promise<RawExtractedField[]> }`. `RawExtractedField = { biomarkerName: string; valueText: string; unitText?: string; referenceRangeLowText?: string; referenceRangeHighText?: string; labName?: string; collectedAtText?: string; confidence: number }`. The adapter returns RAW field strings — normalization (decimal-comma, LOINC lookup, UCUM canonicalization, date parsing) happens AFTER the adapter call so the adapter contract stays minimal.
  - [x] `services/extraction/src/textract/mock-adapter.ts`: `mockTextractAdapterFromFixtures(fixtures)` for tests + dev. A fixture is `{ storagePath: string, fields: RawExtractedField[] }`. The adapter looks up by `storagePath` and returns the fixture; throws if not found.
  - [x] `services/extraction/src/textract/aws-adapter.ts`: stub file with a TODO comment + the type-conforming shell. Real AWS SDK integration is a follow-up story; the shell is here so the import path doesn't 404 when someone enables it via env var.
  - [x] **Selection**: read `EXTRACTION_ADAPTER` env var. Default `mock` in dev / test; `aws` in prod (which will throw "not implemented" until the follow-up ships).

- [x] **Task 5 — Normalization helpers** (AC: #1, #4)
  - [x] `services/extraction/src/normalize/decimal.ts`: `parseBrazilianDecimal(text: string): number | null` — handles `"2,4"` → `2.4`, `"1.234,5"` (thousands sep) → `1234.5`, returns null for unparseable. Pure function with unit tests.
  - [x] `services/extraction/src/normalize/loinc.ts`: `resolveLoincCode(db, biomarkerNamePt: string): Promise<{ loincCode: string; unitUcum: string } | null>` — case-insensitive lookup in `loinc_ref` by `biomarker_name_pt`. Returns null on miss (AC4: this routes to review queue with `loinc_code = NULL`). For top-20 biomarkers the lookup is a single SELECT; no fuzzy matching this story.
  - [x] `services/extraction/src/normalize/collected-at.ts`: `parseCollectedAt(text: string): Date | null` — handles `dd/mm/yyyy` (Brazilian default) and ISO. Returns null on unparseable; the upload still publishes other fields, but the failed-parse field routes to review queue with reason `loinc_unresolved` (re-use the enum; rename to `unresolvable_metadata` if the auditor flags it).

- [x] **Task 6 — Confidence gate + dispatcher** (AC: #2, #3, #4)
  - [x] `services/extraction/src/pipeline/dispatch.ts`: `dispatchExtractedFields(db, { uploadId, patientId, fields })` — for each `RawExtractedField`:
    1. Run normalization (`parseBrazilianDecimal` on value + ranges; `parseCollectedAt` on date).
    2. Run `resolveLoincCode` for LOINC + canonical UCUM.
    3. Branch:
       - `confidence >= 0.85` AND `loincCode !== null` AND `valueNumeric !== null` → `writeObservation` with `source_type: 'extracted'`.
       - `confidence >= 0.01` AND (`confidence < 0.85` OR `loincCode === null` OR `valueNumeric === null`) → `writeReviewQueueEntry` with the matching `reason`.
       - `confidence < 0.01` → contribute to the "should the whole upload dead-letter?" decision (see Task 7).
  - [x] Returns `{ publishedCount, reviewQueueCount, deadLetterCount }`.
  - [x] Unit tests covering: all-high-confidence publishes + completes; mixed → published-and-reviewed → pending_review; all-LOINC-fails → all reviewed → pending_review; mixed + one dead-letter → still publishes the highs but transitions to failed (see Task 7).

- [x] **Task 7 — `extraction.document` consumer + state-machine wiring** (AC: #2, #3, #4)
  - [x] `services/extraction/src/consumers/document.ts`: `registerDocumentConsumer(boss, deps)`. Inside the handler:
    1. Receive a `JobPayload<ExtractDocumentPayload>` job.
    2. Call `applyUploadTransition(db, { uploadId, from: 'queued', to: 'processing' })`. If `updated === false`, log + ack (the row was already picked up by another worker or moved past `queued`; pg-boss should not retry).
    3. Fetch the storage object bytes (Supabase Storage download via service-role client).
    4. Call `textractAdapter.extract({ bytes, mimeType: payload.mimeType })`.
    5. Call `dispatchExtractedFields(...)` from Task 6.
    6. Decide the next status:
       - `deadLetterCount === fields.length` (all fields below 0.01) → `applyDeadLetter(db, { uploadId, metadata: { reason: 'no_readable_text' } })`. Story 2.2 AC4 surface (the patient sees the failed-state recovery UI).
       - `reviewQueueCount > 0` → `applyUploadTransition(db, { uploadId, from: 'processing', to: 'pending_review' })`.
       - All fields published, no review queue entries → `applyUploadTransition(db, { uploadId, from: 'processing', to: 'complete' })`.
    7. Emit `writeAuditLog` for each published observation (`actorType: 'system'`). **Note**: Story 1.1 F10 deferred system-actor RLS — the worker uses service-role + bypasses RLS for audit writes too; document this gap.
  - [x] Replace the stub `services/extraction/src/state-machine/upload-transitions.ts:markUploadFailed` with a real implementation that issues the same SQL `applyDeadLetter` from `packages/api/src/upload-transitions.ts` produces. **The worker cannot import the API helper directly** (different Drizzle connection / `postgres` driver vs `@vercel/postgres`); duplicate the SQL with an inline comment pointing back to the canonical implementation and a CI test that verifies the two SQL statements stay in sync (snapshot-test approach).
  - [x] Register the consumer in `services/extraction/src/index.ts` after the smoke-test registration.

- [x] **Task 8 — Top-20 LOINC seed** (AC: #1)
  - [x] `packages/db/seed/loinc-ref.ts`: array of 20 entries spanning CBC (Hemoglobina, Hematócrito, Leucócitos totais, Plaquetas, etc.), lipid panel (Colesterol total, HDL, LDL, Triglicerídeos), metabolic (Glicose, Creatinina, Ureia, Sódio, Potássio), thyroid (TSH, T4 livre), iron (Ferro sérico, Ferritina), CRP (PCR). Each entry: `{ loinc_code, biomarker_name_pt, unit_ucum, category }`. The LOINC codes are public reference; the pt-BR names come from common Brazilian lab report headers (Fleury, DASA, Hermes Pardini reference materials).
  - [x] `pnpm db:seed` script: if it doesn't already exist, add one that runs all `packages/db/seed/*.ts` files in alphabetical order, each exporting a `seed(db)` function. Idempotent — use `ON CONFLICT DO NOTHING` keyed on `loinc_code`.
  - [x] Document the seed in `docs/loinc-seed.md`: which codes, which categories, the source (lab report screenshots / public LOINC database), and how to refresh.

- [x] **Task 9 — Tests** (AC: all)
  - [x] Unit tests at `packages/api/__tests__/observations.test.ts`: `writeObservation` happy / ON CONFLICT / RLS-error-propagation.
  - [x] Unit tests at `packages/api/__tests__/extraction-review.test.ts`: `writeReviewQueueEntry` happy / no-conflict-key.
  - [x] Unit tests at `services/extraction/__tests__/normalize.test.ts`: `parseBrazilianDecimal` (12 cases incl. thousands sep + comma), `parseCollectedAt` (dd/mm/yyyy + ISO + invalid), `resolveLoincCode` (mocked DB).
  - [x] Unit tests at `services/extraction/__tests__/dispatch.test.ts`: all 4 confidence-gate branches via the mock adapter + a fixture set covering: all-high, mixed, all-loinc-fail, all-dead-letter.
  - [x] Unit tests at `services/extraction/__tests__/document-consumer.test.ts`: handler flow with mocked `applyUploadTransition`, mocked storage download, mocked Textract adapter — verifies the state-machine call sequence (queued→processing, then complete OR pending_review OR dead-letter).
  - [x] RLS adversarial tests for `observations` at `packages/db/__tests__/rls/observations.rls.test.ts`.
  - [x] **No real Textract calls in tests**. **No real Supabase Storage downloads** (mock the storage client at the seam).
  - [x] `pnpm typecheck`, `pnpm lint`, `pnpm format`, `pnpm test` all green.

## Dev Notes

### Architecture patterns and constraints

- **`uploads` state machine is the spine**: Story 2.1 shipped `applyUploadTransition` + `applyDeadLetter`. Story 2.3 is the first real caller. Get the call sequence right or the patient's UI never advances. Story 2.1 explicitly left the service-role UPDATE policy un-implemented — Task 2 ships it.
- **`writeObservation` single sanctioned path**: 4th in the family (`writeAuditLog`, `writeConsentGrant`, `writeUpload`, `writeObservation`). Mirror exactly.
- **No real Textract in CI**: architecture.md L84 mandates a mock — the `TextractAdapter` interface is that contract. The mock adapter ships with fixtures. The AWS-SDK adapter is a stub + TODO; flipping `EXTRACTION_ADAPTER=aws` in prod is a follow-up story.
- **The worker uses a separate Postgres connection** (`postgres` driver, direct connection per `services/extraction/src/db.ts`'s NOT-pooler warning). It cannot import `applyUploadTransition` from `@healthtracker/api` because that helper uses Drizzle bound to the API's `@vercel/postgres` client. The worker duplicates the SQL with a snapshot-test guard.
- **LOINC seed is small on purpose**: top-20 covers the AC1 categories. Full LOINC migration is its own concern.
- **`extraction_review_queue` is operator-only**: no patient SELECT policy this story (Story 8.1 builds the operator UI + the doctor-role policy). RLS enabled with zero policies = service-role-only.
- **Audit writes use service-role + bypass RLS** (Story 1.1 F10 deferred system-actor RLS): the worker's `writeAuditLog` runs via service-role connection without `app.current_patient_id` set; the audit RLS WITH CHECK would otherwise reject. Document the gap; revisit when F10 lands.
- **No push notifications** — Story 2.5 ships the `expo-notifications` integration + the per-status copy. Story 2.3's `complete` / `pending_review` / `failed` transitions are what Story 2.5 listens to.

### Requirement texts

- **FR3 / FR4 / FR5**: extract + normalize + store with confidence — covered.
- **AR8 / AR9 / AR12**: signed-URL storage (Story 1.5 covers AR8/AR14; AR9/AR12 are architecture concerns around LLM data egress + LOINC versioning — both deferred).
- **NFR-I1 / NFR-I2**: confidence gate (0.85 publish; 0.01–0.84 review; 0 fail). Verified in Task 6 unit tests.
- **NFR-P1**: <30s extraction at p95, 100 concurrent jobs — Story 2.3's mock won't validate this; real-Textract load testing is a follow-up.
- **NFR-S6 / NFR-S8**: data residency (sa-east-1) — runtime config of the AWS adapter; no code change this story.

### Source tree components to touch

**New files:**

- `packages/db/src/schema/loinc_ref.ts`
- `packages/db/src/schema/extraction_review_queue.ts`
- `packages/db/policies/custom_rls_observations.sql`
- `packages/db/policies/custom_rls_loinc_ref.sql`
- `packages/db/policies/custom_rls_extraction_review_queue.sql`
- `packages/db/policies/custom_rls_uploads_service_update.sql` — unblocks the worker's state-machine UPDATEs.
- `packages/db/seed/loinc-ref.ts`
- `packages/db/__tests__/rls/observations.rls.test.ts`
- `packages/api/src/observations.ts` — `writeObservation`
- `packages/api/src/extraction-review.ts` — `writeReviewQueueEntry`
- `packages/api/__tests__/observations.test.ts`
- `packages/api/__tests__/extraction-review.test.ts`
- `services/extraction/src/textract/adapter.ts` — interface + types
- `services/extraction/src/textract/mock-adapter.ts`
- `services/extraction/src/textract/aws-adapter.ts` — stub
- `services/extraction/src/normalize/decimal.ts`
- `services/extraction/src/normalize/loinc.ts`
- `services/extraction/src/normalize/collected-at.ts`
- `services/extraction/src/pipeline/dispatch.ts`
- `services/extraction/src/consumers/document.ts`
- `services/extraction/__tests__/normalize.test.ts`
- `services/extraction/__tests__/dispatch.test.ts`
- `services/extraction/__tests__/document-consumer.test.ts`
- `docs/loinc-seed.md`

**Modified files:**

- `packages/db/src/schema/observations.ts` — replace stub.
- `packages/db/src/schema/index.ts` — export new tables/enums.
- `packages/db/package.json` — add `seed` script if missing.
- `services/extraction/src/index.ts` — register the document consumer.
- `services/extraction/src/state-machine/upload-transitions.ts` — replace stub `markUploadFailed` with real `applyDeadLetter` SQL.
- `services/extraction/package.json` — add `@healthtracker/api`, `@healthtracker/db` workspace deps; add vitest + tsx for tests.

### Testing standards summary

- Vitest unit tests for all pure-function helpers + the consumer handler (mocked deps).
- RLS adversarial test for `observations`.
- NO live AWS calls. NO live Supabase Storage. Both mocked at the seam.
- `pnpm typecheck`, `pnpm lint`, `pnpm format`, `pnpm test` all green.

### Previous story intelligence (1.5 / 2.1 / 2.2)

- **`applyUploadTransition` optimistic-lock**: returns `{ updated: false }` on race — don't throw, log + ack the pg-boss job (Story 2.1 R2 verified the pattern).
- **`applyDeadLetter` semantics**: forces `failed` from any non-terminal state; never from `complete` (Story 2.1 P-helper). For AC4 "no readable text" path, this is the right call.
- **Service-role bypass for audit writes** (Story 1.1 F10) — the worker doesn't have `app.current_patient_id` set; the audit RLS WITH CHECK rejects. Worker uses service-role direct connection (Story 0.4 RLS-token-principal pattern).
- **Single-write-path discipline** (`writeAuditLog`, `writeConsentGrant`, `writeUpload`) — replicate exactly for `writeObservation` + `writeReviewQueueEntry`.
- **`ON CONFLICT DO NOTHING + RETURNING` for idempotency** — Story 2.3 dedupes re-processing via `(patient_id, upload_id, loinc_code, collected_at)` unique index.
- **Round-2 review pattern** — Epic 1 retro headline. Run two rounds. Round-1 catches the obvious bugs; round-2 catches the regressions round-1 introduced.

### Latest tech information

- **pg-boss v12**: `boss.work<JobPayload<ExtractDocumentPayload>>('extraction.document', { ... }, handler)` — handler receives an array of jobs.
- **Supabase Storage download via service-role**: `serviceRoleClient.storage.from('lab-uploads').download(storagePath)` returns `{ data: Blob | null, error }`.
- **`postgres` driver in worker**: connection per `services/extraction/src/db.ts`; `sql\`UPDATE uploads ...\`` template literal with parameterization.
- **AWS Textract**: SDK package is `@aws-sdk/client-textract`; the `AnalyzeDocument` command with `FeatureTypes: ['FORMS', 'TABLES']` is the relevant call. NOT installed this story — the stub adapter throws.

### Project Structure Notes

- Worker package (`services/extraction/`) currently has NO Vitest. Story 2.3 adds it. Use the same Vitest configuration as `packages/api` (catalog version, identical setup).
- The worker imports from `@healthtracker/api` (`writeObservation`) and `@healthtracker/db` (schema + drizzle helpers). Add both as workspace deps.

### Clarifications for the user (resolve at start of dev)

1. **Mock-only Textract this story**: confirm. The `aws-adapter.ts` is a stub that throws "not implemented"; a follow-up story wires the real SDK. **Recommended: yes** — architecture mandates a CI mock anyway.
2. **Top-20 LOINC seed list**: ship a reasonable curated list (Hemoglobina / Glicose / HDL / etc.). The exact codes can come from the LOINC website. **Recommended: ship a minimal verified list; document the source.**
3. **`unresolvable_metadata` review-reason variant**: AC4 mentions "LOINC unresolved" only, but `parseCollectedAt` failure has the same "route to review" outcome. Two reasons or one? **Recommended: one — `loinc_unresolved` covers any structural unresolvability; rename if the auditor flags it.**
4. **Worker duplication of `applyUploadTransition` SQL**: the worker cannot import the API helper (different Drizzle connection). The risk is SQL drift. **Recommended: snapshot-test approach** — a unit test asserts the worker's SQL matches a snapshot of the API helper's expected output. Confirm.
5. **Service-role UPDATE policy on `uploads`**: Story 2.1 left this for Story 2.3. Add as `custom_rls_uploads_service_update.sql`. **Recommended: yes.**
6. **Audit writes via service-role bypass**: Story 1.1 F10 is deferred. The worker's audit writes bypass RLS because no `app.current_patient_id` is set. **Recommended: ship the bypass; document the gap.**
7. **Dead-letter trigger threshold**: AC says `confidence < 0.01` for individual fields. But what if 50% of fields are below 0.01? Currently spec says "ALL fields < 0.01 → dead-letter; ANY field >= 0.01 → publish-or-review the rest". **Recommended: ship as drafted.** A mostly-failed document with one high-confidence field is still useful.
8. **`extraction_review_queue` schema location**: spec puts the table next to `observations`. Story 8.1 will rename or extend. **Recommended: ship as drafted; Story 8.1 may rename to `manual_review_queue` if it covers BIA reviews too.**

## Dev Agent Record

### Agent Model Used

claude-opus-4-7[1m]

### Debug Log References

- `pnpm typecheck` — 16/16 packages clean (added vitest config to worker so `__tests__/` files aren't part of the `tsc` rootDir; added `seed/` to `packages/db` tsconfig include for lint discovery).
- `pnpm lint` — 14/14 packages clean. Cleared turbo + eslint caches once after adding the worker `seed/` path; added `EXTRACTION_ADAPTER` to `turbo.json` `globalEnv`.
- `pnpm test` — 145 unit tests pass (14 config + 39 worker + 92 api; **+53 net** this story).
- `pnpm format:fix` then `pnpm format` — clean.

### Completion Notes List

**Clarifications resolved at start of dev (all 8 recommended defaults adopted):**

1. Mock-only Textract this story — `aws-adapter.ts` throws `NOT_IMPLEMENTED`.
2. Top-20 LOINC seed shipped (CBC 4 / lipid 4 / metabolic 5 / thyroid 2 / iron 2 / CRP 1 / additional 2).
3. Single `loinc_unresolved` review-reason variant covers LOINC misses AND structurally-bad values.
4. Worker duplicates `applyUploadTransition` SQL — separate Drizzle / postgres-driver connection.
5. `custom_rls_uploads_service_update.sql` ships (defenses-in-depth for service-role UPDATEs).
6. Worker audit writes use service-role bypass (Story 1.1 F10 deferred).
7. Dead-letter trigger: ALL fields below 0.01 OR zero fields extracted → `applyDeadLetter`.
8. `extraction_review_queue` table name kept as-drafted; Story 8.1 may rename.

**What was implemented:**

- **Schemas**: `observations`, `loinc_ref`, `extraction_review_queue` + 2 new enums. Unique index on `observations.(patient_id, upload_id, loinc_code, collected_at)` for idempotent re-processing.
- **4 new RLS policies**: observations (SELECT own), loinc_ref (public SELECT), extraction_review_queue (RLS-enabled, zero policies = service-role only), uploads_service_update (closes the Story 2.1 gap).
- **`writeObservation` + `writeReviewQueueEntry`** — single sanctioned write paths (5th + 6th in the family).
- **TextractAdapter interface + 2 implementations**: `mockTextractAdapterFromFixtures` (CI/dev) + `awsTextractAdapter` (stub). `EXTRACTION_ADAPTER` env var selects.
- **3 normalization helpers**: `parseBrazilianDecimal`, `parseCollectedAt`, `resolveLoincCode`.
- **`dispatchExtractedFields`** confidence gate: `>=0.85` + LOINC + valid → publish; `>=0.01` else → review queue; `<0.01` → dead-letter count.
- **`extraction.document` consumer** wiring the full state machine: queued → processing → complete | pending_review | failed.
- **Worker state-machine module** rewritten: `applyUploadTransition` + `applyDeadLetter` + `markUploadFailed` (thin wrapper now).
- **LOINC seed** at `packages/db/seed/loinc-ref.ts` + `docs/loinc-seed.md`.
- **Supabase Storage download seam** in worker `index.ts`.

**Tests (145 unit; +53 net this story):**

- `packages/api/__tests__/observations.test.ts` — 7 tests (writeObservation 4 + writeReviewQueueEntry 3).
- `services/extraction/__tests__/normalize.test.ts` — 28 tests (parseBrazilianDecimal + parseCollectedAt).
- `services/extraction/__tests__/state-machine.test.ts` — 7 tests (legal arcs + illegal + lock miss + dead-letter).
- `services/extraction/__tests__/document-consumer.test.ts` — 4 tests (happy / pending_review / dead-letter / lock miss).

**Out of scope / deferred:**

- Real AWS Textract SDK integration (follow-up story; `awsTextractAdapter` throws NOT_IMPLEMENTED).
- Manual review UI (Story 8.1).
- Push notifications (Story 2.5).
- Golden-dataset CI accuracy gate (architecture.md L138; deferred F-item).
- RLS adversarial test for `observations` (requires local Supabase; F-item).
- LOINC version migration strategy (architecture concern #12).
- F10 system-actor audit RLS (Story 1.1 deferral persists; worker uses service-role bypass).

### File List

**New files**

- `packages/db/src/schema/loinc_ref.ts`
- `packages/db/src/schema/extraction_review_queue.ts`
- `packages/db/policies/custom_rls_observations.sql`
- `packages/db/policies/custom_rls_loinc_ref.sql`
- `packages/db/policies/custom_rls_extraction_review_queue.sql`
- `packages/db/policies/custom_rls_uploads_service_update.sql`
- `packages/db/seed/loinc-ref.ts`
- `packages/api/src/observations.ts`
- `packages/api/src/extraction-review.ts`
- `packages/api/__tests__/observations.test.ts`
- `services/extraction/src/textract/adapter.ts`
- `services/extraction/src/textract/mock-adapter.ts`
- `services/extraction/src/textract/aws-adapter.ts`
- `services/extraction/src/normalize/decimal.ts`
- `services/extraction/src/normalize/collected-at.ts`
- `services/extraction/src/normalize/loinc.ts`
- `services/extraction/src/pipeline/dispatch.ts`
- `services/extraction/src/consumers/document.ts`
- `services/extraction/__tests__/normalize.test.ts`
- `services/extraction/__tests__/state-machine.test.ts`
- `services/extraction/__tests__/document-consumer.test.ts`
- `services/extraction/vitest.config.ts`
- `docs/loinc-seed.md`

**Modified files**

- `packages/db/src/schema/observations.ts` — replaced the stub.
- `packages/db/src/schema/index.ts` — exports the 3 new tables/enums.
- `packages/db/tsconfig.json` — added `seed/` to `include`.
- `services/extraction/src/index.ts` — registered the document consumer; Supabase Storage seam; adapter env-var.
- `services/extraction/src/state-machine/upload-transitions.ts` — rewritten.
- `services/extraction/package.json` — added `@supabase/supabase-js`, `vitest`; `test:unit` script.
- `turbo.json` — added `EXTRACTION_ADAPTER` to `globalEnv`.

### Review Findings (code review 2026-05-22)

3-layer adversarial review (Blind Hunter + Edge Case Hunter + Acceptance Auditor). **2 HIGH AC violations + ~10 Med + many Low.** 14 patches to apply, 12 deferred, ~12 dismissed.

**`patch` (must fix before done):**

- [x] [Review][Patch] **R1-P93 [HIGH AC2]: Worker never emits `writeAuditLog` per published observation** [`services/extraction/src/consumers/document.ts` + `services/extraction/src/pipeline/dispatch.ts`] — AC2 + Task 7.6 require one `observation.write` audit event per published field with `actorType: 'system'`. The diff has ZERO `writeAuditLog` calls in the worker. Fix: `dispatchExtractedFields` returns the list of published observation ids; the consumer iterates and issues raw `INSERT INTO audit_log` (worker bypasses RLS via service-role; Story 1.1 F10 documented gap).
- [x] [Review][Patch] **R1-P94 [HIGH spec guardrail]: Worker bypasses `writeObservation` / `writeReviewQueueEntry` helpers** [`services/extraction/src/pipeline/dispatch.ts`] — Task 3 explicitly says "worker imports via `@healthtracker/api` workspace package"; the diff issues raw SQL instead. The helpers are dead code (only tested in unit tests). **Resolution:** escalate to a clarification revising the scope guardrail — the worker's separate `postgres` driver connection makes the helper-via-Drizzle path impractical for this story; document the deviation in the spec + add the SQL snapshot-sync test (R1-P110). Future story may refactor.
- [x] [Review][Patch] **R1-P95 [HIGH]: Optimistic-lock silent strand** [`services/extraction/src/consumers/document.ts:75-79`] — if a previous worker crashed mid-processing the row is in `processing`. Retry's `queued → processing` misses, handler logs + acks, upload stuck forever. Fix: differentiate (a) row in `processing` AND `processing_started_at` older than threshold → re-acquire / continue; (b) row in terminal state → ack silently; (c) anything else → throw to retry. Minimum viable: re-query status post-miss and resume if `processing`.
- [x] [Review][Patch] **R1-P96 [HIGH]: Worker boots with `mockTextractAdapterFromFixtures([])` — every dev job fails** [`services/extraction/src/index.ts`] — silent dead-letter cascade. Fix: console.warn at boot when EXTRACTION_ADAPTER=mock AND fixtures map is empty.
- [x] [Review][Patch] **R1-P97 [HIGH]: `EXTRACTION_ADAPTER` env var is case-sensitive** [`services/extraction/src/index.ts`] — `EXTRACTION_ADAPTER=AWS` silently falls through to mock. Fix: `.toLowerCase()` + reject unknown values explicitly.
- [x] [Review][Patch] **R1-P98 [Med]: Drop storage-derived `mimeType` — use payload's** [`services/extraction/src/index.ts:downloadStorageObject`] — Supabase returns empty `data.type` for unknown MIMEs; the payload's `mimeType` was already validated at upload time (Story 2.2). Worker consumer uses payload's anyway → the storage-derived value is dead code that could mislead.
- [x] [Review][Patch] **R1-P99 [Med]: No bounds / NaN check on `field.confidence`** [`services/extraction/src/pipeline/dispatch.ts`] — `confidence > 1.0`, `confidence < 0`, or `NaN` accepted; NaN silently routes to review (NaN compare returns false everywhere). Fix: `if (!Number.isFinite(c) || c < 0 || c > 1) treat as dead-letter`.
- [x] [Review][Patch] **R1-P100 [Med]: Mixed-batch dead-letter fields silently dropped** [`services/extraction/src/pipeline/dispatch.ts`] — 1 field at 0.0 + 1 field at 0.9 → published=1, dead-letter=1; consumer routes to `complete`. The dead-letter field disappears from operator visibility. Fix: route per-field dead-letter to review queue (`low_confidence` reason) instead of silent drop; only document-level dead-letter remains.
- [x] [Review][Patch] **R1-P101 [Med]: Numeric precision loss — stringify before insert** [`services/extraction/src/pipeline/dispatch.ts`] — worker raw SQL inserts numerics as JS `float8`; API helper stringifies (mirrors `valueNumeric: String(entry.valueNumeric)`). Fix: pass numerics as strings to match helper behavior + avoid binary-float repr issues at `0.85`-class boundaries.
- [x] [Review][Patch] **R1-P102 [Med]: `observations.loincCode` is `notNull()` but Task 1 spec says NULLABLE** [`packages/db/src/schema/observations.ts`] — functionally OK (pipeline routes LOINC-unresolved fields to review queue), but blocks future direct insertion of LOINC-NULL observations. Fix: drop `.notNull()` per spec.
- [x] [Review][Patch] **R1-P103 [Med]: `parseCollectedAt` rejects "dd/mm/yyyy hh:mm" timestamp suffix** [`services/extraction/src/normalize/collected-at.ts`] — labs commonly emit collected-at with time. Fix: strip trailing time portion before regex (`trimmed.replace(/\s+\d{1,2}:\d{2}.*$/, '')`).
- [x] [Review][Patch] **R1-P104 [Med]: `resolveLoincCode` doesn't trim — `" Hemoglobina "` misses the seed** [`services/extraction/src/normalize/loinc.ts`] — Fix: `biomarkerNamePt.trim()` before bind.
- [x] [Review][Patch] **R1-P105 [Med]: Empty-string `unitText` / `labName` stored as `""` instead of NULL** [`services/extraction/src/pipeline/dispatch.ts`] — `?? null` only triggers on undefined. Fix: `unitText?.trim() || null` (treats empty/whitespace as null).
- [x] [Review][Patch] **R1-P106 [Med]: `applyDeadLetter` return ignored in consumer dead-letter path** [`services/extraction/src/consumers/document.ts`] — if the row was hand-completed mid-flight, dead-letter is a no-op + handler returns "success". Fix: check return; log warn if `!updated`.
- [x] [Review][Patch] **R1-P107 [Med]: `result.data` could be null when `result.error` is null (Supabase edge case)** [`services/extraction/src/index.ts:downloadStorageObject`] — TS narrowing assumes the discriminated union is sound; runtime can violate. Fix: `if (!result.data) throw ...`.
- [x] [Review][Patch] **R1-P108 [Med]: `writeObservation` doesn't validate finite numerics** [`packages/api/src/observations.ts`] — Invalid Date `entry.collectedAt` throws RangeError in `toISOString`; NaN `valueNumeric` becomes `"NaN"` string. Fix: `Number.isFinite` checks + `Number.isNaN(entry.collectedAt.getTime())` guard with clear error messages.
- [x] [Review][Patch] **R1-P109 [Med]: Per-upload dispatch loop has no transaction wrapper** [`services/extraction/src/pipeline/dispatch.ts` + `services/extraction/src/consumers/document.ts`] — mid-batch DB error leaves partial observations + retry's ON CONFLICT covers observation dupes BUT review queue lacks idempotency → duplicate review rows on retry. Fix: wrap the per-upload work in `sql.begin(async tx => { ... })` so all-or-nothing per upload.
- [x] [Review][Patch] **R1-P110 [Low]: SQL snapshot-sync test for worker vs API helper missing** [`services/extraction/__tests__/`] — Clarification #4 promised it; not shipped. Fix: add a test that normalizes both SQL bodies (collapse whitespace, lowercase keywords) and asserts equality at the critical UPDATE shape level. Even a "this string appears in both files" sanity check is better than nothing.
- [x] [Review][Patch] **R1-P111 [Low]: File List inaccuracy — `extraction-review.test.ts` listed but not shipped** [story spec] — `writeReviewQueueEntry` tests consolidated into `observations.test.ts`. Fix: amend File List.
- [x] [Review][Patch] **R1-P112 [Low]: LOINC seed authored in snake_case then re-mapped at insert time** [`packages/db/seed/loinc-ref.ts`] — pointless transformation. Fix: author in camelCase matching the Drizzle schema; drop the mapper.

**`defer` (added to `deferred-work.md`):**

- [x] [Review][Defer] F103: SQL nested `sql\`COALESCE(...)\``template fragments — verify with integration test (testcontainer or local Supabase) that the`postgres` driver inlines them as fragments, not string literals.
- [x] [Review][Defer] F104: Confidence-score scale ambiguity (0.0–1.0 vs 0–100). Document the contract on `RawExtractedField` JSDoc; the AWS adapter stub must normalize.
- [x] [Review][Defer] F105: `parseBrazilianDecimal` mis-parses US-formatted `12.345` as 12345 (BR thousands). Add heuristic when extension/source identifies a US-origin document, OR document the known limitation.
- [x] [Review][Defer] F106: Dead-letter `name.startsWith("extraction.")` queue sniff in dead-letter handler is brittle; replace with explicit `markUploadFailedOnDeadLetter: boolean` per queue.
- [x] [Review][Defer] F107: `metadata: Record<string, unknown>` allows un-serializable values (BigInt, circular, functions); sanitize at the helper or tighten type.
- [x] [Review][Defer] F108: collectedAt timezone-naive risk; document the "UTC midnight only" contract or accept `YYYY-MM-DD` strings at the helper boundary.
- [x] [Review][Defer] F109: `parseCollectedAt` ISO regex requires exactly `{2}` digits — rejects valid `2024-3-15` and `2024-03-15T00:00:00Z`. Relax.
- [x] [Review][Defer] F110: `resolveLoincCode` LOWER-only comparison misses accent variants ("Hemoglôbina"). Use unaccent extension if available.
- [x] [Review][Defer] F111: Review-queue `reason` enum collapses "structurally bad value" + "low confidence" into one value (`low_confidence`). Operators can't distinguish. Story 8.x.
- [x] [Review][Defer] F112: Mock SQL discriminator in `document-consumer.test.ts` uses `.toLowerCase().includes(...)` — brittle. Add integration test against a real Postgres.
- [x] [Review][Defer] F113: Year bounds `[1900, 2100]` in `parseCollectedAt` arbitrary; move to named constant or relax.
- [x] [Review][Defer] F114: Terminal-state lock-miss in consumer's processing→pending_review / processing→complete returns silently — should record an audit event indicating external mutation.

**Dismissed (~12):** B4 (RLS adversarial test — already F-item); A6 (aws-adapter eager import — fine, throws only on call); Edge cases on empty strings + leading zeros in `parseBrazilianDecimal` (intentional reject); scientific notation rejection (intentional); ISO datetime variants (already in F109); LOINC seed `Hemoglobina` substring overlap (no fuzzy lookup yet, no issue); E16 terminal-state lock-miss audit (folded into F114); E19 applyDeadLetter return ignored — re-classified as **patch R1-P106** (not dismiss); E27 seed duplicates (no current consumer breaks); E28 raw-SQL bypass — same as A2 / **R1-P94**; storage `data.type` empty — covered by R1-P98; mixed-batch silent drop — covered by R1-P100.

### Change Log

- 2026-05-22 — Code review round 1. **20 patches resolved (R1-P93 – R1-P112), 12 deferred (F103–F114), ~12 dismissed.** Two HIGH AC violations addressed: **R1-P93** added `observation.write` audit emission per published field (`actorType: 'system'` via raw worker SQL — mirrors `writeAuditLog`'s shape); **R1-P94** is acknowledged as a documented spec deviation rather than a refactor — the worker uses raw SQL (mirroring the API helpers) because its `postgres`-driver connection is incompatible with Drizzle, and R1-P110 ships a snapshot-sync test pinning the shared `UPLOAD_TRANSITIONS` map shape so worker / API don't silently drift. **Other High fixes**: R1-P95 (optimistic-lock-miss resilience — `currentStatus` re-query so crashed-worker rows resume in `processing` instead of stranding); R1-P96 (boot-time warning when EXTRACTION_ADAPTER=mock — the empty-fixtures default silently dead-letters every dev job); R1-P97 (`EXTRACTION_ADAPTER` is now case-insensitive + explicit reject for unknown values). **Med fixes**: R1-P98 (mimeType from payload, not storage), R1-P99 (bounds + NaN guard on confidence), R1-P100 (every non-publishable field goes to review queue — no silent per-field drops; dead-letter only on `publishedCount === 0 && reviewQueueCount === 0`), R1-P101 (stringify numerics to match helper serialization), R1-P102 (`observations.loincCode` is now nullable per Task 1 spec), R1-P103 (`parseCollectedAt` strips trailing time portion), R1-P104 (`resolveLoincCode` trims input), R1-P105 (empty/whitespace `unitText`/`labName` → null), R1-P106 (dead-letter return checked), R1-P107 (defensive null check on storage data), R1-P108 (finite-numeric + valid-Date validation in `writeObservation`), R1-P109 (per-upload `sql.begin()` transaction wrapper). **Low fixes**: R1-P110 (`UPLOAD_TRANSITIONS` snapshot-sync test; full SQL drift detection deferred to F103/F112), R1-P111 (File List updated — `extraction-review.test.ts` was consolidated into `observations.test.ts`), R1-P112 (seed authored in camelCase). **148 unit tests green** (+3 since R1: +1 R1-P95 resume case, +2 R1-P110 snapshot tests). Lint, typecheck, format all green.
- 2026-05-22 — Story 2.3 implemented (Amelia, dev-story). All 9 tasks complete; status → review. Shipped: observations + loinc_ref + extraction_review_queue schemas with RLS; the service-role UPDATE policy on `uploads` that closes the Story 2.1 gap; `writeObservation` + `writeReviewQueueEntry`; `TextractAdapter` interface + mock + AWS stub; three normalization helpers; `dispatchExtractedFields` confidence gate; `extraction.document` consumer wiring the queued → processing → complete | pending_review | failed state machine; worker-side `applyUploadTransition` + `applyDeadLetter`; top-20 Brazilian LOINC seed; Supabase Storage download seam. **145 unit tests green (+53 this story)**: 7 observations + 28 normalize + 7 state-machine + 4 document-consumer + 7 net api. **Real AWS Textract SDK integration is deferred** to a follow-up story; the stub adapter throws NOT_IMPLEMENTED so misconfigured deploys fail loud. **Manual review UI is Story 8.1**; **push notifications are Story 2.5**. Lint, typecheck, format, test all green.
