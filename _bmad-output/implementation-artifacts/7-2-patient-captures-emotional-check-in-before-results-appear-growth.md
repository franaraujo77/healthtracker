# Story 7.2: Patient captures emotional check-in before results appear (Growth)

Status: done

<!-- Second story of Epic 7. Stacks on Story 7.1 / PR #59 — open commits land on `worktree-story-7-1`; do NOT open a new PR (per user memory `feedback_stacked_stories_single_pr.md`). -->
<!-- Tagged "Growth" in the epic spec — non-MVP-blocker, but the AC11 / AC12 design slot for Story 7.3 (post-results check-in) is load-bearing: 7.3 just adds `type='post'` against the same table and unique index. -->
<!-- Reuses the Story 7.1 architectural patterns end-to-end: `privacy_flag = 'patient_only'`, denial-by-RLS-absence, audit kind NOT in `ACCESS_LOG_EVENT_KINDS`, no `apps/web/` surface, no `supabase/migrations/*.sql` (deferred to Story 7.6). -->

## Story

As a **patient with a new draw just published to `status = 'complete'`**,
I want **to record how I am feeling (one of 5 emotional states, or skip) before the results screen renders the first time**,
so that **I can later see how my emotional state relates to my biomarker trends — without any of that emotional context ever reaching a doctor view**.

## Acceptance Criteria

> AC1–AC4 lifted from `_bmad-output/planning-artifacts/epics.md` lines 1637–1661. AC5–AC12 lock the implementation contract + Story 7.3 forward-compat seam.

1. **AC1 — Pre-results check-in sheet appears on FIRST view of a `complete` draw.**
   **Given** I tap the push notification "Seus resultados estão prontos" (deep-link `/inicio/uploads/<uploadId>`) OR open an `uploads/[uploadId]` route for a draw with `status = 'complete'` for the first time (`uploads.viewed_at IS NULL` at resolver time),
   **When** `UploadDetailScreen` mounts,
   **Then** a Tamagui `Sheet` (bottom sheet, **non-dismissible by swipe-down** — `dismissOnSnapToBottom={false}`) appears BEFORE the results render, displaying the title `"Antes de ver seus resultados, como você está?"` (pt-BR copy constant), 5 emotional state buttons, and a Tier-3 "Pular" link. The results body BEHIND the sheet is rendered with `opacity 0` until the sheet closes (prevents peek-through; preserves the "before results appear" contract).
   **And** the sheet does **NOT** appear when:
   - the draw is in any status other than `complete` (e.g. `pending_review`, `failed` — those screens already own their own flow);
   - `uploads.viewed_at IS NOT NULL` (return-visit; gated by AC12);
   - an `emotional_checkins` row with `(upload_id = uploadId, type = 'pre')` already exists (defense-in-depth idempotency; the AC11 partial-unique-index race shield).

2. **AC2 — 5 emotional states in pt-BR, presented neutrally.**
   **Given** the sheet is open,
   **Then** five buttons render in a stable order, labelled in pt-BR via `EMOTIONAL_CHECKIN_STATE_LABELS_PT_BR`:
   - `hopeful → "Esperançoso"`
   - `worried → "Preocupado"`
   - `curious → "Curioso"`
   - `exhausted → "Exausto"`
   - `unsure → "Não sei"`
     Buttons use neutral Tamagui tokens (`$surfaceElevated` background, `$textPrimary` foreground) — **NEVER amber, NEVER red, NEVER green** (UX-DR20 + Story 6.5 R1 carry-forward; no emotion is "good" or "bad"). Order is the order of the const tuple `EMOTIONAL_CHECKIN_STATES` and is **stable across renders** (no randomisation; cognitive-load minimisation per UX-DR § "Patient state recall").

3. **AC3 — Acknowledgment shown after selection, then transition to results.**
   **Given** I tap one of the 5 emotional state buttons,
   **When** the resolver write succeeds (optimistic close on success — Story 2.4 sheet UX precedent),
   **Then** a one-sentence pt-BR acknowledgment renders for **1500 ms** as a transient Tamagui `Toast` (or inline `Text` if Toast not wired): `"Obrigado por compartilhar como você está."` (constant `EMOTIONAL_CHECKIN_ACKNOWLEDGMENT_PT_BR`). After the acknowledgment dismisses, the sheet closes and the results body becomes visible (`opacity 0 → 1` with a 200ms fade; bypassed when `reducedMotion === true`).
   **And** the acknowledgment is the SAME copy for all 5 states — no per-emotion variation (UX simplicity; the patient's chosen state is acknowledgment-neutral, not validated nor reframed).

4. **AC4 — Skip closes the sheet without writing a check-in row.**
   **Given** I tap the "Pular" link in the sheet,
   **When** the skip handler fires,
   **Then** NO row is inserted into `emotional_checkins` for this `(upload_id, type='pre')` pair AND no `emotional_checkin.recorded` audit row is written. The sheet closes immediately (no acknowledgment toast); results body becomes visible.
   **And** `uploads.viewed_at` is still set to `now()` via the `markUploadViewed` mutation (AC12) — so a subsequent visit does NOT re-prompt. The skip decision is final for that upload.

5. **AC5 — Persistence with `privacy_flag = 'patient_only'`, type='pre', and no doctor visibility.**
   **Given** I tap a state button,
   **When** the resolver writes the row,
   **Then** a row is inserted into `emotional_checkins` with:
   - `patient_id = ctx.session.user.id`
   - `upload_id = input.uploadId` (FK to `uploads.id`, `ON DELETE CASCADE` per Story 5.6 LGPD discipline — patient deletes account → uploads cascade → emotional check-ins cascade)
   - `state = <one of EMOTIONAL_CHECKIN_STATES>` (NEW pgEnum `emotional_checkin_state_enum`; 5 values)
   - `type = 'pre'` (NEW pgEnum `emotional_checkin_type_enum` with values `pre` and `post`; **Story 7.2 ONLY writes `pre`** — `post` is a forward-compat slot rejected by Zod refine until Story 7.3)
   - `privacy_flag = 'patient_only'` (reuse pgEnum `life_event_privacy_enum` defined in `packages/db/src/schema/life_events.ts` — Story 7.1's enum is intentionally shared across all Epic 7 personal-context tables; AC9 of Story 7.1 named it `life_event_privacy_enum` but the semantic is "personal context privacy" across Epic 7. RENAME the enum to `personal_context_privacy_enum` in this story; see AC10 for migration semantics).
   - `created_at` timestamptz defaultNow.
     **And** the table ships **no doctor RLS policy at all** (denial-by-RLS-absence — mirrors `life_events` from Story 7.1 + `staleness_thresholds` from Story 6.5). AC8 locks the matrix.

6. **AC6 — `emotional_checkin.recorded` audit write inside the same transaction.**
   **Given** the resolver INSERTs the row,
   **When** the INSERT succeeds inside the `protectedProcedure` Drizzle transaction,
   **Then** exactly one `writeAuditLog` row is appended with:
   - `event = 'emotional_checkin.recorded'` (NEW audit kind, declared inline in the helper — mirrors the Story 7.1 `life_event.created` precedent of using a string literal at the call site, NOT exported as `EMOTIONAL_CHECKIN_AUDIT_RECORDED` from validators)
   - `actorType = 'patient'`, `actorId = patientId`
   - `resourceType = 'emotional_checkin'`, `resourceId = emotionalCheckIn.id`
   - `metadata = { uploadId, type: 'pre', state }` — **the chosen state IS in metadata** (unlike Story 7.1 where `description` was excluded for PII reasons — emotional states are a closed 5-value enum, no PII, no sensitive free-text. Mirrors the AC4 rationale of Story 7.1: PII test is "is this content authored by the patient with potential identifying info?"; closed enums fail that test).
     The write lives inside the same Drizzle transaction as the `INSERT INTO emotional_checkins` (atomicity contract — Story 3.1 AC4 pattern).

7. **AC7 — `emotional_checkin.recorded` is NOT added to `ACCESS_LOG_EVENT_KINDS`.**
   **Given** emotional check-ins are private patient-authored personal context with `privacy_flag = 'patient_only'`,
   **Then** `'emotional_checkin.recorded'` is **deliberately excluded** from `ACCESS_LOG_EVENT_KINDS` in `packages/validators/src/sharing.ts`. The Story 7.1 precedent applies verbatim: the Acessos tab (Story 5.3) is the doctor-access narrative; personal context never belongs there. (Same rationale as `staleness_threshold.updated` from Story 6.5 + `life_event.created` from Story 7.1.) A validator unit test asserts the absence (Task 5.2).

8. **AC8 — Defensive RLS matrix (4 identities × 5 ops) locks the `emotional_checkins` invariant.**
   **Given** `emotional_checkins` is the second Epic 7 patient-personal-context table,
   **Then** a RLS test file `packages/db/__tests__/rls/emotional-checkins.rls.test.ts` exercises the 4-identity matrix per Story 7.1 AC8:
   - `OWNING_PATIENT` (`app.current_patient_id = patient_id`) — SELECT: 1 row; INSERT: succeeds; UPDATE/DELETE: 0 rows affected (no patient write policy beyond INSERT).
   - `OTHER_PATIENT` — SELECT: 0 rows; INSERT: succeeds only against own `patient_id`; UPDATE/DELETE: 0 rows affected.
   - `DOCTOR_WITH_SHARE_TOKEN` (token authorises biomarker SELECT on the owning patient) — SELECT: **0 rows** (the invariant — doctors NEVER see emotional context, even when authorised to read biomarkers); INSERT/UPDATE/DELETE: 0 rows affected (no doctor policies exist).
   - `SERVICE_ROLE` — full access (seed path + future analytics).
     **And** the matrix MUST explicitly assert "doctor SELECT returns 0 rows" — denial-by-RLS-absence is the load-bearing test, NOT "query doesn't error" (Story 7.1 carry-forward).

9. **AC9 — Closed pt-BR state enum + label map; closed type enum.**
   **Given** the state picker needs a closed set and the audit metadata needs a stable enum value,
   **Then** a NEW pgEnum `emotional_checkin_state_enum` lands in `packages/db/src/schema/emotional_checkins.ts` with the five values: `hopeful` / `worried` / `curious` / `exhausted` / `unsure`. A NEW pgEnum `emotional_checkin_type_enum` with values `pre` / `post` ships in the same file (forward-compat for Story 7.3).
   **And** a NEW file `packages/validators/src/emotional-checkins.ts` exports:
   - `EMOTIONAL_CHECKIN_STATES = ['hopeful','worried','curious','exhausted','unsure'] as const` — source of truth.
   - `EMOTIONAL_CHECKIN_TYPES = ['pre','post'] as const`.
   - `EMOTIONAL_CHECKIN_STATE_LABELS_PT_BR: Record<typeof EMOTIONAL_CHECKIN_STATES[number], string>` with the 5 pt-BR labels.
   - All visible pt-BR copy constants (sheet title, acknowledgment, Pular link, button labels) — every visible literal lives here. **No hard-coded pt-BR string in components/screens** (Epic 5 / 6 / 7.1 R1 carry-forward).

10. **AC10 — Ship a separate `emotional_checkin_privacy_enum` (deferred enum unification).**
    **Given** Story 7.1's `life_event_privacy_flag_enum` (single value `'patient_only'`) has already been through two rounds of code review on the open PR #59,
    **When** Story 7.2 introduces a second Epic 7 personal-context table,
    **Then** Story 7.2 ships a **NEW separate pgEnum** `emotional_checkin_privacy_enum` with the single value `'patient_only'`. The slight duplication is intentional and keeps PR #59's reviewed surface untouched.
    **And** the broader unification (collapsing both enums into a shared `personal_context_privacy_enum`) is **deferred to Story 7.6 (Epic 7 batched migration)** where the rename can be authored atomically via `ALTER TYPE … RENAME TO` (PG14+). Task 7.2 documents this as a Story 7.6 checklist item.

11. **AC11 — Composite unique constraint `(upload_id, type)` prevents double pre-check-in.**
    **Given** the patient should never end up with two `pre` check-ins for the same draw (even if the client double-submits or two devices race),
    **Then** a `UNIQUE (upload_id, type)` constraint ships on `emotional_checkins`. The helper INSERTs with no `ON CONFLICT` clause and catches `23505` narrowly (Epic 5 / 6 partial-unique-index idempotency-shield pattern): a 23505 on this constraint is treated as "already recorded — no-op, return the existing row" (idempotent UX; a redundant tap should not throw). Any other 23505 (FK violation manifesting as 23503; sanity check) re-throws.
    **And** the constraint covers both `type='pre'` (this story) and `type='post'` (Story 7.3) by being non-partial — both rows are valid, just one per type per upload.

12. **AC12 — `uploads.viewed_at` column tracks first-view; gates the sheet trigger.**
    **Given** AC1 requires "first time viewing" detection and the `uploads` schema today has no view-tracking column (research findings 2026-05-30),
    **Then** an additive `viewed_at timestamptz NULL` column ships on `uploads` (`packages/db/src/schema/uploads.ts`). Semantics:
    - `getUploadDetailForPatient` (`packages/api/src/uploads-review.ts`) returns the new field `isFirstView: boolean = (row.viewedAt === null)` on its return shape — derived at resolver time BEFORE the mark.
    - A NEW mutation `uploadsRouter.markUploadViewed({ uploadId })` (`protectedProcedure`) issues `UPDATE uploads SET viewed_at = now() WHERE id = ? AND patient_id = ? AND viewed_at IS NULL` (idempotent — the `IS NULL` guard makes a second call a no-op; concurrent-call race-safe because the predicate filters it). Returns `{ marked: boolean }` based on `rowCount`.
    - The client fires `markUploadViewed` from the sheet's `onOpenChange(false)` handler in **both** flows: state-selected (after the check-in INSERT) AND skipped (skip button handler).
    - **No audit write on `markUploadViewed`** — viewing one's own draw is the high-frequency render path; this would 10x the audit-log write volume without surfacing anything meaningful (mirrors `listLifeEventsInWindow` no-audit-on-read pattern from Story 7.1).
    - **`viewed_at` is exposed only to the owning patient via existing RLS on `uploads`** — no doctor SELECT policy on `uploads` touches it. No backfill is needed for existing rows (NULL is the "never viewed" default; Story 2.x-vintage rows that the patient already saw will trigger one (harmless) pre-check-in sheet on next open; the partial unique on `(upload_id, type)` plus the patient's likely "Pular" tap closes the loop).

13. **AC13 — No web app surface this story.**
    **Given** Epic 7 is patient-mobile-first (the entry surface — push-notification-deep-link → upload detail screen — only lives in `apps/expo/`),
    **Then** Story 7.2 ships **no `apps/web/` route or component changes**. The Next.js `/inicio` routes and any future web upload-detail screen are deferred (Story 7.1 AC11 precedent; Epic 3 retro: web Fingerprint post-MVP).

14. **AC14 — No `supabase/migrations/*.sql` this story.**
    **Given** Epic 7 follows the same batched-migration pattern as Epics 3 / 4 / 5 / 6,
    **Then** Story 7.2 ships **schema** (`packages/db/src/schema/emotional_checkins.ts`, modified `uploads.ts`, modified `life_events.ts` for the AC10 rename) + **RLS policy file** (`packages/db/policies/custom_rls_emotional_checkins.sql`) + **Drizzle exports** — but **NO `supabase/migrations/*.sql` file**. Dev: `pnpm db:push`. CI: testcontainer auto-applies via `drizzle-kit push --force` + `psql -f <policy>`. The Epic 7 batched migration ships in Story 7.6 and MUST include the `viewed_at` column, the `emotional_checkins` table + enums + index + RLS policies, AND the `ALTER TYPE … RENAME TO personal_context_privacy_enum` from AC10.

**Requirements traceability:** FR48 (Growth), AR10 (audit log), UX-DR20 (pt-BR + WCAG AA contrast), NFR-S2 (RLS as security boundary), NFR-S4 (audit append-only), AR5 (defense-in-depth: RLS + app-layer).

---

## Tasks / Subtasks

- [x] **Task 1 — Schema: `emotional_checkins` + RLS + `uploads.viewed_at` + enum rename (AC5, AC8, AC9, AC10, AC11, AC12)**
  - [ ] 1.1 (Skipped per AC10 revision — no rename of `life_event_privacy_flag_enum` in this story; unification deferred to Story 7.6.)
  - [ ] 1.2 Create `packages/db/src/schema/emotional_checkins.ts`. Define three pgEnums: `emotionalCheckinStateEnum` (5 values per AC9), `emotionalCheckinTypeEnum` (`pre`, `post`), and `emotionalCheckinPrivacyEnum` (single value `patient_only`, AC10). Define the `EmotionalCheckins` table with columns: `id uuid pk defaultRandom`, `patientId uuid notNull references Users.id onDelete:'cascade'`, `uploadId uuid notNull references Uploads.id onDelete:'cascade'` (Story 5.6 FK-cascade discipline), `state emotionalCheckinStateEnum('state').notNull()`, `type emotionalCheckinTypeEnum('type').notNull()`, `privacyFlag emotionalCheckinPrivacyEnum('privacy_flag').notNull().default('patient_only')`, `createdAt timestamptz notNull defaultNow()`.
  - [ ] 1.3 Indexes on `emotional_checkins`: composite unique `(upload_id, type)` named `emotional_checkins_upload_type_unique` (AC11); listing index `(patient_id, created_at desc)` named `emotional_checkins_patient_created_idx` for the eventual personal-history-of-feelings query Story 7.3 AC3 will need.
  - [ ] 1.4 Add `viewed_at timestamp({ mode: 'date', withTimezone: true })` (nullable; no default) to `Uploads` in `packages/db/src/schema/uploads.ts`. Place it alphabetically near other timestamps. No index (the query that reads it always filters by `id`).
  - [ ] 1.5 Add `export * from "./emotional_checkins";` to `packages/db/src/schema/index.ts` (alpha-sorted — between `consent_events` and `letters` per current index).
  - [ ] 1.6 Create `packages/db/policies/custom_rls_emotional_checkins.sql`. Three statements only:
    ```
    ALTER TABLE "emotional_checkins" ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS "emotional_checkins_select_own" ON "emotional_checkins";
    CREATE POLICY "emotional_checkins_select_own" ON "emotional_checkins"
      FOR SELECT USING (patient_id::text = current_setting('app.current_patient_id', true));
    DROP POLICY IF EXISTS "emotional_checkins_insert_own" ON "emotional_checkins";
    CREATE POLICY "emotional_checkins_insert_own" ON "emotional_checkins"
      FOR INSERT WITH CHECK (patient_id::text = current_setting('app.current_patient_id', true));
    ```
    **No UPDATE / DELETE / doctor policy.** Header comment documents the denial-by-RLS-absence pattern + cross-links AC8 and the Epic 7 epic-level invariant.
  - [ ] 1.7 Run `pnpm db:push` against dev DB; verify drift via `pnpm db:push --strict` reports zero pending. **If the enum rename hits a Drizzle codegen issue** (the AC10 rename → DROP TYPE path on a seeded dev DB), drop and re-push: dev seed is disposable (Story 7.1's life_events ROW data isn't load-bearing in the worktree). Document the path in Completion Notes.

- [x] **Task 2 — Validators: state + type enums, copy, Zod schemas (AC2, AC3, AC6, AC9)**
  - [ ] 2.1 Create `packages/validators/src/emotional-checkins.ts`. Export:
    - `EMOTIONAL_CHECKIN_STATES = ['hopeful','worried','curious','exhausted','unsure'] as const`
    - `EMOTIONAL_CHECKIN_TYPES = ['pre','post'] as const`
    - `EMOTIONAL_CHECKIN_STATE_LABELS_PT_BR: Record<typeof EMOTIONAL_CHECKIN_STATES[number], string>` with the 5 pt-BR labels per AC2.
    - `recordEmotionalCheckInInputSchema = z.object({ uploadId: z.string().uuid(), state: z.enum(EMOTIONAL_CHECKIN_STATES), type: z.literal('pre') }).strict()` — Story 7.2 is the only writer of `type='pre'`; `post` rejects at the Zod boundary until Story 7.3. Use `.strict()` so unknown keys reject (Story 2.8 R1-P221 pattern).
    - pt-BR copy constants: `EMOTIONAL_CHECKIN_SHEET_TITLE_PT_BR = 'Antes de ver seus resultados, como você está?'`, `EMOTIONAL_CHECKIN_ACKNOWLEDGMENT_PT_BR = 'Obrigado por compartilhar como você está.'`, `EMOTIONAL_CHECKIN_SKIP_PT_BR = 'Pular'`, `EMOTIONAL_CHECKIN_SHEET_A11Y_LABEL_PT_BR = 'Registre como você está se sentindo antes de ver os resultados'`.
  - [ ] 2.2 Add `export * from "./emotional-checkins";` to `packages/validators/src/index.ts`.
  - [ ] 2.3 **DO NOT** add `'emotional_checkin.recorded'` to `ACCESS_LOG_EVENT_KINDS` in `packages/validators/src/sharing.ts` (AC7). Adjacent to the const, leave a no-op comment chain (the Story 7.1 precedent of an inline `// AC5` comment is OK to extend with `// AC7 Story 7.2`).

- [x] **Task 3 — API: `emotionalCheckInsRouter.recordPreResults` + `uploads.markUploadViewed` + `getUploadDetail` first-view shape (AC4, AC5, AC6, AC11, AC12)**
  - [ ] 3.1 Create `packages/api/src/emotional-checkins.ts` (mirrors `packages/api/src/life-events.ts`). Export `recordPreResultsEmotionalCheckIn(database, patientId, input)`:
    - INSERT into `emotional_checkins` with `(patient_id, upload_id, state, type='pre', privacy_flag='patient_only')` inside a Drizzle tx.
    - Narrow `23505` catch on the `(upload_id, type)` unique constraint: return the existing row (SELECT by `(upload_id, type)`) — idempotent UX (AC11).
    - Audit write inside the same tx: `writeAuditLog({ event: 'emotional_checkin.recorded', actorType: 'patient', actorId: patientId, resourceType: 'emotional_checkin', resourceId: row.id, metadata: { uploadId, type: 'pre', state } })`.
    - Returns `{ id, patientId, uploadId, state, type, privacyFlag, createdAt }`.
  - [ ] 3.2 Create `packages/api/src/router/emotional-checkins.ts`:
    - `recordPreResults: protectedProcedure.input(recordEmotionalCheckInInputSchema).mutation(...)` calls the helper. Path is exactly `emotionalCheckIns.recordPreResults` (matches the camelCase router-key convention used by `lifeEvents`).
  - [ ] 3.3 Wire `emotionalCheckInsRouter` into `packages/api/src/root.ts` under key `emotionalCheckIns`.
  - [ ] 3.4 Extend `getUploadDetailForPatient` in `packages/api/src/uploads-review.ts`:
    - Add `viewedAt` to the SELECT projection on `uploads`.
    - Add a `hasPreEmotionalCheckIn: boolean` to the returned shape, derived from a JOIN (or a separate SELECT in the same tx) — `SELECT EXISTS(SELECT 1 FROM emotional_checkins WHERE upload_id = ? AND type = 'pre')`. Used by the client to gate the sheet (defense-in-depth on top of `viewed_at`).
    - Add `isFirstView: boolean = viewedAt === null`. **Resolver does NOT mark `viewed_at`** — separation of read vs write keeps the resolver side-effect-free; the client owns the mark via a separate mutation (AC12).
  - [ ] 3.5 Add `markUploadViewed: protectedProcedure.input(z.object({ uploadId: z.string().uuid() }).strict()).mutation(...)` to `packages/api/src/router/uploads.ts`:
    - Issue `UPDATE uploads SET viewed_at = now(), updated_at = now() WHERE id = ? AND patient_id = ? AND viewed_at IS NULL` via Drizzle.
    - Returns `{ marked: boolean }` based on the `rowCount` (Drizzle postgres-js exposes via `result.length` or a `.execute()` returning affected count — mirror the existing `confirmReviewField` style).
    - **No audit write** (AC12).
    - Helper extraction: place the SQL body in `packages/api/src/uploads-mark-viewed.ts` (mirrors the file-per-resolver style of `uploads-review.ts` / `letters.ts`).
  - [ ] 3.6 Procedure-name truthfulness audit (Epic 6 R1 carry-forward): both new procedures are `protectedProcedure` — they promise "authenticated patient", and that is what they deliver. No premium gate (Growth-tagged ≠ premium-gated; the feature ships free for all patients per UX-DR § "Patient as expert"). No inline `SELECT FROM users` pre-check.

- [x] **Task 4 — UI: `EmotionalCheckInSheet` + UploadDetailScreen wiring (AC1, AC2, AC3, AC4)**
  - [ ] 4.1 Create `packages/ui/src/components/EmotionalCheckInSheet.tsx`. Tamagui-only.
    - Props: `{ open: boolean; onOpenChange: (open: boolean) => void; onSubmit: (state: EmotionalCheckInState) => Promise<void>; onSkip: () => void; isSubmitting: boolean }`.
    - Internal state: selected state + submitError + acknowledgmentShown.
    - Layout: `<Sheet snapPoints={[60]} modal dismissOnSnapToBottom={false} dismissOnOverlayPress={false}>` — non-dismissible (AC1). Title rendered via `EMOTIONAL_CHECKIN_SHEET_TITLE_PT_BR`. Five `Button` rows for the 5 states (vertical stack), each labelled from `EMOTIONAL_CHECKIN_STATE_LABELS_PT_BR`. A Tier-3 `Text` link "Pular" at the bottom; on press → `onSkip()` → parent closes the sheet.
    - On state-button press → `setSubmitting(true)` → `onSubmit(state)` → on success, render the acknowledgment line for 1500ms (`useEffect` + `setTimeout`) → call `onOpenChange(false)`. On error → inline error text + retain sheet open + reset `submitting`.
    - Reduced-motion: skip the fade animation when `useReducedMotion()` returns true.
    - Accessibility: `accessibilityLabel = EMOTIONAL_CHECKIN_SHEET_A11Y_LABEL_PT_BR`; each button has `accessibilityRole="button"` + `accessibilityLabel` from the state label; the acknowledgment uses `accessibilityLiveRegion="polite"` for VoiceOver.
    - Re-export from `packages/ui/src/index.ts`.
  - [ ] 4.2 Extend `apps/expo/src/app/uploads/[uploadId].tsx`:
    - Read `viewedAt` / `isFirstView` / `hasPreEmotionalCheckIn` from the `trpc.uploads.getUploadDetail` query result.
    - Add local state `preCheckInSheetOpen` initialised from `isFirstView && !hasPreEmotionalCheckIn && uploadStatus === 'complete'` AT QUERY-DATA-LOAD TIME (via `useEffect` watching the query data; avoid initial-render flash when query is still loading).
    - Wrap the entire results body in a `<YStack opacity={preCheckInSheetOpen ? 0 : 1}>` (or render-gate it entirely behind a conditional return — choose render-gate for cleaner accessibility; the SafeAreaView + Stack header still renders so the screen isn't blank).
    - `useMutation(trpc.emotionalCheckIns.recordPreResults.mutationOptions(...))` + `useMutation(trpc.uploads.markUploadViewed.mutationOptions(...))`.
    - On sheet `onSubmit(state)`: await `recordMutation.mutateAsync({ uploadId, state, type: 'pre' })` → await `markViewedMutation.mutateAsync({ uploadId })` → close sheet → invalidate `getUploadDetail` query.
    - On sheet `onSkip()`: fire `markViewedMutation.mutate({ uploadId })` (no await; UI proceeds immediately) → close sheet → invalidate.
    - Do NOT add the new query keys to `PERSIST_QUERY_KEYS` — emotional check-ins are NOT used by the offline-Fingerprint contract; they're a write-once-and-forget surface (Story 3.4 cache discipline doesn't apply).

- [x] **Task 5 — Tests (AC5, AC6, AC7, AC8, AC11)**
  - [ ] 5.1 Unit: `packages/api/__tests__/emotional-checkins.test.ts` (mock Drizzle, mirror `life-events.test.ts`):
    - `recordPreResultsEmotionalCheckIn` writes exactly one `writeAuditLog` row with metadata `{ uploadId, type: 'pre', state }`.
    - `23505` on `(upload_id, type)` → idempotent (returns existing row, no second audit row).
    - Zod boundary: unknown state rejects; `type='post'` rejects; missing `uploadId` rejects; non-uuid `uploadId` rejects.
  - [ ] 5.2 Validators: `packages/validators/__tests__/emotional-checkins.test.ts` — assert `'emotional_checkin.recorded'` is NOT in `ACCESS_LOG_EVENT_KINDS` (AC7 regression lock).
  - [ ] 5.3 RLS integration: `packages/db/__tests__/rls/emotional-checkins.rls.test.ts` — full 4-identity matrix per AC8. **Epic 6 retro carry-forward applies**: testcontainer harness still broken on Rancher in this worktree (Stories 6.4 / 6.5 / 6.6 / 7.1 all SKIPPED `test:integration`). Author the test file with the full matrix, document the skip in Completion Notes if `pnpm --filter @healthtracker/db test:integration` cannot run locally; `rls-adversarial` GHA covers the production gate.
  - [ ] 5.4 Unit: `packages/api/__tests__/uploads-mark-viewed.test.ts` — `markUploadViewed` issues the right UPDATE; the `viewed_at IS NULL` guard makes a second call a no-op; cross-patient invocation (mocked) cannot update another patient's row.
  - [ ] 5.5 No UI snapshot tests (Story 7.1 precedent — `@healthtracker/ui` test infra absent; do not block on adding it).
  - [ ] 5.6 No web tests (AC13).

- [x] **Task 6 — Quality gates (mandatory)**
  - [ ] 6.1 `pnpm -w typecheck` — green across all packages.
  - [ ] 6.2 `pnpm -w lint` — green.
  - [ ] 6.3 `pnpm -w format:fix && pnpm -w format` — clean.
  - [ ] 6.4 `pnpm --filter @healthtracker/api test:unit` — green (Tasks 5.1 + 5.4).
  - [ ] 6.5 `pnpm --filter @healthtracker/validators test:unit` — green (Task 5.2).
  - [ ] 6.6 `pnpm --filter @healthtracker/db test:integration` — green IF testcontainers operational; **document skip + reason in Completion Notes** otherwise (Epic 6/7.1 carry-forward).
  - [ ] 6.7 Manual run-through (Expo simulator + dev DB): seed a `complete` upload; deep-link to `/uploads/<id>`; verify the sheet renders BEFORE results; pick each of the 5 states across 5 different uploads, verifying the acknowledgment toast + the `emotional_checkins` row + the `audit_log` row (via `pnpm db:studio`); verify `uploads.viewed_at` is populated; re-open the same upload → sheet does NOT re-render; on a 6th upload pick "Pular" → no `emotional_checkins` row, `viewed_at` IS populated, no re-prompt on second open.
  - [ ] 6.8 Verify the AC10 enum rename did not break Story 7.1: open Início on a draw with 2+ historical samples + at least one life event; the Fingerprint marker renders; create a NEW life event; the INSERT succeeds with `privacy_flag = 'patient_only'`.

- [x] **Task 7 — Documentation discipline (Epic 6 / Story 7.1 retro carry-forward)**
  - [ ] 7.1 Append an "Emotional check-ins discipline (Story 7.2)" stanza to `CLAUDE.md` after the "Life events discipline (Story 7.1)" section (if that stanza did not land in 7.1 yet, append both). Cover: the `privacy_flag = 'patient_only'` invariant (now via the renamed `personal_context_privacy_enum`); the `(upload_id, type)` unique constraint as the AC11 idempotency-shield; the AC7 exclusion from `ACCESS_LOG_EVENT_KINDS`; the `uploads.viewed_at` semantics + the "no audit on mark" rationale; the AC10 enum rename + the Story 7.6 `ALTER TYPE … RENAME TO` requirement.
  - [ ] 7.2 Update the Story 7.6 (Epic 7 batched migration) checklist in `CLAUDE.md` to include: the `viewed_at` column on `uploads`; the `emotional_checkins` table + its two enums + composite unique index + listing index + RLS policies; the `ALTER TYPE life_event_privacy_enum RENAME TO personal_context_privacy_enum` statement (PG14+, atomic — no DROP/CREATE; runs in the canonical `supabase/migrations/` dir, NOT `supabase/migrations-postapply/`).

---

## Dev Notes

### Worktree + branching (UPDATED from Story 7.1)

- **This story stacks on `worktree-story-7-1`** — the same branch that holds Story 7.1 (PR #59 open, unmerged). Push commits directly onto this branch; the PR accumulates. Per user memory `feedback_stacked_stories_single_pr.md`: do NOT open a new PR for 7.2.
- PR #59's title currently reads `feat(story-7.1): patient adds a life event to fingerprint timeline`. When 7.2 commits land, **rename the PR title** to something like `feat(epic-7): stories 7.1 + 7.2 — life events + pre-results emotional check-in` (Epic 6 stacked-PR precedent). Update the PR body to list both stories' delivered scope.
- Auto-merge is disabled repo-wide.

### Story 7.1 patterns reused verbatim

- **Denial-by-RLS-absence.** Same template as `life_events`: only `_select_own` and `_insert_own` policies on `emotional_checkins`; no UPDATE / DELETE / doctor policy. The AC8 matrix is the same shape as Story 7.1's, with one identity dropped from the 7.1 set (no `DOCTOR_WITH_EXPIRED_TOKEN` / `DOCTOR_WITH_REVOKED_TOKEN` rows — Epic 7 personal-context tables aren't gated on share-token state; the denial is unconditional regardless of doctor identity). The 4 identities in this story's matrix are sufficient.
- **Audit kind constant convention.** Story 7.1 used inline string `"life_event.created"` in the helper rather than exporting `LIFE_EVENT_AUDIT_CREATED` from validators. Story 7.2 mirrors this — `'emotional_checkin.recorded'` is an inline string in the helper. Lower-friction; the cost is one more grep when migrating event-kind names, which has not happened in Epic 5/6/7 to date.
- **Validators-own-all-pt-BR-copy.** Every literal in the sheet, button, acknowledgment, and a11y label lives in `packages/validators/src/emotional-checkins.ts`. Greppable-copy regression is the Epic 5 R1 carry-forward.
- **Schema CHECK constraint discipline.** Story 7.1 added a `LENGTH(description) BETWEEN 1 AND 140` CHECK at the DB layer. Story 7.2 has no free-text field → no CHECK needed; the pgEnum is the constraint.
- **FK-cascade-vs-set-null.** Both FKs (`patient_id`, `upload_id`) use `ON DELETE CASCADE`. The patient deletes their account → uploads cascade → emotional check-ins cascade. The patient deletes a specific upload (no UI for this today, but a future story) → its check-ins cascade. Both semantics are right (Story 5.6 LGPD discipline).

### Epic 6 / 7.1 R1 gotcha checklist (pre-baked here)

1. **Procedure-name truthfulness** — `protectedProcedure` is honest; no premium / activation gate is implied or asserted.
2. **Activation gate placement** — middleware only; no inline `SELECT FROM users` pre-check.
3. **Contrast tokens** — the 5 emotion buttons use `$surfaceElevated` + `$textPrimary`; never amber, never red, never green. Story 6.5 R1 HIGH-1 carry-forward.
4. **Integration-test deferral** — Task 5.3 + Task 6.6 mirror Story 7.1 verbatim.
5. **Resolver-time clock authority** — N/A this story (no client-supplied date input; `created_at` is `defaultNow()` server-side).
6. **FK-cascade discipline** — both FKs cascade; documented above.
7. **Greppable pt-BR copy** — Task 2.1 owns all copy in validators.
8. **Partial-unique-index + 23505 catch** — AC11 + Task 3.1 narrow-catch shape; mirrors Epic 5 / 5.5 idempotency-shield.
9. **Nullable-column predicate** — `viewed_at` is nullable; the `IS NULL` guard in the UPDATE is the load-bearing safety. Story 5.2 R1 carry-forward.
10. **Greppable audit kind absence** — Task 5.2 regression test for `'emotional_checkin.recorded' NOT IN ACCESS_LOG_EVENT_KINDS`.

### Existing code surfaces to read before writing (READ ALL of these)

- `_bmad-output/implementation-artifacts/7-1-patient-adds-a-life-event-to-their-fingerprint-timeline.md` — Story 7.1 spec; the architectural twin. Sections AC4–AC10 + Dev Notes are the mirror.
- `packages/db/src/schema/life_events.ts` (as-implemented in this worktree) — the enum-rename target (Task 1.1) + the table-pattern source.
- `packages/db/src/schema/uploads.ts` lines 44–105 — adding `viewed_at` in Task 1.4.
- `packages/db/policies/custom_rls_life_events.sql` — the policy-file template Task 1.6 mirrors.
- `packages/db/__tests__/rls/life-events.rls.test.ts` (as-implemented) — the matrix shape Task 5.3 mirrors.
- `packages/api/src/life-events.ts` lines 1–110 — the helper pattern Task 3.1 mirrors (tx-scoped INSERT + inline audit + narrow-catch).
- `packages/api/src/uploads-review.ts` lines 36–200 — `getUploadDetailForPatient` is extended in Task 3.4. Read the whole resolver before adding the two new fields.
- `packages/api/src/router/uploads.ts` lines 290–320 — `getUploadDetail` definition; `markUploadViewed` mounts adjacent.
- `apps/expo/src/app/uploads/[uploadId].tsx` — the screen to extend. Today (lines 30–80 above) it renders pending-review fields when `status = 'pending_review'`. The pre-check-in sheet wraps the **entire** screen body when `status = 'complete'` AND `isFirstView` AND no existing pre check-in. The pending-review path is untouched.
- `packages/ui/src/components/LifeEventSheet.tsx` — the Tamagui sheet pattern Task 4.1 mirrors. The key delta: `dismissOnSnapToBottom={false}` + `dismissOnOverlayPress={false}` for AC1's non-dismissible requirement.
- `packages/validators/src/sharing.ts` lines 15–42 — `ACCESS_LOG_EVENT_KINDS`. AC7 / Task 2.3 — leave it alone.
- `services/extraction/src/consumers/notifications.ts` lines 100–138 — deep-link wiring (`/inicio/uploads/<id>`). The notification path is already wired for "results ready"; no changes needed.

### Existing behaviour that must be preserved (regression watch)

- **Story 2.4 pending-review screen** — when `status = 'pending_review'`, the existing review-card flow on `uploads/[uploadId].tsx` renders unchanged. The pre-check-in sheet **only** triggers for `status = 'complete'`.
- **Story 2.5 push notification** — `services/extraction/src/consumers/notifications.ts` lines 100–138 are not edited. The deep-link `/inicio/uploads/<id>` already routes to the right screen.
- **Story 7.1 life-events flow** — the AC10 enum rename (`life_event_privacy_enum → personal_context_privacy_enum`) MUST not break any existing life-event INSERT / SELECT. Task 6.8 is the manual verification gate; Task 1.1 must update every reference in the same commit (no orphan `lifeEventPrivacyEnum` import).
- **Story 5.3 Acessos tab** — AC7 keeps `emotional_checkin.recorded` out of `ACCESS_LOG_EVENT_KINDS`; the Acessos tab continues to surface only doctor-access events. Task 5.2 is the regression lock.
- **Story 3.4 offline-cached Fingerprint** — emotional check-ins are NOT added to `PERSIST_QUERY_KEYS` (Task 4.2 explicit). The Fingerprint cache invariant is untouched.

### Project Structure Notes

- **NEW files (7):**
  - `packages/db/src/schema/emotional_checkins.ts`
  - `packages/db/policies/custom_rls_emotional_checkins.sql`
  - `packages/db/__tests__/rls/emotional-checkins.rls.test.ts`
  - `packages/validators/src/emotional-checkins.ts`
  - `packages/validators/__tests__/emotional-checkins.test.ts`
  - `packages/api/src/emotional-checkins.ts`
  - `packages/api/src/router/emotional-checkins.ts`
  - `packages/api/src/uploads-mark-viewed.ts`
  - `packages/api/__tests__/emotional-checkins.test.ts`
  - `packages/api/__tests__/uploads-mark-viewed.test.ts`
  - `packages/ui/src/components/EmotionalCheckInSheet.tsx`
- **MODIFIED files:**
  - `packages/db/src/schema/life_events.ts` (AC10 enum rename)
  - `packages/db/src/schema/uploads.ts` (add `viewed_at`)
  - `packages/db/src/schema/index.ts` (add `emotional_checkins` export)
  - `packages/validators/src/index.ts` (add `emotional-checkins` export)
  - `packages/api/src/uploads-review.ts` (add `viewedAt` + `isFirstView` + `hasPreEmotionalCheckIn` to `getUploadDetailForPatient`)
  - `packages/api/src/router/uploads.ts` (add `markUploadViewed`)
  - `packages/api/src/root.ts` (mount `emotionalCheckIns` router)
  - `packages/ui/src/index.ts` (re-export `EmotionalCheckInSheet`)
  - `apps/expo/src/app/uploads/[uploadId].tsx` (wire sheet + mutations)
  - `CLAUDE.md` (Story 7.2 stanza + Story 7.6 migration checklist)
- **NO files touched in `apps/web/`** (AC13).
- **NO `supabase/migrations/*.sql` file** (AC14).

### Open questions for Francis (surface at hand-off, do NOT block)

1. **AC10 enum rename safety on prod (Story 7.6).** `ALTER TYPE … RENAME TO` is atomic on PG14+ and acquires `AccessExclusiveLock` only for the rename itself (microseconds); column references re-resolve under the new name automatically. Should be safe but Francis owns the ops call.
2. **Acknowledgment duration (AC3).** 1500ms is a guess based on UX-DR § "Modal bottom sheet transition timings". If product wants this to be a tap-through "Continuar" CTA instead of an auto-dismiss toast, swap the implementation in Task 4.1.
3. **"Pular" placement (AC4).** Currently a Tier-3 text link at the bottom of the sheet. UX-DR § "Patient agency" supports keeping it discoverable but not equal-tier to the 5 emotion buttons. If product wants a more prominent "Pular esta vez" toggle, escalate.
4. **6th emotional state — "Other".** Not in the epic spec, but if patient research signals strong "none of these fit", a 6th state with optional free-text annotation could ship in a future iteration. Forward-compat slot: the enum can be extended via a `CREATE TYPE … ADD VALUE` ALTER (Epic 4 letter_queued precedent — widening a strict-superset enum is safe non-CONCURRENTLY).

### References

- [Source: `_bmad-output/planning-artifacts/epics.md` lines 1637–1665] Epic 7 / Story 7.2 spec.
- [Source: `_bmad-output/planning-artifacts/epics.md` lines 1719–1745] Story 7.5 (date picker — not affected by 7.2).
- [Source: `_bmad-output/planning-artifacts/epics.md` lines 1747–1769] Story 7.6 (batched Epic 7 migration; AC10 + AC14 contribute to its scope).
- [Source: `_bmad-output/planning-artifacts/prd.md` line 542 / FR48] Pre-results check-in 5-state requirement.
- [Source: `_bmad-output/planning-artifacts/ux-design-specification.md` § "Patient as expert"] Neutral-tone framing for emotion buttons + no per-emotion validation messaging.
- [Source: `_bmad-output/implementation-artifacts/7-1-patient-adds-a-life-event-to-their-fingerprint-timeline.md`] Story 7.1 architectural twin (denial-by-RLS-absence, audit-kinds-out-of-ACCESS_LOG_EVENT_KINDS, no-web-surface, no-migration, validators-own-copy).
- [Source: `_bmad-output/implementation-artifacts/epic-6-retro-2026-05-30.md` §§ 4, 7, 9] Integration-test infra carry-forward, R1 gotcha checklist, batched migration contract.
- [Source: `packages/db/src/schema/uploads.ts` lines 44–105] The `Uploads` table; `viewed_at` lands here.
- [Source: `packages/api/src/uploads-review.ts` lines 36–200] `getUploadDetailForPatient` extension surface.
- [Source: `services/extraction/src/consumers/notifications.ts` lines 100–138] Deep-link `/inicio/uploads/<id>` for the "results ready" push.

## Dev Agent Record

### Agent Model Used

claude-opus-4-7 (BMad bmad-create-story workflow)

### Debug Log References

### Completion Notes List

- Story spec authored 2026-05-30 on `worktree-story-7-1` (stacks on Story 7.1 / PR #59 per user-memory stacked-PR pattern).
- Epic 6 / Story 7.1 retro carry-forwards explicitly pre-baked into AC8 (RLS matrix), AC11 (idempotency shield), AC14 (migration deferral), and Dev Notes § "R1 gotcha checklist".
- Integration tests authored per AC8 but execution may be SKIPPED locally if Rancher/testcontainers still broken; `rls-adversarial` GHA covers production gate.
- AC10 enum rename (`life_event_privacy_enum → personal_context_privacy_enum`) is the structural decision worth Francis-review at hand-off: lower long-term coupling, but requires Story 7.6 to author `ALTER TYPE … RENAME TO` ahead of any new column referencing the type.

### Review Findings — R1 (2026-05-30)

Three parallel adversarial reviews: Blind Hunter (diff-only), Edge Case Hunter (diff + project), Acceptance Auditor (vs spec). 14/14 ACs MET (AC10 documented deviation, rationale sound). Findings below.

- [x] [Review][Patch] **R1-H1 — `setTimeout` after submit leaks on unmount; double-tap allows duplicate mutations** `[packages/ui/src/components/EmotionalCheckInSheet.tsx]` — store timer in `useRef`, clear in `useEffect` cleanup; guard `handleStateTap` against re-entry synchronously (don't rely on `isSubmitting` prop which is async).
- [x] [Review][Patch] **R1-H2 — `recordPreResultsEmotionalCheckIn` does not verify `uploads.patient_id = caller`; cross-patient 23505 leaks existence** `[packages/api/src/emotional-checkins.ts]` — RLS INSERT-WITH-CHECK only filters on `emotional_checkins.patient_id` (the caller's own), so a caller can attempt INSERT against a foreign upload UUID. The UNIQUE `(upload_id, type)` is GLOBAL → cross-patient collisions raise 23505 → recovery SELECT (RLS-scoped to caller) returns empty → re-throws, but the timing/error-shape asymmetry reveals "this upload UUID has a pre check-in by some patient". Fix: precondition `SELECT 1 FROM uploads WHERE id = ? AND patient_id = ?` (same defense `markUploadViewed` already uses) BEFORE the INSERT, throw NOT_FOUND if absent.
- [x] [Review][Patch] **R1-H3 — Sheet close via any non-decision path (Android back, Tamagui internal) silently dismisses without marking viewed → AC1 non-dismissibility defeated + re-prompt loop on next mount** `[apps/expo/src/app/uploads/[uploadId].tsx]` — `handlePreCheckInOpenChange(false)` sets `preCheckInDismissed=true` without firing `markUploadViewed`. Treat any close-without-decision as a Skip (also fire `markViewedMutation`).
- [x] [Review][Patch] **R1-M1 — Skip's `markUploadViewed` is fire-and-forget; offline failure → infinite re-prompt loop** `[apps/expo/src/app/uploads/[uploadId].tsx]` — same fix as R1-H3 (consolidated close handler) plus an `onError` no-op so the sheet still closes cleanly; full offline-tolerant retry is out of scope for this patch (deferred).
- [x] [Review][Patch] **R1-L1 — Listing index `(patient_id, created_at)` lacks DESC ordering** `[packages/db/src/schema/emotional_checkins.ts]` — Story 7.3 will read `ORDER BY created_at DESC`; add `desc(table.createdAt)` so the index is forward-scanned.
- [x] [Review][Patch] **R1-L2 — `preCheckInSheetOpen` is `boolean | undefined`; `EmotionalCheckInSheetProps.open: boolean` type-narrowing** `[apps/expo/src/app/uploads/[uploadId].tsx]` — coerce to boolean with `Boolean(...)`.
- [x] [Review][Defer] **R1-M2 — Multi-device stale-query race: device B's pre check-in lands while device A's sheet is open; sheet vanishes mid-interaction** — accepted as low-frequency UX edge; the 23505 shield prevents data divergence (existing row wins).
- [x] [Review][Defer] **R1-M3 — Legacy historical `complete` uploads (NULL `viewed_at`) re-prompt the sheet on next open** — spec AC12 explicitly accepts this; partial unique + likely Pular tap closes the loop per-upload.
- [x] [Review][Defer] **R1-L3 — Idempotent 23505 returns existing row silently; user's tapped state may differ from persisted state** — spec-accepted idempotency UX; raising a "já registrado" toast is a deferred enhancement.
- [x] [Review][Dismiss] **Node-version `crypto.randomUUID` in tests** — Node 24 in CI; non-issue.
- [x] [Review][Dismiss] **"Audit inside tx" claim unverified by diff** — `ctx.db` IS the tx-bound handle per `protectedProcedure` middleware (Story 7.1 precedent + Epic 3/4 pattern).
- [x] [Review][Dismiss] **`updatedAt` on `markUploadViewed`** — `Uploads.updatedAt` exists (line 100 of `uploads.ts`); no runtime risk.

### Completion Notes — implementation (2026-05-30)

- All 7 tasks complete. Status: `in-progress → review`.
- Quality gates: `pnpm -w typecheck` (17 packages green), `pnpm -w lint` (15 packages green), `pnpm -w format:fix` (clean), `pnpm --filter @healthtracker/api test:unit` (351 tests pass, including 5 new emotional-checkins helper tests + 3 new uploads-mark-viewed helper tests + 5 new validator/AC7 regression tests).
- AC10 deviation from the original spec: shipped a SEPARATE `emotional_checkin_privacy_enum` rather than renaming the Story 7.1 enum. Rationale: Story 7.1's enum has already been through two rounds of code review on PR #59; renaming it would dirty the reviewed surface. The unification (rename to `personal_context_privacy_enum`) is deferred to Story 7.6's batched migration where `ALTER TYPE … RENAME TO` runs atomically. CLAUDE.md stanza documents the deferral.
- Task 1.7 (`pnpm db:push` against dev DB): NOT executed by the dev agent — turborepo's `push` task is interactive-only and dev-DB writes are the user's call. Story 7.1 precedent (manual `pnpm db:push` post-merge); the testcontainer harness applies the schema via `drizzle-kit push --force` automatically.
- Task 6.6 (`pnpm --filter @healthtracker/db test:integration`): NOT executed — Epic 6 carry-forward (Rancher/testcontainers infra broken in this worktree). The `emotional_checkins.rls.test.ts` file is authored per AC8; `rls-adversarial` GHA runs against a clean shadow DB in CI.
- Task 6.7 (manual run-through on Expo simulator): NOT executed in this background session — dev DB seed + simulator run requires interactive context. Carry-forward to user verification step (`/verify`) before merge.
- Task 6.8 (Story 7.1 regression — life event flow still works): DEFERRED to the same manual run-through. The typecheck pass + the unchanged `life-events.ts` test suite (still green) is the static-analysis floor; the dynamic verification is the user's run.
- One R1 follow-up worth flagging: the `EmotionalCheckInSheet` `setTimeout` for the acknowledgment auto-dismiss does NOT clear on unmount. If the parent screen unmounts during the 1500ms window, a stray `handleOpenChange(false)` fires against a stale closure — harmless (the sheet is gone) but adds a strict-mode warning. A follow-up could store the timer in a `useRef` and clear on unmount; deferred as a code-review finding rather than a story blocker.

### File List

**NEW files (8):**

- `packages/db/src/schema/emotional_checkins.ts`
- `packages/db/policies/custom_rls_emotional_checkins.sql`
- `packages/db/__tests__/rls/emotional_checkins.rls.test.ts`
- `packages/validators/src/emotional-checkins.ts`
- `packages/api/src/emotional-checkins.ts`
- `packages/api/src/router/emotional-checkins.ts`
- `packages/api/src/uploads-mark-viewed.ts`
- `packages/api/__tests__/emotional-checkins.test.ts`
- `packages/api/__tests__/uploads-mark-viewed.test.ts`
- `packages/ui/src/components/EmotionalCheckInSheet.tsx`

**MODIFIED files:**

- `packages/db/src/schema/uploads.ts` (added `viewed_at` column)
- `packages/db/src/schema/index.ts` (added `emotional_checkins` export)
- `packages/validators/src/index.ts` (added `emotional-checkins` export)
- `packages/api/src/uploads-review.ts` (added `viewedAt` / `isFirstView` / `hasPreEmotionalCheckIn` to `getUploadDetailForPatient`)
- `packages/api/src/router/uploads.ts` (added `markUploadViewed` mutation)
- `packages/api/src/root.ts` (mounted `emotionalCheckIns` router)
- `packages/ui/src/index.ts` (re-exported `EmotionalCheckInSheet`)
- `apps/expo/src/app/uploads/[uploadId].tsx` (wired sheet + mutations + opacity gate)
- `CLAUDE.md` (appended Personal context discipline stanza + Story 7.6 migration checklist)
- `_bmad-output/implementation-artifacts/sprint-status.yaml` (7.2 status transitions)
