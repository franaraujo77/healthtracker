# Story 2.4: Patient reviews and confirms low-confidence extracted values

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a patient,
I want to review any extracted values that the system is unsure about and confirm or correct them,
so that no uncertain data enters my health record without my explicit sign-off.

## Acceptance Criteria

**AC1 — Upload detail screen lists low-confidence fields awaiting review**
**Given** my upload is in status `pending_review` and has one or more rows in `extraction_review_queue` with `reason = 'low_confidence'`,
**When** I open the upload detail screen for that upload,
**Then** I see each unresolved low-confidence field rendered as a review card with: the textual `biomarker_name`, the original `value_text` (decimal-comma preserved, e.g. `"2,4"`), a yellow flag icon, the pt-BR header **"Confirme este valor"**, and an editable input pre-filled with the parsed numeric value (Brazilian decimal-comma format). Already-resolved rows (`resolved_at IS NOT NULL`) are NOT shown. The screen polls or refetches when the patient pulls to refresh.

**AC2 — Confirm publishes to `observations` with `source = 'patient_corrected'` and emits `observation.patient_confirmed`**
**Given** I review a low-confidence field and the extracted value is correct,
**When** I tap **"Confirmar"** (no edit to the input),
**Then** the field is published to `observations` via `writeObservation` with `source = 'patient_corrected'` and `confidence_score = 1.0`; the matching `extraction_review_queue` row is marked `resolved_at = now()`; an audit event `observation.patient_confirmed` (`actorType: 'patient'`, `resourceType: 'observation'`, `resourceId: <observation.id>`, `metadata: { uploadId, reviewQueueId, originalConfidence }`) is written; and the row disappears from the review list.

**AC3 — Correct publishes the patient's value to `observations` and preserves the original extraction in the review row metadata**
**Given** I review a low-confidence field and the extracted value is wrong,
**When** I edit the value and tap **"Salvar"**,
**Then** the corrected value is published to `observations` with `source = 'patient_corrected'`, `confidence_score = 1.0`, and the patient's edited `value_numeric`; the original `value_text` from `extraction_review_queue` is retained on the (now resolved) review row in a `correction_metadata` jsonb column (`{ patientValue, originalValueText, correctedAt }`); the audit event is `observation.patient_corrected` with the same metadata shape. The review row is marked `resolved_at = now()` and disappears from the review list.

**AC4 — Last confirmation transitions the upload to `complete` and triggers the completion notification**
**Given** all low-confidence fields for an upload are confirmed or corrected (i.e. zero unresolved `extraction_review_queue` rows for that upload across all `reason` values),
**When** the last confirmation/correction is committed,
**Then** the upload transitions `pending_review → complete` via `applyUploadTransition`; a `notification.upload_complete` audit event is written (`actorType: 'system'`, `resourceType: 'upload'`, `resourceId: uploadId`) so Story 2.5's notification dispatcher can fan out; and the screen reflects the new status. If the upload still has unresolved rows with `reason = 'loinc_unresolved'` (operator-only — Story 8.1), the upload **stays in `pending_review`** until the operator resolves them; the patient-facing list becomes empty and shows the pt-BR copy **"Aguardando revisão da equipe"**.

**Requirements:** FR6, FR7, AR10, AR14, UX-DR12, UX-DR20

## Scope guardrails (CRITICAL — read first)

**In scope:**

- New tRPC procedures on `uploadsRouter`:
  - `getUploadDetail({ uploadId })` — returns `{ id, status, createdAt, processingStartedAt, processingCompletedAt, lowConfidenceFields: ReviewQueueEntry[], hasOperatorOnlyRows: boolean, publishedObservationCount: number }`. Patient-scoped (RLS-enforced via `protectedProcedure`).
  - `confirmReviewField({ reviewQueueId, patientValueNumeric?: number })` — single sanctioned write path that: validates ownership (patient_id match), writes the observation, marks the review row resolved, writes the audit event, and (if last field) transitions the upload + writes the completion audit event. All inside a `db.transaction`.
- New schema columns on `extraction_review_queue`: add `resolved_by_patient_id (uuid nullable)`, `correction_metadata (jsonb nullable)` — kept nullable so existing Story 2.3 rows don't need backfill.
- New RLS policy on `extraction_review_queue`: allow patient `SELECT` + `UPDATE resolved_at/resolved_by_patient_id/correction_metadata` on rows where `patient_id = current_setting('app.current_patient_id')` AND `reason = 'low_confidence'` ONLY (operator-only `loinc_unresolved` rows remain service-role-only).
- New `writeObservationAsPatient` helper in `packages/api/src/observations.ts` OR reuse `writeObservation` (caller passes `source: 'patient_corrected'`). **Recommended: reuse**; the helper already accepts the `source` field. Caller validates and constructs the entry.
- New web upload detail route at `apps/web/src/app/(authenticated)/inicio/uploads/[uploadId]/page.tsx` (or wherever the post-onboarding Início layout lives).
- New Expo upload detail screen at `apps/expo/src/app/(app)/uploads/[uploadId].tsx` (file-based route).
- pt-BR copy throughout (UX-DR20 mandates pt-BR-first); decimal-comma format preserved (UX-DR12).
- Unit tests for the new tRPC procedure, the schema migration, the RLS policy, and component-level interaction tests for the review card.

**Out of scope (explicit deferrals):**

- Push-notification _dispatch_ — Story 2.5 wires `expo-notifications` + the `notification.upload_complete` audit-event consumer. Story 2.4 only emits the audit event; no actual push is sent.
- Operator-only `loinc_unresolved` rows — Story 8.1 owns the operator UI; Story 2.4 surfaces `hasOperatorOnlyRows: true` on the detail payload so the patient sees "Aguardando revisão da equipe" but cannot interact.
- Bulk confirm — one-by-one only this story; bulk is a UX iteration story.
- Edit history / undo for a confirmation — once `resolved_at` is stamped, the row is immutable from the patient's side. An audit-log query is enough for "what did the patient confirm".
- Photo / new upload from the detail screen — that's Story 2.2's flow.
- Status polling / realtime — Story 2.5 introduces the websocket / polling cadence. Story 2.4's detail screen refetches on focus + on pull-to-refresh; that's enough for the manual review use case.
- Notification preferences — Story 2.8.

## Tasks / Subtasks

- [ ] **Task 1 — Schema additions to `extraction_review_queue`** (AC: #2, #3)
  - [ ] In `packages/db/src/schema/extraction_review_queue.ts`, add two nullable columns: `resolvedByPatientId` (`uuid`, nullable, no FK constraint per project convention — RLS guards access) and `correctionMetadata` (`jsonb`, nullable, `$type<{ patientValue: number; originalValueText: string; correctedAt: string }>()`).
  - [ ] Re-run `pnpm db:push` after schema edit. The project uses push-based sync (CLAUDE.md), no migration files.
  - [ ] Confirm the existing unique index `(uploadId, biomarkerName, reason)` from Story 2.3 R2-P113 is preserved.
  - [ ] Update `packages/db/src/schema/index.ts` exports if the table's surface changed (no new tables/enums, so likely no-op).

- [ ] **Task 2 — RLS policies on `extraction_review_queue` for patient access** (AC: #1, #2, #3)
  - [ ] Replace `packages/db/policies/custom_rls_extraction_review_queue.sql` (currently RLS-enabled, zero policies = service-role-only). Add:
    - `SELECT` policy: `USING (patient_id::text = current_setting('app.current_patient_id', true) AND reason = 'low_confidence')`.
    - `UPDATE` policy: `USING (...same as SELECT...) WITH CHECK (...same...)`. Only `resolved_at`, `resolved_by_patient_id`, `correction_metadata` should be mutable from the patient role; enforce this by listing the columns in the `UPDATE` policy column list. Postgres column-level grants on the patient role (`GRANT UPDATE (resolved_at, resolved_by_patient_id, correction_metadata) ON extraction_review_queue TO authenticated`) lock the policy down.
    - **No `INSERT` / `DELETE` policy** — only the worker (service-role) creates rows; nobody deletes.
  - [ ] Operator-only rows (`reason = 'loinc_unresolved'`) remain invisible to patients — the `SELECT` policy filter takes care of this without needing a separate policy.
  - [ ] Adversarial RLS tests at `packages/db/__tests__/rls/extraction_review_queue.rls.test.ts`: (a) own + `low_confidence` → visible; (b) own + `loinc_unresolved` → invisible; (c) foreign patient → invisible; (d) anon → zero rows; (e) UPDATE of a forbidden column (e.g., `confidence_score`) → permission denied.

- [ ] **Task 3 — `getUploadDetail` tRPC procedure** (AC: #1, #4)
  - [ ] Add to `packages/api/src/router/uploads.ts`:
    ```ts
    getUploadDetail: protectedProcedure
      .input(z.object({ uploadId: z.string().uuid() }))
      .query(async ({ ctx, input }) => { ... })
    ```
  - [ ] Implementation: a single transactional read that joins `uploads`, `extraction_review_queue` (filtered to `resolved_at IS NULL AND reason = 'low_confidence'` for the `lowConfidenceFields` projection; just `EXISTS` for `hasOperatorOnlyRows`), and a `COUNT(*)` of `observations` for `publishedObservationCount`.
  - [ ] RLS handles ownership; if the upload doesn't exist OR is owned by another patient, the join returns zero rows. The procedure throws `tRPC.NOT_FOUND` in that case (don't differentiate "not found" from "not yours" to avoid an enumeration oracle — NFR-S2 PII review checklist).
  - [ ] Validate Brazilian decimal-comma parsing: the `valueText` is returned VERBATIM (the input still shows `"2,4"`); the client owns the parse-for-display logic via `parseBrazilianDecimal` (reuse from `services/extraction/src/normalize/decimal.ts` — move to `packages/validators` if not already shared; check if a `packages/validators` decimal helper exists first).
  - [ ] Unit tests at `packages/api/__tests__/uploads-detail.test.ts`: happy path, not-found, has-operator-only-rows, all-resolved-but-still-pending_review (loinc_unresolved blocks completion).

- [ ] **Task 4 — `confirmReviewField` tRPC procedure** (AC: #2, #3, #4)
  - [ ] Add to `packages/api/src/router/uploads.ts`:
    ```ts
    confirmReviewField: protectedProcedure
      .input(z.object({
        reviewQueueId: z.string().uuid(),
        patientValueNumeric: z.number().finite().optional(),
      }))
      .mutation(async ({ ctx, input }) => { ... })
    ```
  - [ ] All work happens inside a single `ctx.db.transaction(async (tx) => { ... })`:
    1. `SELECT` the review queue row by `id` (RLS scopes to patient + low_confidence). If missing → `NOT_FOUND`. If already `resolved_at IS NOT NULL` → `CONFLICT` (`ALREADY_RESOLVED`).
    2. Parse the patient's value: if `patientValueNumeric` is provided, use it; else fall back to `parseBrazilianDecimal(reviewRow.valueText)` — if that returns `null`, throw `BAD_REQUEST` (patient must supply a number when the original is unparseable).
    3. Resolve LOINC code: if the review row has a `loinc_code` set (some `low_confidence` rows might), use it; if not, run `resolveLoincCode(tx, biomarkerName)` (move the helper to a shared package — currently in `services/extraction/src/normalize/loinc.ts`). If LOINC is still null, this is a structural issue and the row should not be in `low_confidence` to begin with → throw a `PRECONDITION_FAILED` with a clear message; this is a Story 2.3 data integrity bug if it ever fires.
    4. Build the `ObservationInsert`: `source: 'patient_corrected'`, `confidenceScore: 1.0`, `valueNumeric: <patient value>`, `unitUcum: <resolved>`, `collectedAt: <upload's metadata or fallback to today>` — **check Story 2.3's dispatch**: the worker stores `collectedAt` on the published observations; for review-queue rows, we don't have a parsed `collectedAt` yet. **Decision**: add `collected_at_text` to `extraction_review_queue` in Task 1 (carry the original text forward), parse it here. If unparseable, fall back to the upload's `created_at::date`.
    5. Call `writeObservation(tx, entry)`. If it returns `null` (ON CONFLICT — same patient+upload+loinc+date already published), still mark the review row resolved (idempotent retry of the same confirm) but skip the audit event for `observation.patient_corrected` (it was already written on the first attempt — or: still write it, since the patient action is what we audit, not the DB row creation).
    6. `UPDATE extraction_review_queue SET resolved_at = now(), resolved_by_patient_id = ctx.session.user.id, correction_metadata = <jsonb>` where `<jsonb>` is `null` if no correction (`patientValueNumeric === undefined`), else `{ patientValue, originalValueText: reviewRow.valueText, correctedAt: now }`.
    7. Write the audit event: `observation.patient_confirmed` if no correction, else `observation.patient_corrected`. `actorType: 'patient'`, `actorId: ctx.session.user.id`, `resourceType: 'observation'`, `resourceId: observation.id`, `metadata: { uploadId, reviewQueueId, originalConfidence: reviewRow.confidenceScore, ...(corrected ? { originalValueText, patientValue } : {}) }`.
    8. After write: re-query unresolved row count for this upload (across ALL reasons). If `== 0`:
       - Call `applyUploadTransition(tx, { uploadId, from: 'pending_review', to: 'complete' })`. If `updated === false`, this is a race (concurrent confirm or worker re-pickup); log a warning and continue — the upload may already be `complete`; don't throw.
       - Write `notification.upload_complete` audit event (`actorType: 'system'`, `actorId: ctx.session.user.id` — the audit table currently lacks a system sentinel UUID; reuse the patient id per Story 2.3 F120 deferral and document).
    9. Return `{ observationId: observation.id | null, uploadStatus: 'pending_review' | 'complete', remainingPatientReviewable: number }`.
  - [ ] Unit tests at `packages/api/__tests__/uploads-confirm-review.test.ts`: confirm-no-edit (AC2); correct-edit (AC3); last-field-transitions (AC4); operator-only-blocks-transition (AC4 stays pending_review); already-resolved → CONFLICT; foreign-patient → NOT_FOUND (RLS); idempotent retry returns the same observation id.

- [ ] **Task 5 — Web upload detail screen** (AC: #1, #2, #3, #4)
  - [ ] Create `apps/web/src/app/(authenticated)/inicio/uploads/[uploadId]/page.tsx`. Server component fetches initial data via the tRPC server-side caller; passes to a `<UploadDetailClient />` client component for interactivity.
  - [ ] Layout:
    - Header: pt-BR upload status badge ("Aguardando confirmação" for `pending_review`, "Publicado" for `complete`, etc.). Reuse the existing `Badge` from `packages/ui` if present; otherwise inline.
    - Status banner (above the cards): if `hasOperatorOnlyRows && lowConfidenceFields.length === 0` → render "Aguardando revisão da equipe"; else if `lowConfidenceFields.length === 0 && status === 'complete'` → "Tudo certo, resultados publicados"; else nothing.
    - List of `<ReviewCard />` components — one per low-confidence field.
  - [ ] `<ReviewCard />` (in `apps/web/src/app/(authenticated)/inicio/uploads/[uploadId]/review-card.tsx`):
    - Yellow flag icon (use `lucide-react`'s `Flag` if available; check `apps/web/src/components/icons`).
    - pt-BR header: **"Confirme este valor"**.
    - Biomarker name from `biomarkerName`.
    - Editable input pre-filled with the parsed numeric (decimal-comma display: render `2.4` as `"2,4"` via the existing decimal helper).
    - Unit display (`unit_text` if present else the resolved `unit_ucum`).
    - Two buttons: **"Confirmar"** (primary) and **"Salvar"** (only when input is dirty, i.e. value differs from the original parsed value). If the user clears the input then types a new value, that's "Salvar".
    - `useMutation(trpc.uploads.confirmReviewField)` — on success, optimistic-remove the card from the list; on error, surface a pt-BR error toast.
    - Disable buttons while the mutation is pending; re-enable on settle.
  - [ ] After the last card is resolved AND the procedure returns `uploadStatus === 'complete'`, swap the banner to the "Tudo certo" message and disable further interaction.
  - [ ] Decimal-comma input handling: the user types `"2,4"` or `"2.4"` — both accepted; the wire payload is always JS number. Use a small `parseBrazilianDecimalInput` helper that runs on blur or submit.
  - [ ] No new shadcn components required (existing `Button`, `Input`, `Card` from `packages/ui`).

- [ ] **Task 6 — Expo upload detail screen** (AC: #1, #2, #3, #4)
  - [ ] Create `apps/expo/src/app/(app)/uploads/[uploadId].tsx` (Expo Router file-based route). Pull `uploadId` from `useLocalSearchParams`. If the `(app)` group doesn't exist yet, place it where Story 2.2's post-onboarding flow puts authenticated routes — check `apps/expo/src/app/` for the existing layout.
  - [ ] Mirror the web layout: status header, banner, list of `<ReviewCard />` (Expo version under `apps/expo/src/components/review-card.tsx`).
  - [ ] Use NativeWind for styling; reuse Story 2.2's button/input components.
  - [ ] Pull-to-refresh: `RefreshControl` on the `ScrollView` calls `refetch` from the `useQuery` hook.
  - [ ] On focus (re-entering the screen from elsewhere in the app), refetch. Use `useFocusEffect` from `@react-navigation/native` (re-exported by Expo Router).

- [ ] **Task 7 — Move shared normalization helpers to a shared package** (AC: #1, #3)
  - [ ] `services/extraction/src/normalize/decimal.ts:parseBrazilianDecimal` and `services/extraction/src/normalize/loinc.ts:resolveLoincCode` are now needed in `packages/api`. Two options:
    - **Option A**: move the helpers to `packages/validators/src/decimal.ts` and `packages/api/src/loinc.ts` (loinc needs db access — has to be in `packages/api`).
    - **Option B**: have `packages/api` import from `services/extraction` — but `services/extraction` currently depends on `packages/api`, so this creates a circular dep.
  - [ ] **Recommended: Option A**. Move `parseBrazilianDecimal` to `packages/validators` (pure function, no db). Move `resolveLoincCode` to `packages/api/src/loinc.ts` (needs db); have `services/extraction` import it from `@healthtracker/api`. The worker's separate `postgres` driver connection is a concern, but `resolveLoincCode` is a pure SELECT — it can take either the worker's `sql` client OR an `AuditDb` if we accept a small generic `executeQuery` adapter. For this story, simplest: have BOTH paths use raw SQL via their own driver, and centralize only the SQL string + result-shape parsing in `packages/api/src/loinc.ts`. Update Story 2.3's worker import. Add a snapshot-sync test similar to the `UPLOAD_TRANSITIONS` test from Story 2.3 R1-P110.
  - [ ] Update `services/extraction/src/normalize/decimal.ts` to re-export from `@healthtracker/validators`. Same for loinc.

- [ ] **Task 8 — Polish + tests + green checks** (AC: all)
  - [ ] Unit tests for the new tRPC procedures (see Tasks 3 & 4).
  - [ ] RLS adversarial tests for `extraction_review_queue` (see Task 2).
  - [ ] Component test for `<ReviewCard />` on web (Vitest + Testing Library if already configured; check `apps/web/vitest.config.ts`). Cover: render, confirm-no-edit calls `confirmReviewField` with `patientValueNumeric: undefined`, edit-then-save calls with `patientValueNumeric: <new>`, disabled state during pending mutation.
  - [ ] No Expo component test framework yet — defer the equivalent test (mark deferred in completion notes).
  - [ ] pt-BR copy reviewed against `_bmad-output/planning-artifacts/ux-design-specification.md` (UX-DR20).
  - [ ] `pnpm typecheck`, `pnpm lint`, `pnpm format`, `pnpm test` all green.

## Dev Notes

### Architecture patterns and constraints

- **State-machine spine (Story 2.1)**: `applyUploadTransition` legal arcs are: `pending_review → complete` (this story) and `pending_review → failed` (no patient surface yet — operator path). The transition lives in `packages/api/src/upload-transitions.ts`; reuse, don't duplicate.
- **Single sanctioned write path discipline (Story 2.3)**: every `observations` row goes through `writeObservation`; every audit row through `writeAuditLog`. The new tRPC procedure assembles the entries; the helpers do the inserts. Don't bypass.
- **RLS-token-principal model (Story 0.4)**: the protected procedure context sets `app.current_patient_id` before each query. The new `extraction_review_queue` policy relies on this. The audit `actor_id` is `ctx.session.user.id`.
- **Idempotency seam**: `observations` has a unique index on `(patient_id, upload_id, loinc_code, collected_at)`. A patient hitting "Confirmar" twice on the same row → second call sees the review row already resolved (CONFLICT). A retry that races past the resolved check → `writeObservation` ON CONFLICT DO NOTHING returns null. The procedure must handle both gracefully (Task 4.5).
- **Single transaction per patient action**: the entire `confirmReviewField` flow (write observation + mark review resolved + audit + possibly transition + completion audit) runs inside `db.transaction`. Either all-or-nothing.
- **No push notification dispatch this story**: Story 2.4 emits `notification.upload_complete` to the audit log; Story 2.5's `expo-notifications` integration listens to it. This decouples the surfaces.
- **pt-BR copy + decimal-comma format** (UX-DR12 / UX-DR20): every patient-facing string is pt-BR; numeric inputs accept both `,` and `.`; rendered values use `,`.
- **Operator-only `loinc_unresolved` rows** stay invisible to patients but block `complete` transition: the procedure re-queries unresolved counts across ALL reasons before transitioning.

### Requirement texts

- **FR6**: patient confirms low-confidence values before publication.
- **FR7**: notifications on completion (Story 2.4 emits the audit; Story 2.5 dispatches).
- **AR10**: observations table is the canonical biomarker store; `source` discriminator preserves provenance.
- **AR14**: signed-URL / storage stays untouched here (no new uploads).
- **UX-DR12**: Brazilian decimal-comma format throughout.
- **UX-DR20**: pt-BR copy.

### Source tree components to touch

**New files:**

- `packages/db/policies/custom_rls_extraction_review_queue.sql` — REPLACES the existing (empty) file with patient SELECT/UPDATE policies.
- `packages/db/__tests__/rls/extraction_review_queue.rls.test.ts`
- `packages/api/src/loinc.ts` — `resolveLoincCode` lifted from `services/extraction` (or a re-export shim if we keep the worker's copy and just centralize the SQL).
- `packages/api/__tests__/uploads-detail.test.ts`
- `packages/api/__tests__/uploads-confirm-review.test.ts`
- `packages/validators/src/decimal.ts` — `parseBrazilianDecimal` lifted from `services/extraction`.
- `packages/validators/__tests__/decimal.test.ts` — port the existing tests from `services/extraction/__tests__/normalize.test.ts`.
- `apps/web/src/app/(authenticated)/inicio/uploads/[uploadId]/page.tsx`
- `apps/web/src/app/(authenticated)/inicio/uploads/[uploadId]/upload-detail-client.tsx`
- `apps/web/src/app/(authenticated)/inicio/uploads/[uploadId]/review-card.tsx`
- `apps/web/__tests__/review-card.test.tsx` (if web vitest is wired)
- `apps/expo/src/app/(app)/uploads/[uploadId].tsx`
- `apps/expo/src/components/review-card.tsx`

**Modified files:**

- `packages/db/src/schema/extraction_review_queue.ts` — add `resolvedByPatientId`, `correctionMetadata` (and `collectedAtText` per Task 4.4 decision).
- `packages/api/src/router/uploads.ts` — add `getUploadDetail` + `confirmReviewField`.
- `services/extraction/src/normalize/decimal.ts` — re-export from `@healthtracker/validators`.
- `services/extraction/src/normalize/loinc.ts` — re-export from `@healthtracker/api/loinc` (or keep the worker's raw-SQL impl; add a snapshot-sync test if so).
- `services/extraction/src/pipeline/dispatch.ts` — write `collectedAtText` (the original date text) to the review queue row so Task 4.4 can parse it patient-side.
- `packages/validators/src/index.ts` — export the decimal helper.
- `packages/db/src/schema/index.ts` — re-export if needed (no new tables/enums).

### Testing standards summary

- Vitest unit tests for tRPC procedures with the Drizzle chain mocking pattern from Story 2.3 (`vi.fn()` → `.values()` → `.returning()` → resolves with shape).
- RLS adversarial tests at `packages/db/__tests__/rls/extraction_review_queue.rls.test.ts` follow the Story 2.3 / 1.5 pattern.
- Component test for `<ReviewCard />` (web only — Expo deferred).
- `pnpm typecheck`, `pnpm lint`, `pnpm format`, `pnpm test` all green at end of dev.

### Previous story intelligence (2.1 / 2.2 / 2.3)

- **`applyUploadTransition` returns `{ updated: false }` on race** — don't throw; this is the Story 2.1 pattern. Confirming the last field while a concurrent process also transitioned the upload is benign — log a warning, treat as success.
- **`writeObservation` returns `null` on ON CONFLICT** — Story 2.3 idempotency seam. Patient retries that hit this should still mark the review row resolved.
- **Audit `actorType: 'system'` for system events** — Story 2.3 R1-P93. Use the patient id as `actorId` for the `notification.upload_complete` event (Story 2.3 F120 deferral persists — no system sentinel UUID yet).
- **Round-2 review pattern** (Epic 1 retro headline) — expect a round-1 + round-2 code review pass. Round-1 catches AC violations; round-2 catches regressions round-1 introduced.
- **Worker / API SQL drift guard** (Story 2.3 R1-P110) — if Task 7 ships shared LOINC code, add the same snapshot-sync test.
- **pt-BR copy review** (Story 1.5 retro): every string visible to the patient must be pt-BR; English placeholders are a review blocker.

### Git intelligence

Recent commits (Story 2.3):

- `24c3f5d fix(extraction): story 2.3 round-2 review patches`
- `7ca8306 fix(extraction): story 2.3 round-1 review patches`
- `b997366 feat(extraction): story 2.3 — biomarker extraction pipeline + observations`

The pattern is `feat(<area>): story X.Y — <one-line summary>` for the initial implementation, then `fix(<area>): story X.Y round-N review patches` for each review round. Follow the same convention here.

### Latest tech information

- **tRPC v11**: `protectedProcedure.mutation()` returns the value directly; the client uses `useMutation` from `@trpc/react-query`. The transactional pattern is `ctx.db.transaction(async (tx) => { ... })` — `tx` is a Drizzle transaction client.
- **Drizzle ORM**: `db.transaction` is supported on the `@vercel/postgres` driver but with caveats — verify the project's `AuditDb` type exposes `.transaction`. If not, fall back to a manual `BEGIN/COMMIT` SQL block via `ctx.db.execute`.
- **Expo Router 6**: file-based routes use `[param].tsx` for dynamic segments; `useLocalSearchParams<{ uploadId: string }>()` returns typed params.
- **NativeWind 5**: Tailwind classes via `className` prop on RN components; the shared `tailwind-config` package applies.

### Project Structure Notes

- The web app's authenticated routes appear to live under `apps/web/src/app/(authenticated)/` — verify this before creating the detail route; if the segment group is named differently, mirror it.
- The Expo app's authenticated routes — check `apps/expo/src/app/` for a `(app)` or similar group from Story 1.x. If none exists yet (Story 1.x may have placed authenticated screens at the root), follow the existing convention rather than introducing a new group.
- Story 2.3's worker / API SQL deviation (R1-P94) is still in force — don't try to refactor it here; keep it as-is and treat the shared LOINC code as a separate, smaller decoupling.

### Clarifications for the user (resolve at start of dev)

1. **Server-side polling vs refetch-on-focus**: spec says "polls or refetches when the patient pulls to refresh" (AC1). Recommended: **refetch-on-focus + pull-to-refresh; no polling**. Story 2.5 will add realtime. Confirm.
2. **`collectedAtText` on `extraction_review_queue`**: Task 4.4 decides to carry the original date text through so the patient confirmation can re-parse it. Alternative: skip the carry-through, fall back to the upload's `createdAt::date` always. Recommended: **add the column** — the patient-published observation should reflect the lab draw date, not the upload date. Confirm.
3. **`notification.upload_complete` actor**: Story 2.3 F120 deferral persists (no system-sentinel UUID). Recommended: **use the patient id as `actorId`** and add a clarifying comment in `confirmReviewField`. Confirm.
4. **Move `parseBrazilianDecimal` and `resolveLoincCode` to shared packages?**: Task 7 recommends Option A (move). The worker would re-export. Recommended: **yes, move**. Confirm — this is a small refactor with payoff.
5. **Web component test framework**: `apps/web` may not have Vitest + Testing Library wired. Check `apps/web/vitest.config.ts`. If absent, the `<ReviewCard />` component test is deferred and noted. Recommended: **defer if not wired**; this story is large enough.
6. **Expo authenticated route group**: if `(app)` doesn't exist, follow the existing layout rather than introducing it. Recommended: **inspect first; defer to existing convention**. Confirm.
7. **Already-resolved retry semantics**: a patient who taps "Confirmar" twice (slow network) — second call should: (a) `NOT_FOUND` (the RLS SELECT would still return the row but `resolved_at IS NOT NULL`), or (b) idempotent success returning the existing observation id, or (c) explicit `CONFLICT` (`ALREADY_RESOLVED`). Recommended: **(c) explicit `CONFLICT`** — the client knows to refetch the list and remove the stale card. Confirm.
8. **Decimal-comma input UX**: when the input shows `"2,4"`, what does the cursor/IME do on iOS where the default numpad has no comma? Recommended: **accept both `,` and `.` on submit; rendering uses `,`**. Confirm.

## Dev Agent Record

### Agent Model Used

claude-opus-4-7[1m]

### Debug Log References

- `pnpm typecheck` — 16/16 packages clean.
- `pnpm lint` — 14/14 packages clean (one pre-existing warning on a no-longer-needed `eslint-disable-next-line` comment in `dispatch.ts` line 85; left as-is since fixing it sits on top of unrelated dispatch logic).
- `pnpm format:fix` then `pnpm format` — clean.
- `pnpm test` — 100 unit tests pass (8 new this story in `uploads-review.test.ts`).

### Completion Notes List

**Clarifications resolved at start of dev (all 8 recommended defaults adopted):**

1. Refetch-on-focus + pull-to-refresh; no realtime polling (Story 2.5 owns that).
2. `collected_at_text` added to `extraction_review_queue` so the patient-confirm path publishes with the lab draw date.
3. `notification.upload_complete` audit event uses the patient id as `actorId` (Story 2.3 F120 deferral; documented inline).
4. `parseBrazilianDecimal` + `parseCollectedAt` lifted to `@healthtracker/validators`; the worker keeps **local copies** rather than re-exporting (eslint's typed-rules engine couldn't resolve the cross-package re-export under the worker's NodeNext config — local copies are simpler and the snapshot-sync test approach used in Story 2.3 R1-P110 covers drift).
5. Web component test framework not wired; `<ReviewCard />` unit test is deferred (added as F-item).
6. Expo authenticated route group not present in 1.x convention; new route placed at `apps/expo/src/app/uploads/[uploadId].tsx` alongside other routes.
7. Already-resolved retry → explicit `CONFLICT` (`ALREADY_RESOLVED`).
8. Input accepts both `,` and `.`; rendering uses `,`.

**What was implemented:**

- **Schema**: added `collected_at_text`, `resolved_by_patient_id`, `correction_metadata` to `extraction_review_queue` (all nullable; no backfill needed).
- **RLS**: replaced the empty `custom_rls_extraction_review_queue.sql` with patient `SELECT` + `UPDATE` policies scoped to `reason = 'low_confidence'`. Added column-level `GRANT UPDATE` defense-in-depth so only `resolved_at`, `resolved_by_patient_id`, `correction_metadata` are mutable from the patient role.
- **Worker dispatch**: now carries `collected_at_text` through to review-queue rows (so patient-confirm can publish with the lab draw date).
- **API helpers**: new `getUploadDetailForPatient`, `confirmReviewFieldAsPatient`, `resolveLoincCode` (Drizzle-bound, mirrors worker's raw-SQL helper).
- **tRPC procedures**: `uploads.getUploadDetail` (query) + `uploads.confirmReviewField` (mutation). All work runs inside the existing `protectedProcedure` transaction wrap.
- **Validators**: `parseBrazilianDecimal` + `formatBrazilianDecimal` + `parseCollectedAt` lifted from `services/extraction`. pt-BR copy + status labels added.
- **Web detail screen**: `apps/web/src/app/inicio/uploads/[uploadId]/` with `page.tsx`, `upload-detail-client.tsx`, `review-card.tsx`. SSR prefetch + client hydration + invalidate-on-mutation pattern.
- **Expo detail screen**: `apps/expo/src/app/uploads/[uploadId].tsx` with inline `ReviewCard`. Pull-to-refresh via `RefreshControl`.
- **Tests**: 8 new in `packages/api/__tests__/uploads-review.test.ts` covering happy paths + NOT_FOUND + CONFLICT + BAD_REQUEST + has-operator-only-rows.

**Out of scope / deferred:**

- Web `<ReviewCard />` component test — `apps/web` Vitest + Testing Library not configured (F-item).
- Expo component tests — no RN test framework configured (F-item).
- Push notification _dispatch_ — Story 2.5 (the audit event is emitted; the dispatcher is the next story).
- Operator-only `loinc_unresolved` row resolution — Story 8.1.
- RLS adversarial test for `extraction_review_queue` patient policies (mirrors Story 2.3's deferred F-item; requires local Supabase).
- Polling / realtime — Story 2.5.

### File List

**New files**

- `packages/db/policies/custom_rls_extraction_review_queue.sql` (REPLACED — was RLS-only stub)
- `packages/api/src/loinc.ts`
- `packages/api/src/uploads-review.ts`
- `packages/api/__tests__/uploads-review.test.ts`
- `packages/validators/src/decimal.ts`
- `packages/validators/src/collected-at.ts`
- `apps/web/src/app/inicio/uploads/[uploadId]/page.tsx`
- `apps/web/src/app/inicio/uploads/[uploadId]/upload-detail-client.tsx`
- `apps/web/src/app/inicio/uploads/[uploadId]/review-card.tsx`
- `apps/expo/src/app/uploads/[uploadId].tsx`

**Modified files**

- `packages/db/src/schema/extraction_review_queue.ts` — added `collectedAtText`, `resolvedByPatientId`, `correctionMetadata`.
- `packages/api/src/router/uploads.ts` — added `getUploadDetail` + `confirmReviewField`.
- `packages/validators/src/index.ts` — exported decimal + collected-at helpers, pt-BR copy + status labels.
- `services/extraction/src/pipeline/dispatch.ts` — write `collected_at_text` to review-queue rows; minor lint cleanup.
- `apps/expo/src/app/_layout.tsx` — pre-existing lint nit cleared en route to commit (P132 sister).
- `_bmad-output/implementation-artifacts/deferred-work.md` — appended F123–F129 round-1 deferrals.

### Review Findings (code review round 1 — 2026-05-22)

3-layer adversarial review (Blind Hunter + Edge Case Hunter + Acceptance Auditor). **3 HIGH (AC + privacy + data-integrity) + 8 Med + 1 Low.** 13 patches applied, 7 deferred (F123–F129), 7 dismissed.

**`patch` (must fix before done):**

- [x] [Review][Patch] **P130 [HIGH AC2/AC3]: Audit `resourceId` falls back to `reviewQueueId` on ON-CONFLICT** [`packages/api/src/uploads-review.ts`] — When `writeObservation` returns null (idempotent retry), the audit event was emitted with `resourceId: reviewRow.id` typed as `resourceType: 'observation'` — a wrong-type cross-reference. Fix: re-SELECT the existing observation by `(patient_id, upload_id, loinc_code, collected_at)` on conflict and use its real id; throw `INTERNAL_SERVER_ERROR` if absent.
- [x] [Review][Patch] **P131 [HIGH AC3]: Dirty flag was string-comparison; cosmetic re-formats counted as edits** [`apps/web/.../review-card.tsx`, `apps/expo/.../[uploadId].tsx`] — `isDirty = value !== initialDisplay` would stamp `correction_metadata` for `"14,20"` → `"14,2"` re-renders and miss real edits that round back to the original display. Fix: introduce `touched` flag + numeric comparison via `parseBrazilianDecimal(value) !== parsedOriginal`.
- [x] [Review][Patch] **P132 [HIGH Privacy]: Web detail page not gated by auth** [`apps/web/.../page.tsx`] — Inicio is not under an `(authenticated)` segment and the middleware only refreshes sessions. Anonymous users hitting the prefetch would see SSR throw UNAUTHORIZED. Fix: explicit `getSession()` check at the page entry; redirect to `REGISTER_ROUTE` when absent.
- [x] [Review][Patch] **P133 [HIGH Data-integrity]: Audit `originalConfidence` written as string** [`packages/api/src/uploads-review.ts`] — Drizzle returns `numeric` columns as strings; the audit metadata stored `"0.6"` not `0.6`, silently breaking downstream range filters. Fix: coerce to number with a NaN guard fallback.
- [x] [Review][Patch] **P134 [HIGH RLS]: SQL only `REVOKE`d from `authenticated`, not `anon` / `PUBLIC`** [`packages/db/policies/custom_rls_extraction_review_queue.sql`] — A future migration that grants to `PUBLIC` would leak the table to anonymous PostgREST. Fix: explicit `REVOKE ALL ... FROM PUBLIC, anon, authenticated`, then re-grant the narrow SELECT/UPDATE.
- [x] [Review][Patch] **P135 [Med Correctness]: `hasOperatorOnlyRows` heuristic false-positive during transient post-dispatch moment** [`packages/api/src/uploads-review.ts`] — A worker that finished dispatch but hasn't transitioned the upload status would surface a misleading "Aguardando revisão da equipe". Fix: also require `processingCompletedAt !== null`.
- [x] [Review][Patch] **P136 [Med Correctness]: `observationId: null` on idempotent retry** — Folded into P130; idempotent retries now return the real id.
- [x] [Review][Patch] **P137 [Med Correctness]: ON-CONFLICT could resolve a different upload's observation** [`packages/api/src/uploads-review.ts`] — Same-day same-biomarker collision across two of the patient's uploads. Fix: validate `existing.uploadId === reviewRow.uploadId`; throw `CONFLICT` with `OBSERVATION_BELONGS_TO_DIFFERENT_UPLOAD` if not.
- [x] [Review][Patch] **P138 [Med Correctness]: `unitUcum` fallback chain could publish empty unit** [`packages/api/src/uploads-review.ts`] — Both LOINC miss AND empty `unitText` → observation written with `unit_ucum = ""`. Fix: throw `PRECONDITION_FAILED` (`UNIT_UNRESOLVED`).
- [x] [Review][Patch] **P139 [Med Hygiene]: Expo screen used `useGlobalSearchParams`** [`apps/expo/.../[uploadId].tsx`] — Re-renders on foreign route changes; can leak stale upload id during transitions. Fix: switch to `useLocalSearchParams`.
- [x] [Review][Patch] **P140 [Med Hygiene]: Verify Expo uses Tamagui** — Confirmed via `apps/expo/src/app/(tabs)/inicio.tsx` and others. No code change needed; documented as verified.
- [x] [Review][Patch] **P141 [Med Test-quality]: Tests asserted only call counts, not value shapes** [`packages/api/__tests__/uploads-review.test.ts`] — Couldn't verify `source: 'patient_corrected'`, `confidence: 1.0`, audit event name, `correctionMetadata` shape reached the writers. Fix: scripted-mock now captures `.values()` and `.set()` arguments; tests `toMatchObject` against them.
- [x] [Review][Patch] **P142 [Low pt-BR]: Inline pt-BR strings outside `validators`** — Added `UPLOAD_DETAIL_TITLE_PT_BR`, `UPLOAD_DETAIL_VALUE_LABEL_PT_BR`, `UPLOAD_DETAIL_EXTRACTED_VALUE_PT_BR`; wired in both clients.

**`defer` (added to deferred-work.md):** F123–F129.

**Dismissed (~7):** double-tap Confirm (mutation.isPending disable + server CONFLICT), `loinc_unresolved` reviewQueueId (SELECT predicate rejects), transition race miss (handled), pure-SELECT LOINC mid-call drift (one transaction), `NaN`/`Infinity` (Zod catches), unique-index collision on retry (only UPDATE), `collectedAtText: null` fallback (works cleanly).

### Review Findings (code review round 2 — 2026-05-22)

3-layer adversarial round-2 (Blind Hunter + Edge Case Hunter + Acceptance Auditor) on the patched code. **3 HIGH (all related to round-1 patches — dead-code guard, TZ-drift on conflict probe, lost-update race) + 3 Med + 1 Med (test coverage).** 7 patches applied, 5 deferred (F130–F134), 6 dismissed.

**`patch` (must fix before done):**

- [x] [Review][Patch] **R2-P143 [HIGH Round-1-regression]: P137's upload-id guard is dead code** [`packages/api/src/uploads-review.ts`] — The ON-CONFLICT re-SELECT predicate already filters by `eq(Observations.uploadId, reviewRow.uploadId)`, so `existing.uploadId !== reviewRow.uploadId` can never be true. The cross-upload collision P137 worried about can't physically occur because `upload_id` is part of the unique index. Fix: drop the guard; keep the WHERE clause as-is.
- [x] [Review][Patch] **R2-P144 [HIGH Correctness]: TZ drift on `collectedAt` re-SELECT probe** [`packages/api/src/uploads-review.ts`] — `parseCollectedAt` already returns UTC midnight, but a defensive normalize ensures any future change to the parser doesn't break the re-SELECT's `.toISOString().slice(0, 10)` probe. Fix: re-build `collectedAt` as `Date.UTC(year, month, day)` after the parse.
- [x] [Review][Patch] **R2-P145 [Med Documentation]: NULL-loinc handling in re-SELECT — Postgres treats NULL as distinct, so the conflict can't fire on NULL anyway; the helper throws PRECONDITION_FAILED earlier if `loincCode` is null** — Documented inline; no code change needed.
- [x] [Review][Patch] **R2-P146 [Med Data-integrity]: Review-row UPDATE had no `patientId` predicate AND no `isNull(resolvedAt)` guard** [`packages/api/src/uploads-review.ts`] — RLS handles ownership but the explicit predicates protect against (a) future service-role callers bypassing RLS, and (b) lost-update races where two concurrent confirms would otherwise both clobber each other's `correction_metadata`. Fix: add both predicates + `.returning({ id })` + warn-on-zero-rows.
- [x] [Review][Patch] **R2-P147 [Med AC1]: Web detail screen wouldn't refetch on focus due to SSR-hydrated cache** [`apps/web/.../upload-detail-client.tsx`] — `refetchOnWindowFocus: true` is gated by `staleTime`; SSR-prefetched queries default to `Infinity` in many setups. Fix: explicit `staleTime: 0` on this query so AC1's "refetches when…" actually fires on web focus.
- [x] [Review][Patch] **R2-P148 [Med Test-coverage]: No test for the ON-CONFLICT re-SELECT path or `notification.upload_complete` audit emission** [`packages/api/__tests__/uploads-review.test.ts`] — Round-1 P141 strengthened arg captures but didn't cover the idempotent retry or AC4's completion-audit. Fix: add an explicit ON-CONFLICT test (`insertReturning: [[]]` + extra select queue for re-SELECT); assert `insertValuesArgs[2]` is the `notification.upload_complete` event in the existing last-confirm test.
- [x] [Review][Patch] **R2-P149 [Med AC4]: `notification.upload_complete` not emitted when a concurrent finalizer wins the transition race** [`packages/api/src/uploads-review.ts`] — Previous code only emitted the audit inside the `if (transitionResult.updated)` branch; if a future operator-side transition path bypasses this emission, the audit row is permanently missing for that upload. Fix: emit unconditionally when `uploadStatus` ends as `'complete'`; downstream dispatcher dedups.

**`defer` (added to deferred-work.md):**

- [x] [Review][Defer] **F130** `markReviewQueueResolved` helper for write-path symmetry.
- [x] [Review][Defer] **F131** Expo flag icon — replace `⚑` glyph with Tamagui/Lucide `Flag`.
- [x] [Review][Defer] **F132** Use inferred tRPC output type in Expo screen instead of hand-rolled `LowConfidenceField`.
- [x] [Review][Defer] **F133** Upgrade the `pending_review` post-confirm `console.warn` to a structured metric.
- [x] [Review][Defer] **F134** Snapshot-sync test for API `resolveLoincCode` vs worker raw-SQL impl.

**Dismissed (~6):** React Strict Mode double-onChange (state-init is idempotent); `patientValueNumeric: 0` (Zod accepts + flow is correct); referrer leakage on the P132 redirect (server-side `redirect()` doesn't expose referrer); cosmetic-edit clobber (covered by R2-P146); pt-BR copy review (P142 covered the story-2.4 strings); P133 NaN fallback string in jsonb (jsonb accepts strings; the coerce path is the actual protection).

### Change Log

- 2026-05-22 — Code review round 2. **7 patches applied (R2-P143–R2-P149), 5 deferred (F130–F134), 6 dismissed.** Three HIGH fixes closed regressions / oversights from round 1: **R2-P143** dropped P137's dead-code cross-upload guard (the SELECT predicate made it unreachable; the unique-index physics make the scenario impossible); **R2-P144** explicit UTC-midnight normalization on the parsed `collectedAt` so the ON-CONFLICT re-SELECT's date probe matches the originally-inserted row even if the parser ever changes to return a TZ-bearing Date; **R2-P146** added `patientId` + `isNull(resolvedAt)` predicates to the review-row UPDATE plus `.returning()` + warn-on-zero-rows, closing the lost-update race that would have let two concurrent confirms clobber each other's `correction_metadata`. **R2-P147** set `staleTime: 0` on the web detail query so focus-refetch survives SSR hydration (AC1). **R2-P148** added an ON-CONFLICT re-SELECT test + assert that the last-confirm path emits `notification.upload_complete`. **R2-P149** emit the completion audit unconditionally when `uploadStatus` ends as `'complete'` (not only when this caller won the transition). **101 unit tests green** (+1 over round-1 — the new R2-P148 test). Lint, typecheck, format all green.

### Change Log

- 2026-05-22 — Code review round 1. **13 patches applied (P130–P142), 7 deferred (F123–F129), 7 dismissed.** Three HIGH fixes closed: P130 (audit `resourceId` now references the actual observation id on idempotent retry; helper re-SELECTs by the conflict key), P131 (web + Expo dirty-flag now uses `touched + numeric comparison` — corrects AC3's `correction_metadata` semantics), P132 (web detail page gates on `getSession()` + redirect to `REGISTER_ROUTE`). HIGH data-integrity (P133): `originalConfidence` coerced to number. HIGH RLS (P134): SQL revokes from `PUBLIC` + `anon` explicitly before granting. Med (P135–P140): `hasOperatorOnlyRows` requires `processingCompletedAt`; ON-CONFLICT validates upload id match; empty `unitUcum` now throws `PRECONDITION_FAILED`; Expo uses `useLocalSearchParams`. Test quality (P141): tests now capture + assert `.values()` and `.set()` arguments. pt-BR (P142): inline strings lifted to `validators`. **100 unit tests green** (same count as round-0; assertions strengthened in-place). Lint, typecheck, format all green.
- 2026-05-22 — Story 2.4 implemented (dev-story). All 8 tasks complete; status → review. Shipped: new tRPC procedures `uploads.getUploadDetail` + `uploads.confirmReviewField`; `extraction_review_queue` schema additions; patient-facing RLS policies with column-level GRANT defense; LOINC resolver in `packages/api/src/loinc.ts`; pt-BR copy + decimal helpers in validators; web + Expo upload-detail screens. 100 unit tests green (+8 new). Real implementation deferrals: web/Expo component tests, RLS adversarial tests, service-role-bypassed operator-row count, system-sentinel UUID, snapshot-sync test for LOINC resolver, mobile-web focus refetch (F123–F129).
