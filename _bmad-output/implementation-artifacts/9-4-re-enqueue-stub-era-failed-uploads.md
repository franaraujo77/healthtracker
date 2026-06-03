# Story 9.4: Re-enqueue uploads stuck in `failed` from the stub era

Status: done

<!-- FOURTH and FINAL story of Epic 9. STACKS on 9.1–9.3 — same worktree/PR branch `worktree-story-8-1-operator-review-queue`. -->
<!-- OPTIONAL / CONDITIONAL per the epic ("schedule only if the count of stub-era `failed` uploads at launch is non-trivial; a single test upload can simply be re-uploaded"). Francis asked to build it to close Epic 9. -->
<!-- This is a ONE-SHOT operational script (like `enqueue-smoke-test.ts`), NOT wired into any auto-run. It MUTATES production upload state, so it is dry-run-by-default and requires an explicit --apply + a --before cutoff. -->

## Story

As an **operator**,
I want **a one-shot, dry-run-by-default script that resets uploads which reached `failed` only because the stub/mock adapter was active (i.e. before `EXTRACTION_ADAPTER=aws` went live) back to `queued` and re-enqueues a fresh `extraction.document` job**,
so that **patients who uploaded before the real Textract backend shipped don't have to manually re-upload — without ever re-processing an upload that failed for a genuine post-launch reason**.

## Context: what exists today (read before writing)

- **Where the failure reason lives:** `applyDeadLetter` (`state-machine/upload-transitions.ts:115`) merges `metadata` onto the **`uploads.metadata` jsonb** column and sets `status='failed'`, `updated_at=now()`. So a failed upload's reason is `uploads.metadata->>'reason'`. **The actual stored reason values are NOT the epic's aspirational signatures.** What the code really writes: `retries_exhausted` (`markUploadFailed`, the pg-boss retry-exhaustion path — this is where the OLD stub's `NOT_IMPLEMENTED` throw and the mock's `no fixture` throw actually landed, after retries), `storage_unavailable` (storage catch), `extraction_unavailable` (Story 9.3 permanent-fault catch), `no_readable_text` / `no_publishable_fields` (dispatch empty/quarantine paths). **The epic's `NOT_IMPLEMENTED`/`no_fixture` are error _messages_, not `uploads.metadata.reason` values** — they live in the pg-boss dead-letter job, not the upload row.
- **The robust discriminator is TIME, not reason.** The AC's real intent — "failed _before_ `EXTRACTION_ADAPTER=aws` went live" vs "a genuine post-launch `no_readable_text`" — is cleanly separated by a **timestamp cutoff** (`uploads.updated_at < <aws-launch-time>`). Everything that failed before the cutoff failed without real extraction; everything after is a real Textract outcome. The reason filter is a secondary narrowing, not the primary gate.
- **The enqueue outbox pattern** (`packages/api/src/uploads.ts:108` `enqueueExtractDocument`): wraps `{ jobId, patientId, correlationId: uploadId, payload, createdAt }` and inserts into `pgboss.job`. The worker's `enqueue-smoke-test.ts` shows the simpler in-worker path: `boss.start()` then `boss.send('extraction.document', wrapped)` (the queue's retry policy is applied from `boss.createQueue` defaults). The worker has its own `sql` (`services/extraction/src/db.ts`) for the upload flip + pg-boss for the enqueue.
- **`ExtractDocumentPayload`** = `{ uploadId, storagePath, idempotencyKey, mimeType }` (see `jobPayload()` in `document-consumer.test.ts`). The script must reconstruct this payload from the `uploads` row columns to re-enqueue.
- **Idempotency:** the consumer's `queued→processing` optimistic transition + the review-queue/observation unique indexes already make a re-run safe end-to-end. The script's own double-enqueue guard: flip `failed→queued` with a `WHERE status='failed'` guard + `RETURNING`; only enqueue when a row was actually flipped (a second script run sees `queued`, flips nothing, enqueues nothing).
- **No live DB / no prod access in the worktree** — the script can't be executed here; the **pure planner logic is unit-tested**, and the DB/pg-boss wiring is exercised operationally (dry-run first).

## Acceptance Criteria

> AC1–AC2 are lifted from `_bmad-output/planning-artifacts/epics.md` L1957–1969 (Story 9.4). AC3–AC6 are implementation-contract ACs locking the safety model (dry-run, timestamp gate), the idempotency guard, and the pure-planner testability — and reconciling the epic's reason _signatures_ with the code's actual stored reasons.

1. **AC1 — Stub-era `failed` uploads are reset to `queued` + re-enqueued (no orphan, no double-enqueue).**
   **Given** uploads in `failed` that failed in the stub era (before `EXTRACTION_ADAPTER=aws` went live — see AC4 for the discriminator),
   **When** the script runs with `--apply`,
   **Then** each matching upload is flipped `failed → queued` (guarded `WHERE status='failed'`) and a fresh `extraction.document` job is enqueued with the reconstructed payload — exactly once per upload (the flip's `RETURNING` gates the enqueue, so a re-run is a no-op).

2. **AC2 — Genuine post-launch failures are NOT re-enqueued.**
   **Given** an upload that failed for a real post-launch reason (e.g. Textract actually ran and returned `no_readable_text`),
   **When** the script runs,
   **Then** it is excluded — because it failed AFTER the `--before` cutoff (the timestamp gate is the primary discriminator; a post-launch real failure has `updated_at >= cutoff`).

3. **AC3 — Dry-run by default; mutation requires explicit `--apply` + `--before`.**
   **Given** this mutates production upload state and enqueues real jobs,
   **Then** the script runs in **dry-run mode by default** — it prints the candidate uploads (id, patient, reason, updated_at) + a count and makes NO writes. Mutation requires BOTH `--apply` AND a `--before <ISO-8601 timestamp>` cutoff; running `--apply` without `--before` exits with a clear error (refuse to mutate without a cutoff). Dry-run may run with or without `--before` (defaulting to "no time bound, show all `failed`") for inspection.

4. **AC4 — The stub-era discriminator (reconcile spec vs reality).**
   **Given** the epic's `NOT_IMPLEMENTED`/`no_fixture`/`no_readable_text` signatures are error messages, not `uploads.metadata.reason` values,
   **Then** the candidate filter is: `status = 'failed'` AND `updated_at < :before` (the aws-launch cutoff — the load-bearing gate) AND `metadata->>'reason' = ANY(:reasons)`, where `:reasons` defaults to the stub-era-plausible stored reasons **`retries_exhausted`, `extraction_unavailable`, `no_readable_text`, `no_publishable_fields`** and is overridable via `--reasons <csv>`. The `--before` cutoff alone guarantees AC2 (post-launch excluded); the reason filter is a defensive secondary narrowing. Document this reconciliation in the script header + Dev Notes.

5. **AC5 — Pure, unit-tested planner; thin DB/pg-boss shell.**
   **Given** no live DB in CI,
   **Then** the arg parsing + per-row candidacy decision live in pure, exported, unit-tested functions (`parseReenqueueArgs(argv)`, `isStubEraFailure(row, opts)`, `toExtractPayload(row)`); the script body only wires `sql` (the flip) + `boss.send` (the enqueue) + logging around them. The unit tests cover: dry-run default, `--apply` without `--before` rejected, the timestamp gate (before/after cutoff), the reason filter (matching/non-matching), and payload reconstruction.

6. **AC6 — Quality gates + scope fence + audit.**
   **Then** `pnpm -w typecheck/lint/format` green; `pnpm --filter @healthtracker/extraction-worker test:unit` green (existing + new planner tests). The script is standalone — it does NOT modify the consumer, adapter, boot gate, mapping, or any auto-run path. Each re-enqueue logs (`uploadId`, old reason) for an operator-auditable trail (AR14); the upload's existing `metadata` is preserved (the flip does not wipe it). No DB schema change.

**Requirements traceability:** FR1 (uploads produce biomarker fields — re-enqueuing lets stub-era uploads finally extract), AR14 (auditable operator action — the script logs every re-enqueue; the re-run itself flows through the normal `extraction.document` audit trail).

---

## Tasks / Subtasks

- [x] **Task 1 — Pure planner helpers (AC4, AC5)**
  - [x] 1.1 Create `services/extraction/src/reenqueue-stub-era.helpers.ts` (pure, no DB/pg-boss imports).
  - [x] 1.2 `parseReenqueueArgs(argv: string[]): { apply: boolean; before: Date | null; reasons: string[] }` — parse `--apply`, `--before <iso>` (validate parseable date else throw), `--reasons a,b,c` (default `DEFAULT_STUB_ERA_REASONS`). Export `DEFAULT_STUB_ERA_REASONS = ['retries_exhausted','extraction_unavailable','no_readable_text','no_publishable_fields']`.
  - [x] 1.3 `isStubEraFailure(row: { status: string; reason: string | null; updatedAt: Date }, opts: { before: Date | null; reasons: string[] }): boolean` — `row.status === 'failed'` AND (`before === null` || `row.updatedAt < before`) AND `row.reason != null && reasons.includes(row.reason)`. (A defensive in-JS mirror of the SQL filter; both the query and this guard must agree.)
  - [x] 1.4 `toExtractPayload(row: { uploadId; storagePath; idempotencyKey; mimeType }): ExtractDocumentPayload` — reconstruct the payload (the `@healthtracker/types` shape). Throw if any required column is null (a `failed` upload should still have them).
  - [x] 1.5 `assertApplyPreconditions({ apply, before })` — throw a clear error if `apply && before === null` (AC3 refuse-to-mutate-without-cutoff).

- [x] **Task 2 — The one-shot script (AC1, AC2, AC3, AC6)**
  - [x] 2.1 Create `services/extraction/src/reenqueue-stub-era.ts` (mirror `enqueue-smoke-test.ts` shape: `WORKER_DATABASE_URL` guard, `new PgBoss(...)`, `try/finally { boss.stop(); process.exit(0) }`). Also open the worker `sql` (`./db.js`) for the upload query/flip.
  - [x] 2.2 Parse args via `parseReenqueueArgs(process.argv.slice(2))`; `assertApplyPreconditions`.
  - [x] 2.3 SELECT candidates: `SELECT id, patient_id, storage_path, idempotency_key, mime_type, metadata->>'reason' AS reason, updated_at FROM uploads WHERE status='failed' AND (${before} IS NULL OR updated_at < ${before}) AND metadata->>'reason' = ANY(${reasons})`. Log the candidate table + count.
  - [x] 2.4 **Dry-run (default):** print candidates + `"DRY RUN — pass --apply --before <iso> to re-enqueue"`; make no writes; exit.
  - [x] 2.5 **`--apply`:** for each candidate, in sequence: `UPDATE uploads SET status='queued', updated_at=now() WHERE id=$id AND status='failed' RETURNING id` (the guard); if a row returned → `boss.send('extraction.document', wrapped)` with `toExtractPayload` + the `JobPayload` envelope (`jobId: randomUUID()`, `correlationId: uploadId`, `patientId`); log `re-enqueued uploadId=… (was reason=…)`. If no row returned (already flipped / raced) → log skip. Tally re-enqueued vs skipped.
  - [x] 2.6 Do NOT wrap the flip + `boss.send` in a single tx (pg-boss is a separate connection) — the `WHERE status='failed'` guard is the idempotency seam: a crash after flip-before-send leaves the upload `queued` with no job, which a re-run will NOT pick up (status no longer `failed`). Document this small risk + the manual remedy (re-run with a wider filter, or the upload sits `queued` harmlessly — the worker won't process a `queued` row with no job, but a future enqueue would). **Acceptable for a one-shot operator tool; documented.**

- [x] **Task 3 — Tests (AC5)**
  - [x] 3.1 `services/extraction/__tests__/reenqueue-stub-era.test.ts` (pure helpers only — no DB):
    - `parseReenqueueArgs`: defaults (dry-run, no before, default reasons); `--apply`; `--before 2026-06-01T00:00:00Z` parsed; `--before garbage` throws; `--reasons a,b` overrides.
    - `assertApplyPreconditions`: `--apply` without `--before` throws; `--apply --before <date>` ok; dry-run without before ok.
    - `isStubEraFailure`: failed+before-cutoff+matching-reason → true; post-cutoff → false (AC2); non-matching reason → false; non-failed status → false; `before=null` → time-unbounded true.
    - `toExtractPayload`: reconstructs the payload; throws on a null required column.
  - [x] 3.2 No DB/pg-boss integration test (no live infra; the script shell is thin and operator-run). Note rationale in the test header.

- [x] **Task 4 — Docs**
  - [x] 4.1 CLAUDE.md "Extraction backend (Epic 9)" stanza: 9.4 ships a one-shot dry-run-default re-enqueue script (`reenqueue-stub-era.ts`) gated on a `--before` cutoff; reason signatures reconciled to actual `uploads.metadata.reason` values. Epic 9 now fully shipped (no deferred items).
  - [x] 4.2 Add a one-line usage note (how to dry-run + apply) to the script header JSDoc; no `docs/env-vars.md` change (reuses `WORKER_DATABASE_URL`).

- [x] **Task 5 — Quality gates (mandatory)**
  - [x] 5.1 `pnpm -w typecheck` green.
  - [x] 5.2 `pnpm -w lint` green (the script reads `process.argv`/`process.env`; no new turbo env vars — `WORKER_DATABASE_URL` already declared. Narrow any catch.).
  - [x] 5.3 `pnpm -w format` clean.
  - [x] 5.4 `pnpm --filter @healthtracker/extraction-worker test:unit` green (existing + planner tests).

---

## Dev Notes

### The scope fence + safety posture

9.4 = a standalone, dry-run-default, operator-triggered one-shot script + a pure unit-tested planner. It does NOT touch the adapter (9.1), boot gate (9.2), consumer (9.3), mapping, or any auto-run/boot path. It is the LAST Epic 9 story — closes the epic. Because it mutates production upload state, the safety rails are non-negotiable: **dry-run by default, `--apply` requires `--before`, idempotent flip-guarded enqueue, every action logged.**

### Reconciling the epic's reason signatures with reality (the key decision)

The epic names `NOT_IMPLEMENTED` / `no_fixture` / `no_readable_text` as stub-era signatures. Two of those are _error messages_ (from the old `awsTextractAdapter` stub throw and the mock's "no fixture" reject) that, after pg-boss retry exhaustion, were stored on the upload as `metadata.reason = 'retries_exhausted'` — NOT as `NOT_IMPLEMENTED`/`no_fixture`. So a reason-only filter using the epic's literal strings would match ZERO rows. The implementation therefore:

- makes the **`--before` timestamp the primary, reliable discriminator** (anything failed before the aws-launch ran on the stub/mock — that's the definition of "stub era"), and
- defaults `--reasons` to the **actual stored values** a stub-era failure plausibly carries (`retries_exhausted`, `extraction_unavailable`, `no_readable_text`, `no_publishable_fields`), overridable.

The operator runs a dry-run first, eyeballs the candidate list, then `--apply --before <launch-ts>`. This is safe even if the reason set is imperfect — the time gate + dry-run catch mistakes. **Surface this reconciliation to Francis** (open question) since the "right" reason set depends on what's actually in prod.

### Existing code to read before writing (READ ALL)

- `services/extraction/src/enqueue-smoke-test.ts` — the one-shot-script shape (boss lifecycle, `WORKER_DATABASE_URL` guard, `try/finally` + `process.exit`).
- `packages/api/src/uploads.ts:108` `enqueueExtractDocument` + `services/extraction/src/index.ts` `createQueue('extraction.document', ...)` — the job envelope (`JobPayload<ExtractDocumentPayload>`) + retry policy (so `boss.send` to the existing queue applies the right defaults).
- `services/extraction/src/state-machine/upload-transitions.ts:115` `applyDeadLetter` — confirms `reason` is on `uploads.metadata` + the `failed` row shape.
- `services/extraction/src/db.ts` — the worker `sql` handle for the SELECT + flip.
- `@healthtracker/types` `ExtractDocumentPayload` / `JobPayload` — the payload shapes to reconstruct.
- `services/extraction/__tests__/document-consumer.test.ts` `jobPayload()` — the exact payload field names.

### Existing behaviour that must be preserved (regression watch)

- **No auto-run:** the script is never imported by `index.ts` or any consumer; it's invoked manually (`tsx src/reenqueue-stub-era.ts ...`). Adding it must not change worker boot.
- **Idempotency / no double-enqueue:** the `WHERE status='failed' RETURNING` guard is the seam — only a row that was actually flipped gets a job. A re-run flips nothing.
- **The re-enqueued job is just a normal `extraction.document`** — it flows through the unchanged consumer (now with the real aws adapter if `EXTRACTION_ADAPTER=aws`), dispatch, and notification paths. No special-casing.
- **`uploads.metadata` is preserved** on the flip (the UPDATE only sets `status`/`updated_at`, doesn't null `metadata`) — the old reason stays for audit.

### Project Structure Notes

- **NEW:** `services/extraction/src/reenqueue-stub-era.ts` (script), `services/extraction/src/reenqueue-stub-era.helpers.ts` (pure planner), `services/extraction/__tests__/reenqueue-stub-era.test.ts`.
- **MODIFIED:** `CLAUDE.md` (Epic 9 stanza — 9.4 shipped, epic complete).
- **NO** consumer/adapter/boot-gate/mapping change, **NO** DB/migration, **NO** `docs/env-vars.md`, **NO** `index.ts`.

### Open questions for Francis (surface at hand-off, do NOT block)

1. **Is 9.4 even needed?** The epic flags it optional ("a single test upload can simply be re-uploaded"). If prod has only a handful of stub-era `failed` uploads, you may prefer to skip running it. The script is built + safe, but running it is your call (dry-run first).
2. **Reason set + cutoff.** The default `--reasons` is my best reconstruction of stub-era stored values (`retries_exhausted` etc.). The real set depends on what's in prod — run the dry-run and adjust `--reasons`/`--before` before `--apply`. If you tell me the actual aws-launch timestamp + the reasons you see in a dry-run, I can harden the defaults.
3. **Crash-window remedy.** Flip-then-send is not transactional across the DB + pg-boss connections (documented in Task 2.6). A crash mid-loop could leave an upload `queued` with no job (harmless — it just sits; a re-run won't re-pick it because status≠failed). If you want belt-and-suspenders, a follow-up could enqueue via the `pgboss.job` INSERT inside the same `sql` tx as the flip (the `enqueueExtractDocument` raw-insert pattern) — flagged, not built (keeps 9.4 mirroring the simpler `boss.send` smoke-test pattern).

### References

- [Source: `_bmad-output/planning-artifacts/epics.md` L1947–1969] Story 9.4 spec (FR1, AR14) + the optional/conditional flag.
- [Source: `packages/api/src/uploads.ts:108`] `enqueueExtractDocument` — the job envelope + queue.
- [Source: `services/extraction/src/state-machine/upload-transitions.ts:115`] `applyDeadLetter` — reason on `uploads.metadata`; the actual stored reason values.
- [Source: `services/extraction/src/enqueue-smoke-test.ts`] The one-shot-script template.

## Dev Agent Record

### Agent Model Used

claude-opus-4-8 (BMad bmad-create-story + bmad-dev-story workflows)

### Debug Log References

- `pnpm -w typecheck` 17/17 · `pnpm -w lint` 15/15 · changed files prettier-clean · `pnpm --filter @healthtracker/extraction-worker test:unit` **120 pass** (15 new in `reenqueue-stub-era.test.ts`).

### Completion Notes List

- Implemented 2026-06-03 on `worktree-story-8-1-operator-review-queue`, stacked on 9.1–9.3 (closes Epic 9).
- **NEW pure planner `reenqueue-stub-era.helpers.ts`** — `parseReenqueueArgs` (`--apply`/`--before`/`--reasons`, validates the date, rejects unknown args), `assertApplyPreconditions` (refuse `--apply` without `--before`), `isStubEraFailure` (status + timestamp gate + reason set), `toExtractPayload` (reconstruct + null-column guard), `DEFAULT_STUB_ERA_REASONS`. No DB/pg-boss/`process.*` — fully unit-tested.
- **NEW one-shot script `reenqueue-stub-era.ts`** — mirrors `enqueue-smoke-test.ts` (WORKER_DATABASE_URL guard, boss lifecycle, `try/finally`). Dry-run by default (prints candidates, no writes); `--apply` flips `failed→queued` guarded by `WHERE status='failed' RETURNING` then `boss.send('extraction.document', …)`. Payload reconstructed BEFORE the flip so a corrupt row is skipped un-flipped. Not imported by `index.ts` — no boot impact.
- **Reconciliation (the key decision):** the epic's `NOT_IMPLEMENTED`/`no_fixture` are error _messages_, not stored `uploads.metadata.reason` values (those are `retries_exhausted` etc. after retry exhaustion). So the `--before` timestamp is the reliable stub-era discriminator (AC2 = post-launch excluded by time); the reason set is a defensive secondary narrowing, overridable. Surfaced as an open question.
- **Safety:** dry-run default + `--apply` requires `--before` + idempotent flip-guard + every action logged (AR14). Documented the non-transactional flip-then-send crash window (harmless: leaves a row `queued` with no job; a re-run won't re-pick it) + the belt-and-suspenders alternative as an open question.
- Scope fence honoured: standalone script only; no consumer/adapter/boot-gate/mapping/`index.ts`/DB change.

### File List

**NEW**

- `services/extraction/src/reenqueue-stub-era.ts`
- `services/extraction/src/reenqueue-stub-era.helpers.ts`
- `services/extraction/__tests__/reenqueue-stub-era.test.ts`

**MODIFIED**

- `CLAUDE.md` (Epic 9 stanza — 9.4 shipped, epic complete)

**NO** consumer/adapter/boot-gate/mapping/`index.ts` change, **NO** DB/migration, **NO** `docs/env-vars.md`.

## Senior Developer Review (AI)

**Reviewed:** 2026-06-03 · **Outcome:** Changes Requested → Addressed · **Method:** 3-layer adversarial (Blind Hunter — diff only; Edge Case Hunter — diff + repo + installed pg-boss/postgres-js source). Because this is a production-state-mutating operator script, the review was held to a high bar. One HIGH + several MED safety findings patched.

### Action Items

- [x] **HIGH — `= ANY(${args.reasons})` was missing the `::text[]` cast** that every other repo call site uses; postgres-js can't infer the array type against the `text` LHS, likely erroring at runtime in `--apply`. **Fix:** `= ANY(${args.reasons}::text[])`. (`reenqueue-stub-era.ts`)
- [x] **MED — flip-then-`send` could permanently strand an upload in `queued` with no job** (a re-run won't heal it, since the guard matches only `failed`). Triggered most likely by **MED — `boss.send` throws if the `extraction.document` queue row doesn't exist** (the script never calls `createQueue`). **Fix:** (a) precheck `boss.getQueue('extraction.document')` before the loop and fail loud if absent (no row flipped); (b) wrap `send` in a try/catch that **compensates** by reverting `queued→failed` (restoring re-runnability) then aborts. (`reenqueue-stub-era.ts`)
- [x] **MED — `process.exit(0)` in `finally` masked every failure** (operator got exit 0 even on a thrown body / partial apply). **Fix:** top-level `catch` logs + sets `process.exitCode = 1`; `finally` exits with the real code. (`reenqueue-stub-era.ts`)
- [x] **MED — the raw `failed→queued` flip left a stale `processing_completed_at`** (set when the upload first failed), which `processing_completed_at IS NOT NULL` "done" logic could misread for an in-flight re-process. **Fix:** the flip now also `SET processing_completed_at = NULL`. (`reenqueue-stub-era.ts`)
- [x] **LOW — `mimeType` was cast to the closed union without validation** (a stale/legacy mime would produce a bad job). **Fix:** `toExtractPayload` checks an `ALLOWED_MIME_TYPES` allowlist and throws (→ row skipped). (`reenqueue-stub-era.helpers.ts`)
- [x] **LOW — `--before` accepted the loose `Date.parse` grammar** (e.g. `2026`, local-time) despite promising ISO-8601 — a sloppy cutoff on a destructive op could widen the window. **Fix:** require an explicit ISO-8601 instant via regex (`…Z`/offset). New tests: `2026`/`2026-06-15` rejected, missing-trailing-value rejected. (`reenqueue-stub-era.helpers.ts`)
- [x] **LOW — test gaps** (missing-trailing `--before`, empty `--reasons`, unsupported mimeType). **Fix:** added those cases. (`reenqueue-stub-era.test.ts`)

### Dismissed / verified (with rationale)

- **Retry/dead-letter policy on the re-enqueued job:** VERIFIED correct. pg-boss v12 `send` JOINs `pgboss.queue` and `COALESCE`s `retryLimit`/`deadLetter`/`retryDelay`/`retryBackoff` from the stored queue config — so the re-enqueued job inherits the worker's `retryLimit:3` + `extraction.dead_letter` routing without the script restating them.
- **Re-processing duplicates:** VERIFIED safe. `dispatchExtractedFields` uses `ON CONFLICT … DO NOTHING` on both observations and review-queue; stub-era uploads wrote zero fields anyway, so re-processing is a clean no-op-or-converge.
- **Patient double-push (the old `failed` push, then a `complete`/`pending_review` push on successful re-process):** inherent to any re-enqueue, not fixable in the flip. **Documented** as an operator-awareness limitation (the operator may wish to message affected patients).
- **No `audit_log` row for the operator's re-enqueue action itself:** acceptable for a one-shot operator script (every action is logged to stdout; the re-run flows through the normal `extraction.document` audit trail).

### Post-patch gates

`pnpm -w typecheck` 17/17 · `pnpm -w lint` 15/15 · changed files prettier-clean · `pnpm --filter @healthtracker/extraction-worker test:unit` **124 pass** (19 in `reenqueue-stub-era.test.ts`). No live DB/pg-boss in CI (the shell is operator-run, dry-run first).
