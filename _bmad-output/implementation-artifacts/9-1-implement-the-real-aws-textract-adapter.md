# Story 9.1: Implement the real AWS Textract adapter

Status: done

<!-- FIRST story of Epic 9 (Real AWS Textract Extraction Backend). Per Francis's 2026-06-02 decision, Epic 9 is developed on the EXISTING Epic 8 worktree/PR branch (`worktree-story-8-1-operator-review-queue`) — one PR will contain Epic 8 + Epic 9. This crosses an epic boundary deliberately; it does NOT stack on Epic 8 functionally (unrelated surface). -->
<!-- Epic 9 introduces NO net-new DB schema (Textract output flows through the existing RawExtractedField → dispatchExtractedFields → observations/review-queue path), so there is intentionally NO "author incremental migration" story in Epic 9. -->
<!-- SCOPE FENCE — 9.1 implements ONLY the adapter + mapping + fixture tests. It does NOT: (a) gate AWS creds / pin region / fail-loud at boot → Story 9.2; (b) wrap the consumer `extract()` failure path → Story 9.3; (c) re-enqueue stub-era failed uploads → Story 9.4. Do not pull those forward. -->

## Story

As a **platform engineer**,
I want **`awsTextractAdapter.extract()` to call AWS Textract `AnalyzeDocument` (`FeatureTypes: ['FORMS','TABLES']`) and map the response into `RawExtractedField[]`**,
so that **uploaded lab PDFs/images produce biomarker fields in production instead of throwing `NOT_IMPLEMENTED` — flowing through the existing dispatch → observations/review-queue pipeline unchanged**.

## Context: what exists today (read before writing)

- **The adapter contract is fixed** (`services/extraction/src/textract/adapter.ts`): `extract({ bytes, mimeType, storagePath }) => Promise<RawExtractedField[]>`. `RawExtractedField` = `{ biomarkerName, valueText, unitText?, referenceRangeLowText?, referenceRangeHighText?, labName?, collectedAtText?, confidence }`. **The adapter returns RAW strings** — `valueText` keeps the Brazilian decimal comma (`14,2`); LOINC lookup, decimal parsing, UCUM canonicalisation, and date parsing ALL happen downstream in `dispatchExtractedFields`. The adapter does NOT normalise values; it only extracts text + confidence.
- **`confidence` MUST be in `[0.0, 1.0]`.** Textract block `Confidence` is `0–100`; the adapter divides by 100. The downstream gate (`dispatch.ts:39` `CONFIDENCE_THRESHOLD = 0.85`) treats `< 0.85` as `low_confidence` → review queue. `dispatch.ts:107` already guards non-finite/out-of-range confidence (`effectiveConfidence = confidenceOk ? field.confidence : 0`), but the adapter must still emit a clean `0–1` float so a legitimately-low Textract confidence (e.g. `62.0 → 0.62`) routes to review correctly (AC4's low-confidence assertion).
- **The stub being replaced** (`services/extraction/src/textract/aws-adapter.ts`): currently `extract()` returns `Promise.reject(NOT_IMPLEMENTED)`. Adapter selection is in `services/extraction/src/index.ts:53` — `EXTRACTION_ADAPTER === 'aws' ? awsTextractAdapter : mockTextractAdapterFromFixtures(...)`. **9.1 only changes the `aws` branch's implementation; it does NOT change selection logic, and the mock stays the CI/dev adapter (NFR-S8 — no live AWS in CI).**
- **The worker is ESM** (`"type": "module"`, `NodeNext`, `tsx` runtime). **All relative imports MUST use `.js` extensions** (the deploy constraint fixed in #70/#71). `@aws-sdk/client-textract` is a package import (no `.js`). No `dist` build — `tsx` runs `.ts` directly in prod.
- **Tests:** vitest, `services/extraction/__tests__/**/*.test.ts`, run via `pnpm --filter @healthtracker/extraction-worker test:unit`. No JSON fixtures exist yet; existing tests use inline `RawExtractedField` objects. 9.1 adds the FIRST recorded Textract `AnalyzeDocument` JSON fixture.

## Acceptance Criteria

> AC1–AC4 are lifted verbatim from `_bmad-output/planning-artifacts/epics.md` L1879–1897 (Story 9.1). AC5–AC8 are implementation-contract ACs locking the mapping shape, the scope fence, and the test matrix.

1. **AC1 — `extract()` calls Textract `AnalyzeDocument` and returns the contract shape.**
   **Given** `EXTRACTION_ADAPTER=aws` and a valid lab-document byte payload,
   **When** `extract({ bytes, mimeType, storagePath })` runs,
   **Then** it calls Textract `AnalyzeDocument` with `Document: { Bytes }` and `FeatureTypes: ['FORMS','TABLES']`, and returns `RawExtractedField[]` with `biomarkerName`, `valueText`, `unitText`, and `confidence` populated — matching the contract `dispatchExtractedFields` consumes from the mock adapter. (`bytes` is the in-memory document; Textract `AnalyzeDocument` takes synchronous `Bytes` ≤ 10 MB / 1 page for PDF — see AC7's documented limitation.)

2. **AC2 — KEY_VALUE_SET + TABLE block mapping; confidence normalised; decimals preserved.**
   **Given** a Textract response containing `KEY_VALUE_SET` (FORMS) and `TABLE`/`CELL` (TABLES) blocks,
   **When** the response is mapped,
   **Then** each emitted field's `confidence` is the source Textract block `Confidence` divided by 100 (clamped to `[0,1]`), and Brazilian decimal separators (`14,2`) in `valueText` are passed through **unchanged** (no parsing in the adapter). Block text is reconstructed from `CHILD` relationships to `WORD`/`SELECTION_ELEMENT` blocks via the block-id map.

3. **AC3 — Dependency added, no ESM regression, typecheck green.**
   **Given** `@aws-sdk/client-textract` is added to `services/extraction` `dependencies`,
   **When** the worker builds and boots under `tsx`,
   **Then** there is no ESM `.js`→`.ts` resolution regression (relative imports keep `.js`; the SDK is a bare package import) and `pnpm -w typecheck` passes.

4. **AC4 — Fixture-driven, field-by-field mapping tests (no live AWS in CI).**
   **Given** a recorded Textract `AnalyzeDocument` JSON fixture (NFR-S8 — no live AWS call in CI),
   **When** the mapping unit tests run,
   **Then** the `RawExtractedField[]` output is asserted **field-by-field**, and the matrix includes: (a) a FORMS key/value pair, (b) a **multi-table** report (≥2 `TABLE` blocks), and (c) a **low-confidence field** (Textract `Confidence < 85` → normalised `< 0.85`) that the test asserts would route to the review queue (assert `confidence < CONFIDENCE_GATE_THRESHOLD`; optionally feed it through `dispatchExtractedFields` against a testcontainer if available, else assert the float boundary directly).

5. **AC5 — Mapping module is pure + unit-testable; client construction is isolated.**
   **Given** testability and the scope fence,
   **Then** the Textract-response→`RawExtractedField[]` mapping lives in a **pure function** (e.g. `mapAnalyzeDocumentResponse(response): RawExtractedField[]` in a new `services/extraction/src/textract/aws-mapping.ts`) that takes a parsed `AnalyzeDocumentCommandOutput` and returns the fields — **no SDK client, no network, no env** inside it (so the fixture tests call it directly). `aws-adapter.ts` owns ONLY: construct the `TextractClient`, send `AnalyzeDocumentCommand`, and delegate to `mapAnalyzeDocumentResponse`. The client is constructed lazily (module-level or first-call memo) reading `AWS_REGION` (default `sa-east-1` for now) and the default SDK credential chain — **the fail-loud boot gate + strict region pin is Story 9.2, NOT here.** Add a one-line comment marking that seam.

6. **AC6 — Heuristic biomarker extraction documented + bounded.**
   **Given** lab-report layouts vary and Textract FORMS/TABLES output is heuristic,
   **Then** the mapping documents its extraction heuristics inline: (a) **FORMS** — each `KEY_VALUE_SET` with `EntityTypes` containing `KEY` yields `biomarkerName` = key text; the linked `VALUE` block's text is split into `valueText` (leading numeric/`,`/`.` token) + `unitText` (trailing remainder) by a documented rule; (b) **TABLES** — a `TABLE` whose header row contains a value-like column is parsed row-wise (first cell = `biomarkerName`, a numeric cell = `valueText`, an adjacent non-numeric cell = `unitText`); rows with no numeric value are skipped. `labName` / `collectedAtText` / reference-range extraction MAY be left `undefined` in 9.1 if not trivially present (the review-queue/observation paths already tolerate nulls) — but if a FORMS key clearly matches lab/date, populate it. **Document every heuristic + its limitation** so a reviewer (and Story 9.x follow-ups) can see the boundaries. Over-fitting to one lab's layout is a non-goal; correctness on the fixture matrix is the bar.

7. **AC7 — Scope fence + documented limitations.**
   **Given** the Epic 9 story split,
   **Then** 9.1 ships ONLY: the dep, `aws-mapping.ts`, the rewritten `aws-adapter.ts`, the fixture(s) + tests, and docs. It does **NOT** add the boot-time cred/region gate (9.2), does **NOT** touch `consumers/document.ts` (9.3), does **NOT** re-enqueue failed uploads (9.4). Documented limitations called out in code + Dev Notes: synchronous `AnalyzeDocument` `Bytes` is single-page / ≤10 MB (multi-page async `StartDocumentAnalysis` is out of scope — note it); region/creds are unvalidated until 9.2 (so a misconfigured `EXTRACTION_ADAPTER=aws` deploy throws at first dispatch, same blast radius as today's stub — acceptable until 9.2).

8. **AC8 — Quality gates + no CI behaviour change.**
   **Then** `pnpm -w typecheck`, `pnpm -w lint`, `pnpm -w format` are green; `pnpm --filter @healthtracker/extraction-worker test:unit` passes (existing + new mapping tests); and **CI adapter selection is unchanged** — CI/dev still use `mockTextractAdapterFromFixtures` (the `aws` branch is prod-only). No live AWS call in any test.

**Requirements traceability:** FR1 (extract biomarkers from uploads), FR2 (normalise — the adapter feeds the existing normaliser), FR3 (confidence gate — adapter emits the `0–1` confidence the gate consumes), NFR-S8 (data residency / no live AWS in CI — mock stays the CI adapter; region default `sa-east-1` pending 9.2's hard pin).

---

## Tasks / Subtasks

- [x] **Task 1 — Add the AWS SDK dependency (AC3)**
  - [x] 1.1 `pnpm --filter @healthtracker/extraction-worker add @aws-sdk/client-textract` (a recent v3 — record the resolved version in the File List). It is a runtime dep (`dependencies`, not `dev`). If the worktree is offline and the add fails, HALT and report — this is the critical path (the rest of the story compiles against the SDK types).
  - [x] 1.2 Confirm `services/extraction/package.json` lists `@aws-sdk/client-textract` and `pnpm install` resolves cleanly. Confirm no `.js`-extension lint/TS error from the new import (bare package import — no extension needed).

- [x] **Task 2 — Pure mapping module `aws-mapping.ts` (AC2, AC5, AC6)**
  - [x] 2.1 Create `services/extraction/src/textract/aws-mapping.ts` exporting `mapAnalyzeDocumentResponse(response: AnalyzeDocumentCommandOutput): RawExtractedField[]`. Import the `RawExtractedField` type from `./adapter.js`. NO client, NO env, NO network — pure.
  - [x] 2.2 Build a `Map<string, Block>` over `response.Blocks` keyed by `Block.Id`. Implement a `blockText(block)` helper that walks `Relationships` of type `CHILD` → `WORD` (use `.Text`) + `SELECTION_ELEMENT` (status), joining with spaces.
  - [x] 2.3 **FORMS:** for each `KEY_VALUE_SET` block with `EntityTypes` including `'KEY'`, get key text; follow the `VALUE`-type relationship to the value block, get its text; split value text into `valueText` (leading numeric token incl. `,`/`.`) + `unitText` (remainder). Confidence = the value block's `Confidence`/100 (clamp `[0,1]`). Skip if key or value text is empty or value has no numeric token.
  - [x] 2.4 **TABLES:** for each `TABLE` block, collect `CELL` blocks (via `CHILD` relationships), index by `(RowIndex, ColumnIndex)`. Treat row 1 as header; identify a "value" column heuristically (header text matches `/result|valor|resultado/i`, or the first column whose body rows are numeric). Per data row: `biomarkerName` = column-1 cell text, `valueText` = value-column numeric token, `unitText` = adjacent unit column if present. Confidence = the value cell's `Confidence`/100. Skip rows with no numeric value. Handle ≥2 tables (AC4 multi-table).
  - [x] 2.5 Document each heuristic + its limitation in JSDoc/inline comments (AC6). De-duplicate: if FORMS and TABLES both yield the same biomarker, prefer the higher-confidence one (document the tie-break). Return the combined `RawExtractedField[]`.
  - [x] 2.6 A small `clamp01` + `splitValueUnit` helper, each unit-testable. Keep `valueText` raw (no decimal parsing — AC2).

- [x] **Task 3 — Rewrite `aws-adapter.ts` (AC1, AC5, AC7)**
  - [x] 3.1 Replace the stub body. Construct a lazily-memoised `TextractClient` reading `process.env.AWS_REGION ?? 'sa-east-1'` (default SDK credential chain). Add a comment: `// Story 9.2 will add the fail-loud boot gate + hard sa-east-1 pin; 9.1 uses the default chain.`
  - [x] 3.2 `extract({ bytes, mimeType, storagePath })`: send `new AnalyzeDocumentCommand({ Document: { Bytes: bytes }, FeatureTypes: ['FORMS','TABLES'] })`; `return mapAnalyzeDocumentResponse(response)`. Do NOT add a try/catch that swallows (the consumer failure-path hardening is Story 9.3 — let throws propagate exactly as the stub did). `mimeType`/`storagePath` are unused by the sync `Bytes` path — keep them in the signature (interface contract) and note `storagePath` is for future async `StartDocumentAnalysis`.
  - [x] 3.3 Keep the `TextractAdapter` type import + export shape identical so `index.ts` selection is untouched.

- [x] **Task 4 — Fixture + mapping tests (AC4, AC8)**
  - [x] 4.1 Create a recorded `AnalyzeDocument` JSON fixture under `services/extraction/__tests__/fixtures/` (e.g. `textract-analyze-document.json`) — a HAND-AUTHORED minimal-but-realistic `AnalyzeDocumentCommandOutput` (no real patient data; synthetic biomarkers). Include: a FORMS key/value pair (e.g. `Hemoglobina` → `14,2 g/dL`, high confidence), a multi-table layout (≥2 `TABLE` blocks with header + data rows), and one low-confidence field (`Confidence` ~62). Keep it well-formed per the SDK types.
  - [x] 4.2 Create `services/extraction/__tests__/aws-mapping.test.ts`: load the fixture, call `mapAnalyzeDocumentResponse`, assert the `RawExtractedField[]` **field-by-field** (biomarkerName, valueText raw-with-comma, unitText, confidence as `0–1` float). Assert the low-confidence field has `confidence < CONFIDENCE_GATE_THRESHOLD` (import the constant from `../src/pipeline/dispatch.js`) — proving it routes to review. Assert the multi-table fields are all present. Add unit tests for `splitValueUnit` + `clamp01` edge cases (no unit; `Confidence` 0/100/over-100; empty value token).
  - [x] 4.3 Do NOT call the real SDK in any test. The adapter's network call is not unit-tested (it's a thin SDK wrapper); the mapping (the logic) is fully covered by the fixture. Note this rationale in the test file header.

- [x] **Task 5 — Docs (AC6, AC7)**
  - [x] 5.1 Update the `aws-adapter.ts` header JSDoc: remove the "STUB / NOT_IMPLEMENTED" framing; describe the real implementation, the FORMS+TABLES heuristics summary, the sync-`Bytes` single-page limitation, and the 9.2 cred/region seam.
  - [x] 5.2 Add a short CLAUDE.md note (new "Extraction backend (Epic 9)" stanza or a line under the existing extraction context) — the `aws` adapter is now implemented (mapping in `aws-mapping.ts`), CI still uses the mock (NFR-S8), and creds/region gating lands in 9.2. Keep it tight.
  - [x] 5.3 Do NOT edit `docs/env-vars.md` for AWS vars yet — that is Story 9.2 (it owns the DPA + env-var documentation). Note this in Dev Notes so it isn't flagged as missing.

- [x] **Task 6 — Quality gates (mandatory)**
  - [x] 6.1 `pnpm -w typecheck` green (the SDK types resolve; mapping is typed against `AnalyzeDocumentCommandOutput`).
  - [x] 6.2 `pnpm -w lint` green (narrow any `catch`? none added in 9.1; the mapping has no catch). Declare no new env in lint config (AWS_REGION is read with a default; no boot gate yet).
  - [x] 6.3 `pnpm -w format` clean.
  - [x] 6.4 `pnpm --filter @healthtracker/extraction-worker test:unit` — existing tests still pass + new mapping tests pass.

---

## Dev Notes

### The scope fence (do not cross)

9.1 = adapter implementation + pure mapping + fixture tests + docs. **Explicitly deferred:** 9.2 (boot-time cred/region fail-loud gate, `docs/env-vars.md`, DPA), 9.3 (`consumers/document.ts` `extract()` failure-path catch + dead-letter), 9.4 (stub-era re-enqueue script). If a reviewer asks "why no boot gate / why no try-catch around extract()", the answer is "9.2 / 9.3 own those" — and this story documents the seam. Pulling them forward would bloat the PR and pre-empt those stories' ACs.

### Why a pure mapping module (AC5)

The network call (`TextractClient.send`) is an untestable-in-CI side effect (NFR-S8 forbids live AWS). Splitting `mapAnalyzeDocumentResponse` out makes the ONLY non-trivial logic — block-graph traversal + heuristic field extraction — a pure function the fixture tests cover field-by-field. `aws-adapter.ts` becomes a thin, low-risk SDK wrapper. This mirrors the repo's existing "adapter contract minimal, logic downstream/pure" philosophy (`adapter.ts` header).

### Textract response shape primer (for the implementer)

`AnalyzeDocumentCommandOutput.Blocks: Block[]`. Each `Block` has `Id`, `BlockType` (`PAGE`/`LINE`/`WORD`/`KEY_VALUE_SET`/`TABLE`/`CELL`/`SELECTION_ELEMENT`), `Confidence` (0–100), `Text` (for WORD/LINE), `EntityTypes` (`['KEY']`/`['VALUE']` on KEY_VALUE_SET), `RowIndex`/`ColumnIndex` (CELL), and `Relationships: { Type: 'CHILD'|'VALUE', Ids: string[] }[]`. FORMS: a KEY block links to its VALUE block via a `VALUE`-type relationship; text comes from `CHILD` → WORD. TABLES: a TABLE links to CELLs via `CHILD`; CELLs link to WORDs via `CHILD`. Build the id→block map first; everything else is graph walks. Guard every optional (`Blocks`, `Relationships`, `Text`, `Confidence` can be undefined — `noUncheckedIndexedAccess` is on).

### Confidence normalisation (AC2) — the load-bearing detail

Textract `Confidence` ∈ `[0,100]`. Emit `clamp(Confidence/100, 0, 1)`. The downstream gate (`dispatch.ts:39`, `CONFIDENCE_THRESHOLD = 0.85`, exported as `CONFIDENCE_GATE_THRESHOLD`) compares the raw adapter confidence. `dispatch.ts:107` coerces non-finite/out-of-range to `0` (→ review), so a bug that emits `>1` or `NaN` would silently route everything to review — the AC4 low-confidence test + a `clamp01` unit test guard this. Use the EXPORTED `CONFIDENCE_GATE_THRESHOLD` in the test, never a hard-coded `0.85`.

### Existing code to read before writing (READ ALL)

- `services/extraction/src/textract/adapter.ts` — the `RawExtractedField` + `TextractAdapter` contract (the target shape). RAW strings only.
- `services/extraction/src/textract/aws-adapter.ts` — the stub being replaced (keep the export name/shape).
- `services/extraction/src/textract/mock-adapter.ts` — the reference implementation of the contract (what the fields look like: `{ biomarkerName:'Hemoglobina', valueText:'14,2', unitText:'g/dL', confidence:0.92 }`).
- `services/extraction/src/index.ts:18–56` — adapter selection (do NOT change; just confirm the `aws` branch now resolves to a working adapter).
- `services/extraction/src/pipeline/dispatch.ts:39,76–142` — `CONFIDENCE_GATE_THRESHOLD`, the confidence gate, and the `low_confidence`/`loinc_unresolved` reason split the adapter's confidence feeds. The adapter must emit RAW `valueText` (dispatch parses it via `parseBrazilianDecimal`).
- `services/extraction/__tests__/document-consumer.test.ts` + `normalize.test.ts` — the inline-fixture + vitest patterns to mirror for `aws-mapping.test.ts`.
- `services/extraction/package.json` + `tsconfig.json` — ESM `"type":"module"`, `NodeNext`, `tsx`; `.js` import extensions on RELATIVE imports only.

### Existing behaviour that must be preserved (regression watch)

- **CI/dev adapter unchanged** — `EXTRACTION_ADAPTER` defaults to `mock`; CI never hits the `aws` branch (NFR-S8). 9.1 must not change selection or the default.
- **`dispatchExtractedFields` contract unchanged** — the adapter feeds it the same `RawExtractedField[]` shape the mock does; no dispatch/observation/review-queue change. The pipeline downstream of the adapter is untouched.
- **Throw-on-failure blast radius unchanged** — like the stub, the real adapter's throws propagate to the consumer's existing retry/dead-letter path (the consumer is NOT modified until 9.3). A Textract outage today behaves like the stub: retry → dead-letter → `failed`. Acceptable until 9.3 hardens it.
- **ESM resolution** — adding a bare package import must not regress the `.js`-extension rule on relative imports (#70/#71). `pnpm -w typecheck` is the gate.

### Project Structure Notes

- **NEW:** `services/extraction/src/textract/aws-mapping.ts`, `services/extraction/__tests__/aws-mapping.test.ts`, `services/extraction/__tests__/fixtures/textract-analyze-document.json`.
- **MODIFIED:** `services/extraction/src/textract/aws-adapter.ts` (stub → real), `services/extraction/package.json` (+`@aws-sdk/client-textract`), `pnpm-lock.yaml` (resolved), `CLAUDE.md` (Epic 9 extraction-backend note).
- **NO** DB schema, NO migration, NO `consumers/document.ts`, NO `index.ts` selection change, NO `apps/*`, NO `docs/env-vars.md` (9.2).

### Open questions for Francis (surface at hand-off, do NOT block)

1. **Multi-page / async Textract.** Synchronous `AnalyzeDocument` with `Bytes` is single-page (PDF) / ≤10 MB. Multi-page lab PDFs need async `StartDocumentAnalysis` + S3 + polling — a meaningfully bigger surface. 9.1 ships the sync path; if production lab PDFs are routinely multi-page, that's a follow-up story (flagged, not built).
2. **Heuristic robustness.** The FORMS/TABLES → biomarker heuristics are tuned to the fixture matrix, not a corpus of real Brazilian lab layouts. Real-world accuracy will need iteration against actual Textract outputs once 9.2 enables live calls in a staging env. 9.1's bar is correctness on the documented fixtures + a clean, documented heuristic.
3. **AWS region default.** 9.1 defaults `AWS_REGION` to `sa-east-1` with the default credential chain; 9.2 makes it a hard fail-loud pin. Confirm `sa-east-1` is the intended residency region (NFR-S8 says so).

### References

- [Source: `_bmad-output/planning-artifacts/epics.md` L1871–1897] Story 9.1 spec (FR1/FR2/FR3, NFR-S8) + the Epic 9 intro (no migration story; mock stays CI adapter).
- [Source: `services/extraction/src/textract/adapter.ts`] The `RawExtractedField` contract.
- [Source: `services/extraction/src/pipeline/dispatch.ts`] `CONFIDENCE_GATE_THRESHOLD` + the gate the adapter confidence feeds.
- [Source: `services/extraction/src/index.ts`] `EXTRACTION_ADAPTER` selection (unchanged by 9.1).
- [Source: AWS SDK `@aws-sdk/client-textract`] `AnalyzeDocumentCommand`, `AnalyzeDocumentCommandOutput`, `Block` shape (FORMS/TABLES, `Relationships` CHILD/VALUE, `Confidence` 0–100).

## Dev Agent Record

### Agent Model Used

claude-opus-4-8 (BMad bmad-create-story + bmad-dev-story workflows)

### Debug Log References

- `pnpm --filter @healthtracker/extraction-worker add @aws-sdk/client-textract` → resolved `@aws-sdk/client-textract@3.1059.0` (runtime dep).
- `pnpm -w typecheck` 17/17 (extraction-worker + llm-service ran fresh; SDK types resolve under NodeNext).
- `pnpm --filter @healthtracker/extraction-worker test:unit` → **78 pass (6 files)**, incl. new `aws-mapping.test.ts` (16 tests).
- `pnpm -w lint` 15/15 (after fixing 3 errors: declared `AWS_REGION` in `turbo.json` globalEnv for `turbo/no-undeclared-env-vars`; `type Cell` → `interface Cell`; `!cell || cell.BlockType !== "CELL"` → `cell?.BlockType !== "CELL"`). NOTE: an initial `pnpm -w lint` showed a stale turbo-cache failure for extraction-worker; `--force` re-run + a fresh full run both pass.
- `pnpm -w format` 10/10 clean.

### Completion Notes List

- Implemented 2026-06-02 on `worktree-story-8-1-operator-review-queue` — Epic 9 developed on the Epic 8 branch per Francis's decision (one PR will contain Epic 8 + Epic 9).
- **Pure mapping module `aws-mapping.ts`** (the only non-trivial logic, fully unit-tested): builds a `Map<Id, Block>`, reconstructs block text from `CHILD`→`WORD` relationships, maps FORMS (`KEY_VALUE_SET` KEY→VALUE) and TABLES (`TABLE`→`CELL` grid with header-driven + numeric-fallback column detection), splits value/unit via a leading-numeric-token regex (keeps the Brazilian comma RAW), normalises Textract `Confidence` 0–100 → `[0,1]` via `clamp01`, and de-dupes by biomarker name keeping the higher confidence.
- **`aws-adapter.ts`** rewritten stub→real: a thin SDK wrapper (lazy-memoised `TextractClient` reading `AWS_REGION` default `sa-east-1`, default credential chain) that sends `AnalyzeDocumentCommand({ FeatureTypes: ['FORMS','TABLES'] })` and delegates to the mapping. No try/catch (failure-path hardening is 9.3); throws propagate exactly as the stub did.
- **Fixture** `__tests__/fixtures/textract-analyze-document.json` — hand-authored synthetic `AnalyzeDocumentCommandOutput` (NO real patient data): a FORMS pair (Hemoglobina 14,2 g/dL), TWO tables (multi-table), and a low-confidence field (Vitamina D, `Confidence` 62 → 0.62). The mapping test asserts all 5 fields field-by-field + the low-confidence field `< CONFIDENCE_GATE_THRESHOLD` (imported constant, never hard-coded 0.85).
- **Scope fence honoured:** no boot-gate/region-pin (9.2), no `consumers/document.ts` change (9.3), no re-enqueue (9.4), no `docs/env-vars.md` edit (9.2 owns it). CI adapter selection unchanged — `mock` stays default (NFR-S8). Seams documented in code + the new CLAUDE.md "Extraction backend (Epic 9)" stanza.
- **No DB schema / migration** (Epic 9 introduces none — Textract output flows through the existing dispatch path).
- Deferred (no live AWS in worktree/CI, by design — NFR-S8): the actual `TextractClient.send` network call is not exercised; only the mapping logic is tested. Real-world heuristic accuracy needs iteration against live Textract once 9.2 enables it (flagged in open questions).

### File List

**NEW**

- `services/extraction/src/textract/aws-mapping.ts`
- `services/extraction/__tests__/aws-mapping.test.ts`
- `services/extraction/__tests__/fixtures/textract-analyze-document.json`

**MODIFIED**

- `services/extraction/src/textract/aws-adapter.ts` (stub → real Textract adapter)
- `services/extraction/package.json` (+`@aws-sdk/client-textract@^3.1059.0`)
- `pnpm-lock.yaml` (SDK + transitive deps resolved)
- `turbo.json` (+`AWS_REGION` in globalEnv)
- `CLAUDE.md` (+"Extraction backend (Epic 9)" stanza)

**NO** DB schema / migration, **NO** `consumers/document.ts` / `index.ts` selection change, **NO** `apps/*`, **NO** `docs/env-vars.md` (Story 9.2).

## Senior Developer Review (AI)

**Reviewed:** 2026-06-02 · **Outcome:** Changes Requested → Addressed · **Method:** 3-layer adversarial (Blind Hunter — diff only; Edge Case Hunter — diff + repo read; Acceptance Auditor — diff vs spec). The Acceptance Auditor passed all 8 ACs, but Blind Hunter + Edge Case Hunter **converged on a HIGH ship-blocker** the AC text didn't catch: the adapter as first written could never publish an observation. Four findings patched; gates re-run green.

### Action Items

- [x] **HIGH — `collectedAtText` never populated → every Textract field quarantined, nothing ever publishes.** `dispatch.ts` sets `structurallyBad = valueNumeric === null || collectedAt === null`; with no date text, `collectedAt` is always `null`, so every field routed to `extraction_review_queue` instead of `observations` — a real regression vs the mock adapter (which populates `collectedAtText`), defeating AC1's intent. **Fix:** added `extractDocumentContext()` — pulls the document-level collection date + lab name from the FORMS pairs whose key matches a date/lab pattern, and stamps `collectedAtText` + `labName` onto EVERY emitted field (a lab report has one draw date for the whole panel). The date/lab keys are excluded from biomarker extraction (critical: `splitValueUnit("15/03/2024")` would otherwise yield a bogus "15" biomarker). New fixture FORMS pairs + tests assert the stamping and the non-emission of context keys. (`aws-mapping.ts`)
- [x] **MED — `labName` never populated** → `dominantLabName` always null + Story 8.1 operator review-queue `lab_name` always NULL for Textract uploads. **Fix:** same `extractDocumentContext()` mechanism stamps `labName`. (`aws-mapping.ts`)
- [x] **HIGH — name-only dedup dropped genuinely distinct same-name measurements** (e.g. the same analyte across two tables / two draws). **Fix:** dedup key is now `biomarkerName + valueText` — a datum reported by both a FORMS pair and a table still collapses, but a distinct same-name value survives. New test locks it. (`aws-mapping.ts`)
- [x] **MED — value-column detection could pick a reference-range column** (`VALUE_HEADER` `/valor/` matches "Valor de Referência", and the numeric-body fallback would grab a numeric range column). **Fix:** added `REFERENCE_HEADER` exclusion applied FIRST in both the header pass and the fallback, plus a `unitCol !== valueCol` guard. New test (`[Exame, Resultado, Valor de Referência]` → picks "99", not the range "70"). (`aws-mapping.ts`)

### Dismissed / Deferred (with rationale)

- **LOW — `splitValueUnit` keeps a trailing separator (`"12."`/`"12,"`)** — RAW-string contract; the downstream `parseBrazilianDecimal` owns parsing. Documented, not a 9.1 bug.
- **LOW/known-limitation — merged/spanning cells (`ColumnSpan`/`RowSpan`, `MERGED_CELL` blocks) not honoured** — a larger surface; documented as a known limitation in the module JSDoc, deferred (needs live-Textract iteration in 9.2). Real multi-page/merged-layout robustness is explicitly out of 9.1 scope.
- **LOW — lazy-memoised client ignores AWS_REGION changes mid-process** — single-threaded JS makes the construction race benign; region pinning is Story 9.2. Documented.
- **NOTE — `extract()` has no try/catch** — intentional (throws propagate to the consumer retry/dead-letter path; hardening is Story 9.3). Confirmed correct by all layers.
- **NOTE — lockfile churn** (`pnpm-lock.yaml`, ~14.6k del / 9.8k ins) is a one-time YAML quote-style normalization by the pinned `pnpm@10.19.0` (the committed lockfile was an older serialization); dependency resolution is intact + the AWS SDK added. Frozen-lockfile checks resolution, not quote style — safe, but noisy. Flagged for Francis.

### Post-patch gates

`pnpm -w typecheck` 17/17 · `pnpm -w lint` 15/15 (incl. extraction-worker) · changed files prettier-clean · `pnpm --filter @healthtracker/extraction-worker test:unit` **82 pass** (20 in `aws-mapping.test.ts`, up from 16 — added: context-key non-emission, date/lab stamping on every field, reference-column exclusion, dedup-by-value). Live `TextractClient.send` remains untested by design (NFR-S8). The real-world heuristic accuracy (and the FORMS-key date/lab detection patterns) still need iteration against live Textract once Story 9.2 enables it.
