# Story 9.3: Harden the consumer's `extract()` failure path

Status: done

<!-- THIRD story of Epic 9. STACKS on 9.1 (adapter) + 9.2 (boot gate) — same worktree/PR branch `worktree-story-8-1-operator-review-queue` (one PR spans Epic 8 + Epic 9). -->
<!-- 9.1's adapter `extract()` deliberately had NO try/catch ("throws propagate to the consumer's existing retry/dead-letter path. Story 9.3 wraps that call site"). THIS is that story — it hardens the CALL SITE in the consumer, not the adapter. -->
<!-- SCOPE FENCE — 9.3 wraps ONLY the `deps.textractAdapter.extract(...)` call in `consumers/document.ts`. It does NOT change the adapter (9.1), the boot gate (9.2), or add the re-enqueue script (9.4). -->

## Story

As a **platform engineer**,
I want **`textractAdapter.extract()` failures wrapped at the consumer call site so a permanent throw dead-letters the upload with a patient-visible `failed` reason, while transient throttling/5xx errors fall through to the existing pg-boss retry**,
so that **an adapter or Textract outage produces a clean `failed` state with a notification — not the noisy retry-resume loop, and not a swallowed programmer bug**.

## Context: what exists today (read before writing)

- **The unguarded call site** (`services/extraction/src/consumers/document.ts`, ~line 160): `const fields = await deps.textractAdapter.extract({ bytes, mimeType, storagePath });` — currently NOT wrapped. A throw here propagates out of `handleDocumentJob` → pg-boss retries to the queue's `retryLimit` → on exhaustion the `extraction.dead_letter` handler fires `markUploadFailed`. That multi-hop retry loop (with `"resuming after prior worker crash"` logs) is the noise this story removes for _permanent_ faults.
- **The template to mirror** is the **storage-download catch** right above it (same file, ~lines 119–158): on a permanent storage failure it logs, then opens ONE `deps.sql.begin(async (tx) => { applyDeadLetter(tx, { reason }); if (!dl.updated) return; emitNotificationEvent(tx, { kind: 'failed', ... }) })` and `return`s. The new `extract()` catch must follow this shape **exactly** (same single-tx dead-letter + `failed` notification + `dl.updated` no-op guard).
- **`applyDeadLetter(tx, { uploadId, metadata })`** (`state-machine/upload-transitions.ts:115`) returns `{ updated: boolean }` (optimistic — false if the row is already terminal). **`emitNotificationEvent(tx, { uploadId, patientId, kind, metadata })`** writes the notification audit + enqueues the push; `kind: 'failed'` is the existing failure push.
- **Narrow-catch discipline (CLAUDE.md):** "Any `try/catch` in new code must articulate which error shapes it swallows … Broad `catch (err)` that fail-opens hides programmer errors (`TypeError`, etc.)." So the catch must re-throw `TypeError`/`ReferenceError`/`SyntaxError` (programmer bugs) AND transient Textract errors (so pg-boss retries) — dead-lettering ONLY genuine permanent extraction faults.
- **The adapter** (`textract/aws-adapter.ts`, 9.1) throws raw AWS SDK errors (e.g. `ThrottlingException`, `InvalidParameterException`, 4xx/5xx with `$metadata.httpStatusCode`, `$retryable`) and the mapping can throw too. The classifier must read the SDK error shape.
- **Tests:** `services/extraction/__tests__/document-consumer.test.ts` (vitest, `makeSql` mock with `.begin`, `mockAdapter`, `transitionRows`-driven UPDATE results). The dead-letter test at ~line 212 shows the assertion pattern (`transitionRows: [[{processing}], [{failed}]]`).

## Acceptance Criteria

> AC1–AC3 are lifted verbatim from `_bmad-output/planning-artifacts/epics.md` L1931–1945 (Story 9.3). AC4–AC6 are implementation-contract ACs locking the classifier shape, the mirror-the-storage-catch requirement, and the test matrix.

1. **AC1 — Permanent `extract()` throw → dead-letter + `failed` push in one tx.**
   **Given** `extract()` throws a permanent fault (Textract 4xx, a mapping error, or a permanent adapter fault),
   **When** `handleDocumentJob` runs,
   **Then** the throw is caught, the upload is dead-lettered via `applyDeadLetter` with `reason: 'extraction_unavailable'` (+ the error message in metadata), and `emitNotificationEvent` fires the `failed` push — ALL inside one `deps.sql.begin` transaction (mirroring the storage-download catch), with the same `if (!dl.updated) return` no-op guard, then `return` (no rethrow).

2. **AC2 — Programmer error → re-thrown unhandled (narrow catch).**
   **Given** the new catch block,
   **When** a programmer error (`TypeError` / `ReferenceError` / `SyntaxError`) is thrown,
   **Then** it is **re-thrown** (not dead-lettered, not swallowed) so pg-boss surfaces the regression — per the CLAUDE.md narrow-catch discipline.

3. **AC3 — Transient Textract error → let pg-boss retry.**
   **Given** a transient Textract error (throttling / 5xx / network timeout) distinguishable by the SDK error shape,
   **When** it is caught,
   **Then** it is **re-thrown** so the existing pg-boss retry policy runs (it only dead-letters after retry exhaustion, via the existing `extraction.dead_letter` handler). The transient-vs-permanent decision is **documented inline** in the consumer + the classifier.

4. **AC4 — Classifier is a PURE, exported, unit-tested function.**
   **Given** the consumer is hard to unit-test in isolation but the classification logic is pure,
   **Then** the transient/programmer detection lives in a NEW `services/extraction/src/textract/aws-errors.ts` exporting pure predicates — `isProgrammerError(err: unknown): boolean` (TypeError/ReferenceError/SyntaxError) and `isTransientTextractError(err: unknown): boolean` (SDK `$retryable` truthy, OR `$metadata.httpStatusCode >= 500`, OR a throttling/timeout `name`/`code`) — with no SDK client, no network. The consumer imports them; the unit tests exercise the matrix directly.

5. **AC5 — Mirror the storage-download catch exactly (consistency + the R1-P150 single-tx invariant).**
   **Given** the storage catch already solved "dead-letter + notify atomically",
   **Then** the `extract()` catch uses the identical `deps.sql.begin` + `applyDeadLetter` + `dl.updated` guard + `emitNotificationEvent({ kind: 'failed' })` structure (only `reason` differs: `extraction_unavailable` vs `storage_unavailable`). No new helper, no divergent error handling.

6. **AC6 — Tests + quality gates + scope fence.**
   **Then** `document-consumer.test.ts` gains cases: (a) permanent `extract()` throw → `applyDeadLetter` + `failed` notification fired, no rethrow; (b) `TypeError` from `extract()` → `handleDocumentJob` rejects (rethrow); (c) transient (e.g. `{ name: 'ThrottlingException', $retryable: { throttling: true } }` or `$metadata.httpStatusCode: 503`) → rejects (rethrow). A new `aws-errors.test.ts` unit-tests the predicates. `pnpm -w typecheck/lint/format` green; `pnpm --filter @healthtracker/extraction-worker test:unit` green. The adapter (9.1), boot gate (9.2), mapping, and `index.ts` selection are unchanged; no re-enqueue (9.4).

**Requirements traceability:** FR4 (clean failure handling), NFR-S7 (no PII in the dead-letter reason — `extraction_unavailable` is a closed reason string, and the error message stored in metadata is an SDK/adapter message, never patient data — verify), AR14 (the dead-letter + notification audit trail).

---

## Tasks / Subtasks

- [x] **Task 1 — Pure error classifier `aws-errors.ts` (AC4)**
  - [x] 1.1 Create `services/extraction/src/textract/aws-errors.ts`.
  - [x] 1.2 `isProgrammerError(err: unknown): boolean` → `err instanceof TypeError || err instanceof ReferenceError || err instanceof SyntaxError`. (These are bugs, not runtime faults — must surface, never dead-letter.)
  - [x] 1.3 `isTransientTextractError(err: unknown): boolean` → true when the error is retryable: a truthy `$retryable` property (AWS SDK v3 marks retryable/throttling errors), OR `$metadata.httpStatusCode >= 500`, OR `name`/`code` in a documented throttling/timeout set (`ThrottlingException`, `ThrottledException`, `ProvisionedThroughputExceededException`, `TooManyRequestsException`, `RequestLimitExceeded`, `InternalServerError`, `ServiceUnavailable`, `TimeoutError`; `code` `ETIMEDOUT`/`ECONNRESET`/`EAI_AGAIN`). Read properties defensively off `unknown` (a typed `hasOwn`/narrowing helper; no `any` cast that trips lint). Document each branch.
  - [x] 1.4 JSDoc: classification is best-effort on the SDK error shape; the DEFAULT (unknown shape) is **permanent** (dead-letter) — a fault we can't classify as transient should not loop forever. Document this default explicitly.

- [x] **Task 2 — Wrap the `extract()` call site (AC1, AC2, AC3, AC5)**
  - [x] 2.1 In `consumers/document.ts`, wrap `const fields = await deps.textractAdapter.extract({...})` in `try { … } catch (err) { … }`.
  - [x] 2.2 In the catch: `if (isProgrammerError(err)) throw err;` (AC2) → `if (isTransientTextractError(err)) { console.warn(... transient; letting pg-boss retry ...); throw err; }` (AC3) → else (permanent): `console.error(...)`, then the storage-catch-mirrored `await deps.sql.begin(async (tx) => { const dl = await applyDeadLetter(tx, { uploadId, metadata: { reason: 'extraction_unavailable', error: err instanceof Error ? err.message : String(err) } }); if (!dl.updated) { console.warn(...); return; } await emitNotificationEvent(tx, { uploadId, patientId, kind: 'failed', metadata: { reason: 'extraction_unavailable' } }); });` then `return;` (AC1, AC5).
  - [x] 2.3 Keep `fields` in the outer scope (declare `let fields: RawExtractedField[]` before the try, assign inside — same shape as the `bytes` download pattern) so the existing dispatch block below is unchanged. Confirm the dispatch `sql.begin` block that follows is untouched.
  - [x] 2.4 Inline comment documenting the transient-vs-permanent split + the AC2 narrow-catch reasoning (greppable, mirrors the storage catch's `R*-P*` comment style).

- [x] **Task 3 — Tests (AC6)**
  - [x] 3.1 `services/extraction/__tests__/aws-errors.test.ts`: unit-test `isProgrammerError` (TypeError/ReferenceError/SyntaxError → true; a plain `Error`/SDK error → false) and `isTransientTextractError` (throttling name → true; `$metadata.httpStatusCode: 503` → true; `$retryable: { throttling: true }` → true; `ETIMEDOUT` code → true; a 4xx `InvalidParameterException` / `$metadata.httpStatusCode: 400` → false; a plain `Error` → false; non-error inputs `null`/`"str"` → false).
  - [x] 3.2 Extend `document-consumer.test.ts`:
    - **Permanent:** `textractAdapter: { extract: () => Promise.reject(new Error('Textract 400 InvalidParameterException')) }` with `transitionRows: [[{processing}], [{failed}]]`; assert the run resolves (no throw), an `update uploads` dead-letter happened, and a notification audit/emit fired. (Use the existing dead-letter test at ~L212 as the template.)
    - **Programmer:** `extract: () => Promise.reject(new TypeError('cannot read X'))`; assert `handleDocumentJob` **rejects** (rethrow) and NO dead-letter UPDATE ran.
    - **Transient:** `extract: () => Promise.reject(Object.assign(new Error('throttled'), { name: 'ThrottlingException', $retryable: { throttling: true } }))`; assert `handleDocumentJob` **rejects** (rethrow) and NO dead-letter UPDATE ran.
  - [x] 3.3 Confirm existing document-consumer tests still pass (the happy/review/dead-letter paths are unaffected — the new catch only fires when `extract()` throws).

- [x] **Task 4 — Docs**
  - [x] 4.1 Update the CLAUDE.md "Extraction backend (Epic 9)" stanza: 9.3 hardens the consumer `extract()` call site — permanent faults dead-letter (`extraction_unavailable`) + `failed` push in one tx; transient (throttle/5xx/timeout) and programmer errors re-throw (pg-boss retry / surface). Move 9.3 out of "deferred"; leave 9.4 as the last deferred item.
  - [x] 4.2 No `docs/env-vars.md` change (no new env). No new `reason` enum (the `reason` is free metadata text on the dead-letter, like `storage_unavailable` — verify it is NOT a DB enum).

- [x] **Task 5 — Quality gates (mandatory)**
  - [x] 5.1 `pnpm -w typecheck` green.
  - [x] 5.2 `pnpm -w lint` green (the new catch is narrow; the classifier reads `unknown` without an unsafe `any`).
  - [x] 5.3 `pnpm -w format` clean.
  - [x] 5.4 `pnpm --filter @healthtracker/extraction-worker test:unit` green (existing + `aws-errors.test.ts` + the 3 new consumer cases).

---

## Dev Notes

### The scope fence (do not cross)

9.3 = wrap the consumer `extract()` call site + the pure classifier + tests + a CLAUDE.md line. **Deferred:** the stub-era re-enqueue script (9.4). Do NOT touch `aws-adapter.ts` (9.1) or `aws-config.ts` (9.2) — `extract()` still throws raw; the consumer is where the catch belongs (the adapter stays a thin SDK wrapper, and the consumer owns the upload state machine + dead-letter + notification).

### Why the catch lives in the consumer, not the adapter

The adapter (9.1) is intentionally a thin, side-effect-free SDK wrapper; the _consumer_ owns the upload lifecycle (`applyDeadLetter`, `emitNotificationEvent`, the `sql.begin` tx, the pg-boss retry contract). Catching in the consumer keeps dead-letter/notification logic in one place (next to the identical storage-download catch) and keeps the adapter unit-testable without DB/notification deps. The classifier is pulled into a pure module so the SDK-error-shape logic is unit-tested without a live throw.

### Transient-vs-permanent (AC3/AC4) — the load-bearing decision

- **Transient** (re-throw → pg-boss retries, then its dead_letter handler fires after exhaustion): throttling (`ThrottlingException` et al.), 5xx (`$metadata.httpStatusCode >= 500`, `InternalServerError`, `ServiceUnavailable`), network timeouts (`TimeoutError`, `ETIMEDOUT`/`ECONNRESET`), and anything the SDK marks `$retryable`. Retrying these can succeed.
- **Permanent** (dead-letter immediately — retrying is pointless and just loops): 4xx (`InvalidParameterException`, `UnsupportedDocumentException`, `BadDocumentException`, `DocumentTooLargeException`), mapping errors, and **any error we can't classify** (default permanent — a fault of unknown shape must not loop to the retry limit on every job).
- **Programmer errors** (`TypeError`/`ReferenceError`/`SyntaxError`) re-throw unhandled — they're bugs, must surface in pg-boss/Sentry, never dead-letter a patient's upload over our code defect.

The order in the catch matters: **programmer check FIRST** (a `TypeError` could coincidentally have a `$retryable`-looking shape if someone mutated it — unlikely, but check the bug class first), then transient, then default-permanent.

### Existing code to read before writing (READ ALL)

- `services/extraction/src/consumers/document.ts` ~L119–165 — the storage-download catch (the exact template) + the unguarded `extract()` call + the dispatch `sql.begin` block that follows (must stay untouched).
- `services/extraction/src/state-machine/upload-transitions.ts:115` — `applyDeadLetter` signature + `{ updated }` return.
- `services/extraction/src/notifications/emit.ts` — `emitNotificationEvent` signature + the `failed` kind.
- `services/extraction/__tests__/document-consumer.test.ts` L100–135 + the dead-letter test ~L212 — the `makeSql`/`mockAdapter`/`transitionRows` harness + dead-letter assertion to mirror.
- `services/extraction/src/textract/aws-adapter.ts` (9.1) — confirms `extract()` throws raw SDK errors (so the classifier reads `$metadata`/`$retryable`/`name`).

### Existing behaviour that must be preserved (regression watch)

- **The dispatch `sql.begin` block** (dispatch + audit + terminal UPDATE) below the `extract()` call is unchanged — only the `extract()` call is now wrapped and `fields` is hoisted to a `let`. The happy/review/empty-extraction paths must behave identically when `extract()` succeeds.
- **The storage-download catch** is untouched — 9.3 adds a SIBLING catch for `extract()`, it doesn't refactor the storage one.
- **The pg-boss retry contract** — transient + programmer errors still propagate out of `handleDocumentJob` exactly as today (the only NEW behaviour is permanent faults short-circuit to dead-letter instead of looping). The `extraction.dead_letter` handler + `markUploadFailed` are unchanged.
- **NFR-S7 (no PII):** the dead-letter `metadata.error` stores the SDK/adapter error _message_. AWS Textract error messages are about the request/document format, not patient data — but verify the stored message can't contain extracted patient values (it can't: the throw happens at/around the Textract call or mapping, before any value is surfaced to a user-facing string). Keep `reason` a fixed closed string.

### Project Structure Notes

- **NEW:** `services/extraction/src/textract/aws-errors.ts`, `services/extraction/__tests__/aws-errors.test.ts`.
- **MODIFIED:** `services/extraction/src/consumers/document.ts` (wrap `extract()` + hoist `fields`), `services/extraction/__tests__/document-consumer.test.ts` (+3 cases), `CLAUDE.md` (Epic 9 stanza — 9.3 shipped).
- **NO** adapter/boot-gate/mapping change, **NO** `index.ts`, **NO** DB/migration, **NO** `docs/env-vars.md`, **NO** re-enqueue (9.4).

### Open questions for Francis (surface at hand-off, do NOT block)

1. **Retry-limit visibility.** Transient errors re-throw → pg-boss retries to the queue `retryLimit` (3) → then `extraction.dead_letter` → `markUploadFailed`. So a sustained Textract outage still ends in `failed` (after ~3 retries) with the existing dead-letter handler's reason, NOT `extraction_unavailable`. If you want the _retry-exhausted_ dead-letter to also carry a distinct reason, that's a tweak to the `dead_letter` handler (out of 9.3 scope) — flag if wanted.
2. **`reason` taxonomy.** I'm adding `extraction_unavailable` alongside the existing `storage_unavailable`/`no_readable_text`/`no_publishable_fields` free-text reasons. If product wants these as a closed enum (for analytics), that's a small follow-up; today they're metadata strings.

### References

- [Source: `_bmad-output/planning-artifacts/epics.md` L1923–1945] Story 9.3 spec (FR4, NFR-S7, AR14).
- [Source: `services/extraction/src/consumers/document.ts`] The unguarded `extract()` call + the storage-download catch template.
- [Source: `CLAUDE.md` code-review discipline — "Narrow catches by default"] The AC2 narrow-catch requirement.
- [Source: `_bmad-output/implementation-artifacts/9-1-implement-the-real-aws-textract-adapter.md`] 9.1's deferral of the failure-path hardening to 9.3.

## Dev Agent Record

### Agent Model Used

claude-opus-4-8 (BMad bmad-create-story + bmad-dev-story workflows)

### Debug Log References

- `pnpm -w typecheck` 17/17 · `pnpm -w lint` 15/15 · changed files prettier-clean · `pnpm --filter @healthtracker/extraction-worker test:unit` **103 pass** (8 new in `aws-errors.test.ts`; 3 new consumer cases — permanent dead-letter, programmer rethrow, transient rethrow).

### Completion Notes List

- Implemented 2026-06-02 on `worktree-story-8-1-operator-review-queue`, stacked on 9.1/9.2 (Epic 8 + Epic 9 share one PR).
- **NEW `aws-errors.ts`** — pure `isProgrammerError` (TypeError/ReferenceError/SyntaxError) + `isTransientTextractError` (SDK `$retryable`, `$metadata.httpStatusCode >= 500`, or a documented throttle/timeout `name`/`code` set). Reads properties off `unknown` via a typed `prop()` helper (no `any`). Default for an unclassifiable error is permanent (don't loop).
- **Consumer catch (`document.ts`)** — `extract()` wrapped, `fields` hoisted to `let`. Catch order: programmer → rethrow; transient → `console.warn` + rethrow (pg-boss retries); else permanent → `console.error` + the storage-catch-mirrored `sql.begin` { `applyDeadLetter(reason: 'extraction_unavailable')`, `dl.updated` guard, `emitNotificationEvent(kind:'failed')` } + `return`. The dispatch `sql.begin` block below is unchanged.
- **Tests** — `aws-errors.test.ts` (8) covers the predicate matrix incl. 4xx-permanent, network-code, non-error inputs. `document-consumer.test.ts` (+3): permanent fault resolves (proves the catch — without it, the thrown Error would reject); TypeError + ThrottlingException both reject (rethrow).
- Scope fence honoured: no adapter (9.1), boot-gate (9.2), mapping, `index.ts`, DB, or `docs/env-vars.md` change; no re-enqueue (9.4). CLAUDE.md Epic 9 stanza: 9.3 shipped, only 9.4 left deferred.
- NFR-S7: `reason` is the fixed string `extraction_unavailable`; `metadata.error` stores the SDK/adapter error _message_ (request/document-format text, thrown at/around the Textract call before any patient value is surfaced) — no PII. No DB enum for the reason (free metadata text, like `storage_unavailable`).

### File List

**NEW**

- `services/extraction/src/textract/aws-errors.ts`
- `services/extraction/__tests__/aws-errors.test.ts`

**MODIFIED**

- `services/extraction/src/consumers/document.ts` (wrap `extract()` + hoist `fields` + imports)
- `services/extraction/__tests__/document-consumer.test.ts` (+3 failure-path cases)
- `CLAUDE.md` (Epic 9 stanza — 9.3 shipped)

**NO** adapter/boot-gate/mapping/`index.ts` change, **NO** DB/migration, **NO** `docs/env-vars.md`, **NO** re-enqueue (9.4).

## Senior Developer Review (AI)

**Reviewed:** 2026-06-02 · **Outcome:** Changes Requested → Addressed · **Method:** 3-layer adversarial (Blind Hunter — diff only; Edge Case Hunter — diff + repo + installed-SDK research; Acceptance Auditor implied via the spec ACs). The Edge Case Hunter's deep dive against `@aws-sdk/client-textract@3.1059.0` + `@smithy/core` found a real HIGH classifier gap; the consumer wiring, idempotency, and stuck-in-processing loop were all verified correct.

### Action Items

- [x] **HIGH — `LimitExceededException` (a real Textract throttle in AWS's own `THROTTLING_ERROR_CODES`) was misclassified PERMANENT → dead-lettered instead of retried.** Also HTTP 429 throttles weren't caught by status code, and the `$retryable`-is-strongest-signal comment was factually wrong for this SDK (AWS's `isThrottlingError` matches on exception name + 429, and doesn't stamp `$retryable` on every Textract throttle). **Fix:** added `limitexceededexception` (+ `requestthrottledexception`) to `TRANSIENT_NAMES`, added `status === 429` to the transient check, reordered so the name set is checked first, and corrected the `$retryable` comment to "one signal, not the strongest." New tests: `LimitExceededException`@429 and a bare-429 unknown-name both classify transient. (`aws-errors.ts`)
- [x] **MED — permanent-fault consumer test only asserted `.resolves` (would pass even if the catch fail-opened without dead-lettering).** **Fix:** the test now positively asserts an `insert into audit_log` call fired carrying `extraction_unavailable` — proving the dead-letter + `failed`-notification path actually ran. (`document-consumer.test.ts`)

### Dismissed / verified (with rationale)

- **Edge Case #5 — stuck-in-`processing` on a never-resolving transient error:** verified NO gap. Transient rethrow → pg-boss `retryLimit: 3` → `extraction.dead_letter` → `markUploadFailed` (`processing→failed` + `failed` push). Loop closes.
- **Blind Hunter — uninitialized `fields` use:** verified safe — every catch branch either `throw`s or `return`s after dead-letter; the dispatch block is unreachable with `fields` unassigned.
- **Blind Hunter — double `failed`-emit on retry:** verified safe — `emitNotificationEvent` has `ON CONFLICT … DO NOTHING` on the notification-event unique index + the `dl.updated` guard. Same dedup the storage path relies on.
- **Blind Hunter — `$retryable: { throttling: false }` over-broad `!= null`:** `$retryable` present means the SDK marked it retryable regardless of the throttling sub-flag; honouring it is correct. It's now the LAST signal (after name/status), so it rarely decides anyway.
- **`metadata.error: err.message` PII:** identical to the existing `storage_unavailable` catch; Textract errors describe the request/document format, thrown before any patient value is surfaced. `reason` stays a fixed closed string. The patient-facing `failed` push copy is **kind-based** (`consumers/notifications.ts`), so `extraction_unavailable` needs no reason→copy mapping — it's telemetry only (Edge Case #6 resolved).
- **DB throw inside the catch (dead-letter write fails) → job retry:** correct behaviour (a DB hiccup during dead-letter _should_ retry); mirrors the storage catch exactly.
- **Untested permanent `dl.updated === false` no-op branch:** mirrors the equally-untested storage-path branch; low value, deferred.

### Post-patch gates

`pnpm -w typecheck` 17/17 · `pnpm -w lint` 15/15 · changed files prettier-clean · `pnpm --filter @healthtracker/extraction-worker test:unit` **105 pass** (10 in `aws-errors.test.ts` incl. LimitExceeded + 429; the permanent consumer case now asserts the audit-log dead-letter side-effect). No live AWS (NFR-S8).
