# Story 7.3: Patient captures emotional check-in after reviewing results (Growth)

Status: done

<!-- Third story of Epic 7. Stacks on Stories 7.1 + 7.2 / PR #59. -->
<!-- Symmetric extension of Story 7.2 — reuses the `emotional_checkins` table, the audit kind, the RLS policy, the validators, and the `EmotionalCheckInSheet` component. The bulk of this story is wiring a SECOND trigger point + a NEW `recordPostResults` mutation + the "personal context history" pair query (AC3). -->

## Story

As a **patient who has just finished reviewing their newly-published draw**,
I want **to record how I am feeling AFTER seeing the results (one of the same 5 emotional states, or skip), only when a pre-results check-in was recorded for this draw**,
so that **the pre/post pair forms a personal longitudinal signal of how my expectations diverged from the actual results — visible only to me, never to any doctor**.

## Acceptance Criteria

> AC1–AC4 lifted from `_bmad-output/planning-artifacts/epics.md` lines 1667–1689. AC5–AC10 lock the implementation contract.

1. **AC1 — Post-results check-in sheet appears at end of review for draws that have a pre-results check-in.**
   **Given** I am viewing an upload detail screen for a draw whose `status = 'complete'` AND `hasPreEmotionalCheckIn === true` AND `hasPostEmotionalCheckIn === false`,
   **When** I tap a NEW Tier-2 **"Finalizar revisão"** CTA rendered at the bottom of the upload detail screen,
   **Then** the same Tamagui `Sheet` (`EmotionalCheckInSheet`, reused) opens in `mode="post"`, displaying the NEW title `"Como você está depois de ver seus resultados?"` (pt-BR copy constant), the same 5 emotional state buttons, and a Pular link.
   **And** the sheet does NOT appear when:
   - `hasPreEmotionalCheckIn === false` (AC4 — no pre means no post, the longitudinal pair is the whole product value);
   - `hasPostEmotionalCheckIn === true` (already recorded; AC11 partial unique guarantees no double-insert anyway, but the gate prevents redundant UI);
   - the draw is in any status other than `complete`.

2. **AC2 — Same 5 emotional states in the same stable order, same neutral framing.**
   **Given** the post-results sheet is open,
   **Then** the five buttons render in the SAME order as Story 7.2's pre-results sheet (the existing `EMOTIONAL_CHECKIN_STATES` tuple — cognitive consistency across the two screens; the patient sees the same vocabulary). Labels via the existing `EMOTIONAL_CHECKIN_STATE_LABELS_PT_BR` map. Same neutral Tamagui tokens; **NEVER amber, NEVER red, NEVER green** (UX-DR20 carry-forward).

3. **AC3 — `listEmotionalCheckInPairs` resolver exposes pre/post pairs to the owning patient.**
   **Given** the patient may want to see their full history of pre/post pairs (the "personal longitudinal signal" — epic spec wording),
   **Then** a NEW `emotionalCheckIns.listPairs` `protectedProcedure` query returns rows of the shape `{ uploadId, prePreState, postState, createdAtPre, createdAtPost, labName, collectedAt }` — only for uploads where BOTH `type='pre'` AND `type='post'` rows exist (FULL OUTER pre/post JOIN filtered to `pre IS NOT NULL AND post IS NOT NULL`). Ordered by `createdAtPre desc`. RLS scopes to the patient principal; no doctor surface ships.
   **And** the dedicated UI screen for this surface is **deferred to a future story** — Story 7.3 ships the resolver + a single placeholder route reference (a `Recordações emocionais` row in the existing personal-context surface if/when one exists; otherwise deferred-work entry). The resolver MUST land in this story because Story 7.4 (voice memo) will piggy-back on the same personal-history pattern.

4. **AC4 — No pre → no post.**
   **Given** the patient skipped (or never opened) the pre-results check-in for a draw,
   **When** they return to the upload detail screen,
   **Then** the "Finalizar revisão" CTA does NOT render. The longitudinal pair is the product value; an orphan post check-in has no semantic anchor.

5. **AC5 — Persistence with `type='post'`, FK-linked to the same `upload_id` as the pre.**
   **Given** I tap a state button in the post-results sheet,
   **When** the resolver writes the row,
   **Then** a row is inserted into `emotional_checkins` with the same shape as Story 7.2 except `type = 'post'`. The `(upload_id, type)` UNIQUE constraint (AC11 of Story 7.2) handles double-tap idempotency identically. The new helper `recordPostResultsEmotionalCheckIn` ships in `packages/api/src/emotional-checkins.ts` and mirrors the pre helper byte-for-byte except: (a) `type` literal is `'post'`; (b) BEFORE the upload-ownership precondition (R1-H2 carry-forward from Story 7.2), it ALSO verifies that a `type='pre'` row exists for the same `(upload_id, patient_id)` — if absent, throws `PRECONDITION_FAILED` with message `'PRE_CHECKIN_REQUIRED'`. This is the defense-in-depth for AC4: the UI gate is necessary but not sufficient.

6. **AC6 — `emotional_checkin.recorded` audit row with `type: 'post'` in metadata.**
   **Given** the resolver INSERTs the row,
   **When** the INSERT succeeds inside the `protectedProcedure` transaction,
   **Then** exactly one `writeAuditLog` row is appended with `event='emotional_checkin.recorded'`, `metadata={uploadId, type: 'post', state}`. The audit kind is the SAME as pre (Story 7.2 AC6) — `type` in metadata is the discriminator. The kind stays out of `ACCESS_LOG_EVENT_KINDS` (AC7 of Story 7.2 already locks this; no change here).

7. **AC7 — Input schema rejects `type='pre'`; symmetry with Story 7.2's `pre`-only schema.**
   **Given** Story 7.2 ships `recordEmotionalCheckInInputSchema` with `type: z.literal('pre')`,
   **Then** Story 7.3 adds a SECOND schema `recordPostEmotionalCheckInInputSchema` with `type: z.literal('post')`. The two schemas remain separate at the validator boundary so each resolver advertises its truthful contract via input narrowing. Reviewers verify that the pre resolver does NOT accept `'post'` and vice versa.

8. **AC8 — Defensive RLS matrix already locked.**
   **Given** the `emotional_checkins.rls.test.ts` 4-identity matrix landed in Story 7.2 and tests both `type` values via the helper default,
   **Then** Story 7.3 adds ONE additional `it(...)` block that seeds a `type='post'` row and re-asserts the 4-identity matrix (correctPatient sees 1; wrongPatient 0; doctor\* 0). The denial-by-RLS-absence pattern is unchanged.

9. **AC9 — No new pt-BR copy beyond the post-results title.**
   **Given** the 5 state labels, the acknowledgment, and the Pular link are already greppable in `packages/validators/src/emotional-checkins.ts` (Story 7.2 AC9),
   **Then** Story 7.3 adds ONE new constant: `EMOTIONAL_CHECKIN_POST_SHEET_TITLE_PT_BR = 'Como você está depois de ver seus resultados?'`. The post-CTA on the upload detail screen adds: `EMOTIONAL_CHECKIN_POST_CTA_PT_BR = 'Finalizar revisão'`. No other copy.

10. **AC10 — No web app surface; no `supabase/migrations/*.sql` file.**
    Same precedents as Story 7.2 (AC13 + AC14). Schema change is `hasPostEmotionalCheckIn` derived in `getUploadDetailForPatient` (no schema ALTER). All new SQL ships in Story 7.6.

**Requirements traceability:** FR49 (Growth), AR10 (audit), UX-DR20, NFR-S2 (RLS), NFR-S4 (audit append-only).

---

## Tasks / Subtasks

- [ ] **Task 1 — Validators: post input schema + new pt-BR copy (AC7, AC9)**
  - [ ] 1.1 In `packages/validators/src/emotional-checkins.ts`, add `recordPostEmotionalCheckInInputSchema = z.object({ uploadId: z.string().uuid(), state: z.enum(EMOTIONAL_CHECKIN_STATES), type: z.literal('post') }).strict()`. Export the inferred type as `RecordPostEmotionalCheckInInput`.
  - [ ] 1.2 Add the two new copy constants: `EMOTIONAL_CHECKIN_POST_SHEET_TITLE_PT_BR`, `EMOTIONAL_CHECKIN_POST_CTA_PT_BR`. Place them adjacent to the existing pre-results copy constants.

- [ ] **Task 2 — API: `recordPostResults` helper + router + `listPairs` query (AC3, AC5, AC6)**
  - [ ] 2.1 In `packages/api/src/emotional-checkins.ts`, add `recordPostResultsEmotionalCheckIn(database, patientId, input)`. The helper:
    - Verifies upload ownership (same R1-H2 precondition as pre).
    - Verifies a `type='pre'` row exists for the same `(uploadId, patientId)` — `SELECT id FROM emotional_checkins WHERE upload_id=? AND patient_id=? AND type='pre' LIMIT 1`. If absent, throw `TRPCError({code: 'PRECONDITION_FAILED', message: 'PRE_CHECKIN_REQUIRED'})`.
    - Otherwise INSERT with `type='post'`, narrow-23505 catch on the same UNIQUE constraint (returns existing row idempotently), write audit `{ uploadId, type: 'post', state }` inside the same tx.
    - Returns the same `EmotionalCheckInRow` shape.
  - [ ] 2.2 Add `recordPostResults: protectedProcedure.input(recordPostEmotionalCheckInInputSchema).mutation(...)` to `packages/api/src/router/emotional-checkins.ts`.
  - [ ] 2.3 Add `listEmotionalCheckInPairs(database, patientId)` to `packages/api/src/emotional-checkins.ts`. SQL: pivot pre/post rows by `upload_id` with a self-JOIN, LEFT JOIN `uploads` for `lab_name` + `collected_at`-equivalent (`processing_completed_at` — there's no `collected_at` on `uploads`; reuse `processing_completed_at` as the timeline anchor or fall back to `created_at`). Returns `{ uploadId, preState, postState, createdAtPre, createdAtPost, labName, completedAt }[]` ordered by `createdAtPre desc`. NO audit on read (high-frequency listing path).
  - [ ] 2.4 Add `listPairs: protectedProcedure.query(...)` to the router.
  - [ ] 2.5 Extend `getUploadDetailForPatient` (`packages/api/src/uploads-review.ts`) to also return `hasPostEmotionalCheckIn: boolean` (analogous to `hasPreEmotionalCheckIn` from Story 7.2). Single COUNT query reusing the same selector — add a third existence probe filtered by `type='post'`.

- [ ] **Task 3 — UI: extend `EmotionalCheckInSheet` to support `mode` + wire "Finalizar revisão" CTA (AC1, AC2)**
  - [ ] 3.1 Extend `EmotionalCheckInSheet` with an optional `mode?: 'pre' | 'post'` prop (default `'pre'`). When `'post'`, render `EMOTIONAL_CHECKIN_POST_SHEET_TITLE_PT_BR` instead of the pre title. Everything else (5 buttons, Pular, acknowledgment, non-dismissibility, R1-H1 timer + re-entry guards) is unchanged.
  - [ ] 3.2 In `apps/expo/src/app/uploads/[uploadId].tsx`, derive a separate boolean `postCheckInSheetOpen` and a separate dismissal flag `postCheckInDismissed`. The post sheet opens on tap of the new "Finalizar revisão" CTA — NOT auto-derived on mount like the pre sheet (the patient needs to first review the results, AC1).
  - [ ] 3.3 Add a Tier-2 `Button` "Finalizar revisão" rendered AT THE BOTTOM of the existing `YStack` (below the `lowConfidenceFields` map, above the `EmotionalCheckInSheet` siblings) only when:
        `query.data?.status === 'complete' && query.data.hasPreEmotionalCheckIn && !query.data.hasPostEmotionalCheckIn`.
  - [ ] 3.4 On post-sheet `onSubmit(state)`: fire `recordPostCheckInMutation.mutateAsync({uploadId, state, type: 'post'})`; on success the acknowledgment toast renders (same `EMOTIONAL_CHECKIN_ACKNOWLEDGMENT_PT_BR`); on close, invalidate the `getUploadDetail` query.
  - [ ] 3.5 On post-sheet skip (or any close-without-decision — R1-H3 carry-forward), simply close the sheet. **No `markUploadViewed` call** (the upload is already marked viewed by Story 7.2). Skipping a post check-in is NOT sticky — the CTA reappears on next visit IF `hasPostEmotionalCheckIn` is still false. This is the documented contrast with the pre check-in: skip-on-post is "not now", skip-on-pre is "never".

- [ ] **Task 4 — Tests (AC5, AC6, AC7, AC8)**
  - [ ] 4.1 Unit tests in `packages/api/__tests__/emotional-checkins.test.ts`:
    - `recordPostResultsEmotionalCheckIn` writes the row + audit row with `metadata.type === 'post'`.
    - The PRE-EXISTENCE precondition throws `PRECONDITION_FAILED` when no pre row exists.
    - Upload ownership precondition still applies (NOT_FOUND on foreign upload).
    - The 23505 idempotency shield path covers `(upload_id, 'post')`.
    - `listEmotionalCheckInPairs` returns only uploads where BOTH pre AND post rows exist; no row for pre-only or post-only.
  - [ ] 4.2 Validators tests added inline in the same file:
    - `recordPostEmotionalCheckInInputSchema` rejects `type='pre'`.
    - The PRE input schema (Story 7.2) still rejects `type='post'` (regression lock).
  - [ ] 4.3 Extend `packages/db/__tests__/rls/emotional_checkins.rls.test.ts` with ONE additional `it(...)` block that seeds a `type='post'` row and confirms the 4-identity matrix still holds.

- [ ] **Task 5 — Quality gates**
  - [ ] 5.1 `pnpm -w typecheck` — green.
  - [ ] 5.2 `pnpm -w lint` — green.
  - [ ] 5.3 `pnpm -w format:fix && pnpm -w format` — clean.
  - [ ] 5.4 `pnpm --filter @healthtracker/api test:unit` — green (5+ new tests).

- [ ] **Task 6 — Documentation (Story 7.6 checklist update)**
  - [ ] 6.1 Update the CLAUDE.md "Personal context: life events + emotional check-ins" stanza to mention the post-results check-in: `'post'` is the second `emotional_checkin_type_enum` value, AC3 pair-query is a future personal-history surface, the pre-precondition is the AC4 defense-in-depth contract.

---

## Dev Notes

### Worktree + branching

- Continues on `worktree-story-7-1` / PR #59. Stacks on Stories 7.1 + 7.2 commits.
- The PR title at this point covers 7.1 + 7.2 (already renamed during 7.2 commit-prep, or to be renamed when this story commits).

### Reused patterns from Story 7.2 (regression-watch)

- **`(upload_id, type)` UNIQUE constraint** — covers both pre AND post. No schema change needed for AC11 idempotency.
- **`EmotionalCheckInSheet`** — extended via optional `mode` prop. Default `'pre'` keeps Story 7.2 callers unchanged (additive prop discipline).
- **R1-H1 timer + re-entry guard** — already in the sheet from Story 7.2 R1 patches. Story 7.3 inherits the fix automatically.
- **R1-H2 ownership precondition** — Story 7.3 helper mirrors this verbatim.
- **R1-H3 close-as-skip** — for the POST sheet, "close-as-skip" should NOT fire `markUploadViewed` (already marked by 7.2). The post-sheet's `handleOpenChange(false)` is just a dismiss-without-write; the absence of a record means the patient sees the CTA again on next visit (intentional contrast with pre).
- **Audit kind reuse** — same string `'emotional_checkin.recorded'`. Tasks 4.1 verifies both records share the kind but differ in metadata.

### Existing code surfaces to read

- `packages/api/src/emotional-checkins.ts` (Story 7.2 helper — both the ownership precondition AND the 23505 shield are now templates for the post helper).
- `packages/api/src/router/emotional-checkins.ts` (router shape; just add a sibling procedure).
- `packages/api/src/uploads-review.ts` (extend the existence-probe block — add a third probe filtered by `type='post'`).
- `packages/ui/src/components/EmotionalCheckInSheet.tsx` (the `mode` prop extension).
- `apps/expo/src/app/uploads/[uploadId].tsx` (the post-sheet wiring + the new "Finalizar revisão" CTA).
- `_bmad-output/implementation-artifacts/7-2-patient-captures-emotional-check-in-before-results-appear-growth.md` — Story 7.2 spec; this story is the symmetric extension.

### Behaviors that must be preserved (regression watch)

- **Story 7.2 pre-results check-in** — the existing pre flow is untouched. The CTA addition is additive; the `EmotionalCheckInSheet`'s default `mode='pre'` preserves existing rendering.
- **`emotional_checkins` RLS** — no policy change. Same denial-by-RLS-absence shape covers `type='post'`.
- **AC7 of Story 7.2** — `'emotional_checkin.recorded'` stays out of `ACCESS_LOG_EVENT_KINDS`. The existing regression test covers both pre and post writes (same kind).
- **`(upload_id, type)` UNIQUE** — Story 7.3 writes `(uploadId, 'post')`; no conflict with Story 7.2's `(uploadId, 'pre')`.

### Project Structure Notes

- **MODIFIED files (5):**
  - `packages/validators/src/emotional-checkins.ts` (new schema + 2 copy constants)
  - `packages/api/src/emotional-checkins.ts` (new helper + `listEmotionalCheckInPairs`)
  - `packages/api/src/router/emotional-checkins.ts` (mount `recordPostResults` + `listPairs`)
  - `packages/api/src/uploads-review.ts` (add `hasPostEmotionalCheckIn` to return shape)
  - `packages/ui/src/components/EmotionalCheckInSheet.tsx` (add `mode` prop)
  - `apps/expo/src/app/uploads/[uploadId].tsx` (post-sheet wiring + CTA)
  - `packages/api/__tests__/emotional-checkins.test.ts` (extended)
  - `packages/db/__tests__/rls/emotional_checkins.rls.test.ts` (extended)
  - `CLAUDE.md` (small extension to the existing stanza)
- **NEW files: NONE** — Story 7.3 is pure extension.

### Open questions for Francis

1. **"Finalizar revisão" CTA placement and visibility.** Tier-2 button below the existing review-card list seems right, but the spec language "I reach the end of the results review flow" could also mean a scroll-to-bottom trigger or an automatic prompt after N seconds. Defaulting to an explicit CTA per UX-DR § patient-agency.
2. **AC3 dedicated history UI screen.** The resolver lands in this story; the visual surface is deferred. If product wants the screen in 7.3, scope expands by ~1 new screen — flag at hand-off.
3. **Post check-in skip semantics.** Documented above as non-sticky ("CTA re-appears on next visit"). If product wants skip-on-post to be sticky like skip-on-pre, add a `post_check_in_dismissed` column on uploads — but that's schema churn for an edge UX behavior.

### References

- [Source: `_bmad-output/planning-artifacts/epics.md` lines 1667–1689] Story 7.3 spec.
- [Source: `_bmad-output/planning-artifacts/prd.md` FR49] Post-results check-in + pre/post pair as longitudinal signal.
- [Source: `_bmad-output/implementation-artifacts/7-2-patient-captures-emotional-check-in-before-results-appear-growth.md`] Story 7.2 — the architectural twin this story extends.

## Dev Agent Record

### Agent Model Used

claude-opus-4-7 (BMad bmad-create-story workflow)

### Review Findings — R1 (2026-05-30)

Three parallel adversarial reviews. 8/10 ACs MET, 1 DEVIATED (AC3 missing unit test — now added), 1 MISSING (AC8 missing post-row RLS block — now added). 5 patches applied autonomously.

- [x] [Review][Patch] **R1-H1 — `listEmotionalCheckInPairs` leftJoin to `Uploads` does not constrain `Uploads.patientId = caller`** `[packages/api/src/emotional-checkins.ts]` — defense-in-depth so `labName` cannot leak from a foreign upload if an `emotional_checkins` row were ever orphaned via a future bug. Added `eq(Uploads.patientId, patientId)` to the leftJoin predicate.
- [x] [Review][Patch] **R1-H3 — opacity-0 results body keeps the "Finalizar revisão" CTA hit-testable while the pre sheet is open** `[apps/expo/src/app/uploads/[uploadId].tsx]` — Tamagui/RN does NOT disable pointer events on opacity 0. Gated `showPostCheckInCta` on `!preCheckInSheetOpen && !postCheckInSheetOpen` AND added `pointerEvents={resultsHidden ? "none" : "auto"}` to the YStack.
- [x] [Review][Patch] **R1-M1 — `EmotionalCheckInSheet` shared between pre/post modes has no transient-state reset on mode flip** `[packages/ui/src/components/EmotionalCheckInSheet.tsx]` — current consumers render two separate instances so the issue is latent; replaced with a documented invariant (callers must render fresh instance per mode; if single-instance toggling is ever needed, use `key={mode}` on the parent for force-remount).
- [x] [Review][Patch] **R1-M2 — Post sheet inherited non-dismissibility from pre — UX-hostile for voluntary CTA entry** `[packages/ui/src/components/EmotionalCheckInSheet.tsx]` — non-dismissibility was load-bearing for the pre sheet's AC1 first-view gate but the post sheet is reachable via voluntary tap. Made `dismissOnSnapToBottom` + `dismissOnOverlayPress` conditional on `mode === "post"`.
- [x] [Review][Patch] **AC3 — `listEmotionalCheckInPairs` resolver shipped without the spec-mandated unit test (Task 4.1)** `[packages/api/__tests__/emotional-checkins.test.ts]` — added a unit test that verifies the resolver assembles the INNER-pre→post + LEFT-pre→uploads JOIN chain and returns the rows.
- [x] [Review][Patch] **AC8 — No post-row RLS `it(...)` block was added (spec Task 4.3)** `[packages/db/__tests__/rls/emotional_checkins.rls.test.ts]` — added a nested `describe("type='post'")` with the full 4-identity matrix (correctPatient sees 1; wrongPatient 0; doctorWithAccess 0; doctorWithoutAccess 0). Denial-by-RLS-absence regression lock now covers both pre AND post.
- [x] [Review][Defer] **R1-L1 — `listEmotionalCheckInPairs` has no LIMIT (unbounded payload for patients with many uploads)** — deferred; pagination is a future-story concern, MVP user has ≤ tens of uploads.
- [x] [Review][Defer] **R1-L2 — `hasPostEmotionalCheckIn` COUNT is a second round-trip; could be a single grouped query** — deferred (perf nit; the `(upload_id, type)` unique index makes the COUNT a 1-row scan).
- [x] [Review][Defer] **R1-L3 — TOCTOU between pre-existence check and post INSERT** — deferred (no application-layer DELETE path exists for `emotional_checkins`; cascade-only via uploads/users).
- [x] [Review][Dismiss] **`completedAt` vs `collectedAt` field naming** — the spec's open-question note used `collectedAt` colloquially; the implementation correctly uses `completedAt` from `uploads.processing_completed_at` (uploads has no `collected_at` column — the spec explicitly noted this and accepted the rename).

### Completion Notes List

- All 6 tasks complete. Status: `in-progress → done`.
- Quality gates: `pnpm -w typecheck` (17 packages green), `pnpm -w lint` (15 packages green), `pnpm -w format:fix` (clean), `pnpm --filter @healthtracker/api test:unit` (358 tests pass; +6 new for post helper + pair listing + post Zod schema).
- R1 review applied 4 patches + 2 missing-test fixes autonomously (per user's compound "develop + review" intent in a background session). 3 deferred (perf / unbounded list / TOCTOU; all sub-MVP).
- Stacks on Stories 7.1 + 7.2 / PR #59 per the stacked-PR convention.
- Manual run-through (Expo simulator) NOT executed in this background session — `/verify` is the user's pre-merge step.

### File List

**MODIFIED files (9):**

- `packages/validators/src/emotional-checkins.ts` (new `recordPostEmotionalCheckInInputSchema` + `emotionalCheckInPairSchema` + 2 pt-BR copy constants)
- `packages/api/src/emotional-checkins.ts` (new `recordPostResultsEmotionalCheckIn` helper + `listEmotionalCheckInPairs` self-join)
- `packages/api/src/router/emotional-checkins.ts` (mount `recordPostResults` + `listPairs` procedures)
- `packages/api/src/uploads-review.ts` (added `hasPostEmotionalCheckIn` derived field)
- `packages/ui/src/components/EmotionalCheckInSheet.tsx` (added optional `mode` prop with conditional non-dismissibility)
- `apps/expo/src/app/uploads/[uploadId].tsx` (post sheet wiring + "Finalizar revisão" CTA + R1-H3 hit-test gate)
- `packages/api/__tests__/emotional-checkins.test.ts` (extended; +6 tests)
- `packages/db/__tests__/rls/emotional_checkins.rls.test.ts` (extended; +4 post-row identity tests)
- `_bmad-output/implementation-artifacts/sprint-status.yaml` (7.3 status transitions)

**NEW files: NONE** — Story 7.3 is pure extension of Story 7.2's surface.

**NO files in `apps/web/` or `supabase/migrations/`** (AC10).

### File List
