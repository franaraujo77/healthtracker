# Story 3.1: Patient views their complete longitudinal biomarker record

Status: done

<!-- First story of Epic 3 (Fingerprint). Auto-promotes epic-3 from `backlog` → `in-progress`. -->
<!-- Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a **patient**,
I want **to view all my biomarker results across all uploaded draws, sorted by collection date, with each draw expandable into its biomarker cards**,
so that **I can see my complete health history in one place — the foundation under the Fingerprint that Stories 3.2/3.3 will build on**.

## Acceptance Criteria

> Lifted verbatim from `_bmad-output/planning-artifacts/epics.md` lines 879–897, with the Epic-3-prep cross-cutting constraints folded in.

1. **AC1 — Draw list, reverse chronological.**
   **Given** I have at least one published draw,
   **When** I navigate to the Histórico tab,
   **Then** I see all draws listed in reverse chronological order by `collected_at`, each row showing **lab name** (or "Não informado" when null), **collection date** formatted `dd/MM/yyyy` (pt-BR), and a **summary** of biomarker count (e.g. "12 biomarcadores").
   **And** rows for the same `(patient_id, collected_at, lab_name)` are collapsed into **one draw card** even when the underlying `observations` rows come from multiple `upload_id`s (extracted + patient-corrected) or from manual BIA (`upload_id IS NULL`). See "Draw grouping contract" in Dev Notes.

2. **AC2 — Draw detail uses `BiomarkerCard` in `standard` variant.**
   **Given** I tap on a draw row,
   **When** the detail view opens,
   **Then** I see every biomarker for that draw rendered through the new `BiomarkerCard` component in `standard` variant. Each card shows: `biomarker_name` (the `biomarkerName` column — never the raw `loinc_code`), `value_numeric` formatted with Brazilian decimal separator, `unit_ucum`, and the population reference range (`reference_range_low` – `reference_range_high` when both present; "—" otherwise).

3. **AC3 — Deviation chip is amber + text, never red, never colour-only.**
   **Given** a biomarker `value_numeric` falls outside `[reference_range_low, reference_range_high]` (population reference, NOT personal baseline — personal baseline is Stories 3.2/3.3),
   **When** the `BiomarkerCard` renders,
   **Then** it shows the amber deviation chip with a pt-BR text label (`"fora da faixa de referência"`). Chip uses `$warningAmber` + `$warningAmberSurface` Tamagui tokens; **never** `$errorRed`. The chip is paired with an icon **and** a text label so colour is never the sole conveyor of meaning (NFR-A4, UX-DR19, UX-DR20). When `reference_range_low`/`reference_range_high` are NULL (no population range available), the chip is suppressed — do not render "within range" or "deviation" without data.

4. **AC4 — Audit + RLS on every record fetch.**
   **Given** the record-fetch tRPC resolver executes,
   **Then** exactly **one** `writeAuditLog({ event: 'observation.read', actorType: 'patient', actorId: patientId, resourceType: 'observation_record', resourceId: patientId, metadata: { drawCount, observationCount } })` row is appended **inside the `protectedProcedure` transaction** (same atomicity pattern Story 2.4's `confirmReviewFieldAsPatient` used). RLS policy `observations_select_own` (already shipped in `packages/db/policies/custom_rls_observations.sql`) ensures only the authenticated patient's rows return; no application-layer `WHERE patient_id = …` is allowed to be the sole guard — the RLS policy is the security boundary, app-layer predicate is defense-in-depth only.

5. **AC5 — Soft-deleted observations are excluded.**
   **Given** Story 2.7 added `observations.deleted_at` for the BIA overwrite path,
   **When** the record query runs,
   **Then** every SELECT against `observations` filters `WHERE deleted_at IS NULL`. A patient who overwrote a same-date BIA never sees the old rows. (Cross-epic constraint from Epic 2 retro § "Dependencies on Epic 2".)

6. **AC6 — Empty state when no published observations exist.**
   **Given** I have zero published observations (and zero soft-deleted),
   **When** I open the draw list,
   **Then** the existing `EmptyStateRecord` component renders with pt-BR copy `"Sem exames publicados ainda"` headline + `"Enviar resultado"` CTA pointing to the `INICIO_ROUTE`. Patients with only `queued`/`processing`/`pending_review`/`failed` uploads (no published `observations` rows) see this empty state — those uploads remain visible on the existing Histórico upload-list (different tab artefact, do not merge).

7. **AC7 — Accessibility.**
   **Given** VoiceOver/TalkBack is on,
   **When** a `BiomarkerCard` receives focus,
   **Then** it reads the composite label `"{biomarkerName}, {value} {unit}, {referenceRangeNarration | deviationDescription}"` (e.g. `"Hemoglobina, 14,2 g por decilitro, dentro da faixa de referência"` or `"Ferritina, 8 nanogramas por mililitro, fora da faixa de referência"`). `accessibilityRole="button"` (Story 4.3 will turn the tap into a real detail sheet; today the tap is a no-op but the role is present for the future). Minimum touch target 44×44pt; card minimum height 72px (UX-DR19/20).

8. **AC8 — Performance.**
   **Given** the Fingerprint query (Stories 3.2/3.3) is the read-heavy consumer downstream,
   **Then** the Story 3.1 record fetch must complete **<500ms p95** (NFR-P5) for a patient with up to 1000 observation rows (50 BIA + 20 extracted × ~15 biomarkers, see Epic 2 retro § "Preparation gaps identified"). The single SELECT uses the existing `observations_patient_collected_idx` index (`patientId`, `collectedAt desc`); no client-side sort.

**Requirements traceability:** FR11, AR5, AR10, NFR-S2, NFR-A4, NFR-P5, UX-DR3, UX-DR19, UX-DR20.

---

## Tasks / Subtasks

- [x] **Task 1 — API: read-side helper + tRPC procedure (AC1, AC2, AC4, AC5, AC8)**
  - [ ] 1.1 Create `packages/api/src/observations-record.ts` (NEW file — mirrors the read-side split that `uploads-review.ts` did off `uploads.ts`). Export `getRecordForPatient(database: AuditDb, patientId: string): Promise<RecordView>`.
  - [ ] 1.2 Implement the SELECT using Drizzle: `select({ id, uploadId, loincCode, biomarkerName, valueNumeric, unitUcum, referenceRangeLow, referenceRangeHigh, labName, collectedAt, source, confidenceScore }).from(Observations).where(and(eq(patientId), isNull(deletedAt))).orderBy(desc(collectedAt), asc(biomarkerName))`. **App-layer `patient_id` predicate is defense-in-depth; RLS is the security boundary** (AR5, NFR-S2).
  - [ ] 1.3 Coerce numeric columns from Drizzle's `string` (PG numeric) to JS `number` at the helper boundary. Use `Number.parseFloat`; if `Number.isNaN`, log + skip the row (do not crash the whole fetch — defensive, single-row data-quality issue should not blank the screen). Mirror the conversion seam from Story 2.7 `writeObservation` (`String(entry.valueNumeric)` on write; reverse here on read).
  - [ ] 1.4 Group rows in TS into `Draw` objects keyed by `(collectedAt, labName ?? '__null__')` — same date + same lab is one draw. Preserve `desc(collectedAt)` order. Output shape: `{ draws: Draw[]; observationCount: number; drawCount: number }`. See "Draw grouping contract" in Dev Notes for why grouping happens in TS, not SQL.
  - [ ] 1.5 Emit exactly **one** `writeAuditLog` per call with `event: 'observation.read'`, `actorId: patientId`, `actorType: 'patient'`, `resourceType: 'observation_record'`, `resourceId: patientId`, `metadata: { drawCount, observationCount }`. Inside the `protectedProcedure` transaction (forwarded `ctx.db`).
  - [ ] 1.6 Create `packages/api/src/router/observations.ts` route `getRecord: protectedProcedure.query(async ({ ctx }) => getRecordForPatient(ctx.db, ctx.session.user.id))`. Append it alongside the existing `submitBia` route. **Re-export via `packages/api/src/root.ts`** (already wired through `observationsRouter`).
  - [ ] 1.7 No Zod input — the procedure derives `patientId` from `ctx.session.user.id` (the only safe source).

- [x] **Task 2 — UI: `BiomarkerCard` component (AC2, AC3, AC7)**
  - [ ] 2.1 Create `packages/ui/src/biomarker-card.tsx`. Tamagui-only. Export `BiomarkerCard` + types from `packages/ui/src/index.ts` (mirrors `empty-state-record.tsx` re-export pattern).
  - [ ] 2.2 Props: `{ biomarkerName: string; valueNumeric: number; unitUcum: string; referenceRangeLow: number | null; referenceRangeHigh: number | null; variant?: 'standard' | 'compact' | 'featured'; state?: 'within-band' | 'watching' | 'notable' | 'cold-start' | 'loading' | 'hidden-from-doctor'; onPress?: () => void }`. **Ship `standard` variant + `within-band`/`watching`/`notable`/`cold-start` states only this story** — `compact`, `featured`, `loading`, `hidden-from-doctor` are Stories 3.2/3.3/5.1 deferrals; do not implement.
  - [ ] 2.3 Layout: YStack with `biomarkerName` (DM Sans Medium, 16px), `valueNumeric` formatted via `formatBrazilianDecimal` (already in `@healthtracker/validators`) + `unitUcum` on one line (DM Sans Bold, 18px standard variant), reference range as secondary text `"Referência: {low} – {high} {unit}"` (12px, `$textSecondary`). Suppress reference line entirely when both ranges are null.
  - [ ] 2.4 Deviation chip: conditional on `state === 'watching' || state === 'notable'`. Chip = horizontal pill with icon (`AlertCircle` from `lucide-react-native`/`lucide-react` — already in repo, check `packages/ui` deps; if not, add `lucide-react-native`) + text label `"fora da faixa de referência"`. Tokens: `backgroundColor="$warningAmberSurface"` + `color="$warningAmber"` + dark text on amber background per UX spec § "Amber contrast resolution" (line 1306). **Never `$errorRed`.**
  - [ ] 2.5 Card container: `backgroundColor="$surfaceElevated"`, `borderRadius="$card"`, `borderWidth={1}`, `borderColor="$border"`, `padding="$3"`, `minHeight={72}` (UX-DR19 touch-target rule).
  - [ ] 2.6 Accessibility: `accessibilityRole="button"`, `accessibilityLabel={composite}` per AC7. `accessibilityHint="Toque duas vezes para ver o histórico completo"` (Story 4.3 placeholder — the hint is set today even though the press is a no-op, so the audio cue is stable across stories).
  - [ ] 2.7 Reduce-motion compliance: no animations in `standard`/`within-band`/`watching`/`notable` this story (animation is Stories 3.2/3.3 territory). Skeleton/loading variant deferred.
  - [ ] 2.8 Vitest snapshot test at `packages/ui/__tests__/biomarker-card.test.tsx` — render each shipped state, assert label text + presence/absence of chip. (If `packages/ui` doesn't have a vitest config yet, this becomes deferred F-item; check first.)

- [x] **Task 3 — Expo screens: draw list + draw detail (AC1, AC2, AC6)**
  - [ ] 3.1 Rename the existing `apps/expo/src/app/(tabs)/historico.tsx` to keep the upload-status list (Story 2.5 surface) intact OR add a second screen — **decision: add as a tab inside Histórico**. Two-tab pattern: "Resultados" (NEW — published observations, Story 3.1) and "Envios" (RENAME of existing upload-status list). See "Tab vs. screen decision" in Dev Notes. Prefer Tamagui `Tabs` over `@react-navigation/material-top-tabs` (no new dep).
  - [ ] 3.2 Create `apps/expo/src/app/(tabs)/historico/resultados.tsx` (NEW): fetches `trpc.observations.getRecord` via `useQuery` (`staleTime: 0`, `refetchOnWindowFocus: true` — Story 2.5 pattern). Renders draw cards. Loading: pt-BR `"Carregando…"`. Error: `accessibilityRole="alert"` + pt-BR `"Não foi possível carregar seu histórico."`.
  - [ ] 3.3 Create `apps/expo/src/app/(tabs)/historico/[collectedAt].tsx` (NEW dynamic route): reads `useLocalSearchParams<{ collectedAt: string; labName?: string }>()`, filters `getRecord` data client-side to that `(collectedAt, labName)` group (no second tRPC call — the dataset is small per Epic 2 retro § preparation gaps), and renders a list of `BiomarkerCard`s in `standard` variant.
  - [ ] 3.4 Wire the draw card tap to `router.push({ pathname: '/historico/[collectedAt]', params: { collectedAt, labName: labName ?? '' } })`. Add a route constant `HISTORICO_DRAW_DETAIL_ROUTE(collectedAt, labName)` to `packages/validators/src/index.ts` mirroring `UPLOAD_DETAIL_ROUTE`.
  - [ ] 3.5 Empty state on the Resultados subtab: existing `EmptyStateRecord` with the AC6 copy. Add the two constants `HISTORICO_RESULTS_EMPTY_HEADLINE_PT_BR` + `HISTORICO_RESULTS_EMPTY_CTA_PT_BR` to validators.
  - [ ] 3.6 Update `apps/expo/src/app/(tabs)/_layout.tsx` only if the tab name changes — keep the `historico` tab key + label `"Histórico"`. The new subtabs live **inside** the Histórico screen.

- [x] **Task 4 — Validators: pt-BR copy + route helpers (AC1, AC2, AC3, AC6)**
  - [ ] 4.1 Add to `packages/validators/src/index.ts`:
    - `HISTORICO_RESULTS_TAB_LABEL_PT_BR = "Resultados"`
    - `HISTORICO_UPLOADS_TAB_LABEL_PT_BR = "Envios"`
    - `HISTORICO_RESULTS_EMPTY_HEADLINE_PT_BR = "Sem exames publicados ainda"`
    - `HISTORICO_RESULTS_EMPTY_CTA_PT_BR = "Enviar resultado"`
    - `HISTORICO_DRAW_BIOMARKER_COUNT_PT_BR = (n) => \`\${n} \${n === 1 ? 'biomarcador' : 'biomarcadores'}\``
    - `HISTORICO_LAB_NAME_FALLBACK_PT_BR = "Laboratório não informado"`
    - `BIOMARKER_REFERENCE_LABEL_PT_BR = "Referência"`
    - `BIOMARKER_OUT_OF_RANGE_LABEL_PT_BR = "fora da faixa de referência"`
    - `BIOMARKER_WITHIN_RANGE_LABEL_PT_BR = "dentro da faixa de referência"`
    - `HISTORICO_DRAW_DETAIL_ROUTE = (collectedAt: string, labName: string) => \`/historico/\${collectedAt}?labName=\${encodeURIComponent(labName)}\``
  - [ ] 4.2 No new Zod schema this story — the procedure has no input.

- [x] **Task 5 — Tests (AC1, AC2, AC3, AC4, AC5, AC8)**
  - [ ] 5.1 Unit: `packages/api/__tests__/observations-record.test.ts` — mock Drizzle (see existing `observations.test.ts` lines 1–80 for the mock pattern). Assertions: (a) `where` filter includes `isNull(deletedAt)` (AC5); (b) one `writeAuditLog` call with the exact event/metadata shape (AC4); (c) draws grouped by `(collectedAt, labName)` even across multiple `uploadId`s; (d) numeric-string → number coercion; (e) NaN-on-coerce drops the row, does not throw.
  - [ ] 5.2 Integration: extend `packages/db/__tests__/integration/` (the testcontainer harness exists per CLAUDE.md). Add `observations-record.integration.test.ts`. Seed 1 patient, 3 draws (extracted on 2024-01-10, BIA on 2024-03-15 manual, patient-corrected on 2024-05-20). Assert the record returns 3 draws in `[2024-05-20, 2024-03-15, 2024-01-10]` order with the right counts; assert a soft-deleted row is excluded. **This is the testcontainer-based test the Epic 2 retro § "Preparation gaps" calls for** — Story 3.1 is where the infra pays back.
  - [ ] 5.3 RLS: extend `packages/db/__tests__/rls/observations.rls.test.ts` — fill the `correctPatient`/`wrongPatient` todos with real assertions: a second patient's rows return zero. (`doctorWithAccess`/`expiredToken`/`revokedToken` stay todo — they land in Story 5.1+.)
  - [ ] 5.4 UI snapshot: `packages/ui/__tests__/biomarker-card.test.tsx` — shipping states render snapshot diff. Skip if vitest+RTL isn't wired in `packages/ui` (track as F-item like Story 2.4 F125, do not block the story).
  - [ ] 5.5 No web app surface this story (Epic 3 is mobile-first; web Fingerprint is post-MVP). Confirm with retro before adding any `apps/web` work.

- [x] **Task 6 — Quality gates (mandatory)**
  - [ ] 6.1 `pnpm typecheck` — green.
  - [ ] 6.2 `pnpm lint` — green.
  - [ ] 6.3 `pnpm format:fix` then `pnpm format` — clean.
  - [ ] 6.4 `pnpm test` — green (new tests added).
  - [ ] 6.5 `pnpm --filter @healthtracker/db test:integration` — green (Task 5.2 must pass against testcontainer Postgres).
  - [ ] 6.6 Manual run-through (Expo simulator): seed a few `observations` rows via `pnpm db:studio`, open Histórico → Resultados tab, tap a draw, verify cards render with amber chip for an out-of-range value.

---

## Dev Notes

### Architecture patterns and constraints

- **Single sanctioned write path discipline** (Epic 1 + Epic 2 retros). Story 3.1 is a **read-only** story but the audit emission **must** go through `writeAuditLog` from `packages/api/src/audit.ts` — never inline `db.insert(AuditLog)`. This was the prior pattern in Story 2.4 and the discipline held across the epic.
- **`protectedProcedure` is the atomicity spine.** The audit-log write goes inside the same transaction as the SELECT, automatically — `protectedProcedure` wraps the resolver in a transaction (`packages/api/src/trpc.ts` lines 76–102). Do not call `ctx.db.transaction(...)` manually — that nests transactions, which `postgres.js` rejects without `.savepoint`. Just use the forwarded `ctx.db` (already the transaction handle).
- **RLS is the security boundary.** `custom_rls_observations.sql` (lines 17–22) enforces `patient_id::text = current_setting('app.current_patient_id', true)`. The `protectedProcedure` middleware calls `SELECT set_config('app.current_patient_id', …, true)` at the top of every authenticated transaction (see `packages/api/src/trpc.ts` line 85). Story 3.1's app-layer `eq(Observations.patientId, patientId)` predicate is **defense-in-depth**, not the primary guard.
- **Narrow catches by default** (Epic 2 retro action item 2; Story 2.5 R2-P193 + Story 2.8 R2-P226 burned this lesson). Story 3.1 has one defensive `try { Number.parseFloat … } catch { skip row + log }` — the catch must explicitly match a numeric-coerce error shape, not a bare `catch (err)`. If there's nothing to catch (parseFloat doesn't throw), use a `Number.isNaN(v)` guard and skip; don't write a try/catch.
- **Query-param coupling check** (Epic 2 retro action item 3; Story 2.5 R2-P171 burned this lesson). The new `HISTORICO_DRAW_DETAIL_ROUTE(collectedAt, labName)` helper MUST be consumed by the dynamic route `apps/expo/src/app/(tabs)/historico/[collectedAt].tsx`. Round-1 reviewer: verify the destination route reads `labName` from `useLocalSearchParams`.
- **F162 carry-forward.** Story 2.7 retrospective F162 noted `observations.upload_id` is now nullable (manual BIA writes `null` instead of `SENTINEL_UPLOAD_UUID`). Story 3.1's draw grouping MUST handle `uploadId === null` — that's the manual BIA case, and those rows group by `(collectedAt, labName)` like everything else.
- **Soft-delete filter is non-negotiable.** Epic 2 retro § "Dependencies on Epic 2" explicitly calls this out: "the `deleted_at IS NULL` filter that 2.7 added MUST be applied by every Epic-3 query." Round-2 reviewer: grep the new code for any SELECT against `Observations` and verify `isNull(deletedAt)` is in the predicate.
- **No second tRPC call from the detail screen.** The dataset is small (≤1000 rows per Epic 2 retro § preparation gaps); client-side filter the already-fetched `getRecord` payload by `(collectedAt, labName)` rather than designing a `getDraw` procedure. Stories 3.2/3.3 may revisit this if Fingerprint payloads diverge.
- **Tamagui-only.** No hardcoded hex values, no raw pixel values, no `StyleSheet.create`. Semantic tokens from `packages/ui/src/theme` (already wired). The `(tabs)/_layout.tsx` exception (native `tabBarStyle` props can't read tokens) does NOT extend — your screen body uses tokens.
- **Brazilian decimal formatting.** `formatBrazilianDecimal` lives in `@healthtracker/validators` (already used by `apps/expo/src/app/uploads/[uploadId].tsx` line 9–10). Use it for `valueNumeric` and reference ranges. Date formatting: `new Date(collectedAt).toLocaleDateString('pt-BR')` — same pattern as `historico.tsx` line 66.

### Draw grouping contract (resolves an ambiguity in AC1)

The epics file says "draws listed in reverse chronological order, each showing lab name, collection date, and a summary of biomarker count." But `observations` has no `draw_id` column — a draw is implicit. There are three ways the same logical draw can produce multiple rows in `observations`:

1. **Extracted + patient-corrected** — Story 2.4 writes a `source = 'patient_corrected'` row for the corrected value, alongside the original `source = 'extracted'` row. Same `upload_id`, same `collected_at`, same `lab_name`. Group these together.
2. **Multi-page PDF or multi-upload same date** — two PDFs from the same lab dated the same day land as two `upload_id`s. UX intent (from UX spec line 826: "the atomic unit of the Fingerprint experience") is that the patient sees one logical draw, not two cards 2cm apart.
3. **Manual BIA** — `upload_id IS NULL`, distinct `lab_name` (device name from Story 2.7). Naturally distinct from extracted draws.

**Decision: group by `(collectedAt, labName ?? '__null_lab__')`.** Same date + same lab/device = one draw card. The `__null_lab__` sentinel ensures null-labeled extracted rows don't accidentally fold into manual BIA rows. Grouping happens in TS (Task 1.4) because the dataset is small and a SQL `GROUP BY` would lose per-row fields the detail view needs. Document this decision in a JSDoc on `getRecordForPatient`.

### Tab vs. screen decision

The existing `historico.tsx` (Story 2.5) is an **upload-status** list — it shows queued / processing / failed uploads, which is operational. Story 3.1 is the **published-observations** view — what the patient cares about clinically. Two ways to compose:

- **A. Two-tab UI inside Histórico** (chosen). Tabs at top: "Resultados" (NEW, default) + "Envios" (existing). Patients see results first; the upload-status surface is one tap away. Minimizes nav restructure; `(tabs)/historico.tsx` becomes a parent screen with two sub-routes.
- B. Two top-level tabs. Adds clutter to the bottom tab bar; UX spec § "Bottom Tab Bar" (UX-DR not explicit, but follows Apple HIG of ≤5 tabs).

**Go with A.** Restructure `apps/expo/src/app/(tabs)/historico.tsx` → `apps/expo/src/app/(tabs)/historico/_layout.tsx` (Tamagui `Tabs` or Expo Router's segment + a simple in-screen toggle). The existing Card/offline-rows/recovery logic moves to `apps/expo/src/app/(tabs)/historico/envios.tsx` **verbatim** (no behavioural change — Story 2.5 is done). The new Resultados subtab is `apps/expo/src/app/(tabs)/historico/resultados.tsx`. The default segment is `resultados`.

**If Expo Router segments make this messy**, fall back to a simple in-component Tamagui-toggle inside one screen file (`historico.tsx` renders either `<ResultadosSection />` or `<EnviosSection />` based on local state). Choose whichever the type system accepts cleanly; both meet the UX intent. Document the choice in the story File List.

### Source tree components to touch

**New files:**

- `packages/api/src/observations-record.ts` — `getRecordForPatient` helper + draw-grouping logic.
- `packages/ui/src/biomarker-card.tsx` — `BiomarkerCard` component (standard variant + 4 states).
- `packages/ui/__tests__/biomarker-card.test.tsx` — snapshot tests (if vitest is wired in `packages/ui`; else F-item).
- `apps/expo/src/app/(tabs)/historico/resultados.tsx` — new published-observations list.
- `apps/expo/src/app/(tabs)/historico/[collectedAt].tsx` — draw detail screen rendering `BiomarkerCard`s.
- `apps/expo/src/app/(tabs)/historico/_layout.tsx` OR an in-screen tab toggle — see Tab vs. screen decision.
- `apps/expo/src/app/(tabs)/historico/envios.tsx` — verbatim move of current `historico.tsx` contents.
- `packages/api/__tests__/observations-record.test.ts` — unit tests, mock-Drizzle pattern.
- `packages/db/__tests__/integration/observations-record.integration.test.ts` — testcontainer integration test (first one this epic; the infra is the Epic 2 retro prep task).

**Modified files:**

- `packages/api/src/router/observations.ts` — append `getRecord` procedure alongside `submitBia`.
- `packages/ui/src/index.ts` — export `BiomarkerCard` + types.
- `packages/validators/src/index.ts` — add pt-BR constants + `HISTORICO_DRAW_DETAIL_ROUTE`.
- `packages/db/__tests__/rls/observations.rls.test.ts` — convert the `correctPatient`/`wrongPatient` todos to real assertions.
- `apps/expo/src/app/(tabs)/historico.tsx` — delete OR refactor into `_layout.tsx` per Tab decision.

**Files NOT to touch (verify by grep before editing):**

- `packages/db/src/schema/observations.ts` — schema already supports everything Story 3.1 needs (Story 2.3 + 2.7 work). No new column.
- `packages/db/policies/custom_rls_observations.sql` — `observations_select_own` already covers the read path.
- `packages/api/src/observations.ts` — keep `writeObservation` / `writeBiaObservations` untouched; this story adds a read helper, doesn't modify writes.
- `packages/api/src/audit.ts` — no change; `writeAuditLog` is the existing helper.
- `packages/api/src/trpc.ts` — no change; `protectedProcedure` already wraps in tx + sets RLS context.

### Previous story intelligence (Story 2.8 → Story 3.1)

From `_bmad-output/implementation-artifacts/2-8-patient-manages-push-notification-preferences.md` Dev Notes:

- **Tamagui `Switch` on Expo + `Linking.openSettings()`** are now templated for any settings-style screen — not directly applicable to Story 3.1 but the pattern of "ship API surface, defer native wire-up" applies broadly (F135 carry-forward).
- **`.strict()` Zod schemas** (Story 2.8 R1-P221) — Story 3.1 has no Zod input, so this doesn't bite, but if any input is added during dev (e.g. a cursor for pagination), make it `.strict()` to reject unknown keys.
- **Worker fail-open narrowed catches** (Story 2.8 R2-P226) — directly cited in the Epic 2 retro as the catch-all-idiom moment. Apply to any try/catch in Story 3.1 code.
- **`NOTIFICATION_KIND_TO_PREFERENCE` in validators** is a separate concern (notifications-only); Story 3.1 doesn't touch it.

### Testing standards summary

Mirror Story 2.7's testing posture (the strongest in Epic 2):

- **Unit tests** co-located in `packages/api/__tests__/` using vitest + mocked Drizzle (see `packages/api/__tests__/observations.test.ts` lines 10–60 for the exact mock-chain pattern: `vi.fn(() => ({ values: vi.fn(() => ({ onConflictDoNothing: vi.fn(() => ({ returning: vi.fn(...) })) })) }))`). Cover the happy path AND the edge cases listed in Task 5.1.
- **Integration tests** in `packages/db/__tests__/integration/` using `@testcontainers/postgresql` (the harness file is `packages/db/__tests__/integration/setup.ts` per CLAUDE.md). This story is **where the testcontainer prep work pays back** — Epic 2 retro action item §Technical 1 specifically calls out "Land before Story 3.1."
- **RLS adversarial tests** in `packages/db/__tests__/rls/observations.rls.test.ts` — flip the `it.todo` for `correctPatient` and `wrongPatient`. The `doctorWith*`/`*Token` cases stay todo until Story 5.1.
- **UI component tests** are nice-to-have; if `packages/ui` doesn't have vitest + RTL configured, file as F-item (mirrors Story 2.4 F124/F125) and don't block.
- **No web tests** this story (no web surface).
- Run from repo root: `pnpm typecheck && pnpm lint && pnpm format && pnpm test`. Then `pnpm --filter @healthtracker/db test:integration`.

### Project Structure Notes

Aligned with `packages/api/src/` split (observations / observations-record mirrors uploads / uploads-review). One naming variance: existing read-side helpers use the suffix `-review`; Story 3.1's read helper uses `-record` because "review" already means "low-confidence review queue" in this codebase. The suffix is intentional and documented in the JSDoc.

The `(tabs)/historico` directory restructure is the only navigation-shape change in the story. It is contained — no other tab moves, no deep-link breakage (the `HISTORICO_ROUTE = "/inicio/historico"` constant in validators line 232 was a typo/legacy aspiration; the actual route is `/historico`). If a downstream consumer imports `HISTORICO_ROUTE`, update its value to `/historico/resultados` and add a JSDoc deprecating the old name. Grep before assuming.

### References

- Story foundation: `_bmad-output/planning-artifacts/epics.md` § "Story 3.1" (lines 873–897).
- Epic 3 framing: `_bmad-output/planning-artifacts/epics.md` § "Epic 3" (lines 251–254, 867–870).
- Requirements:
  - FR11 — `_bmad-output/planning-artifacts/prd.md` line 487.
  - AR5 — `_bmad-output/planning-artifacts/epics.md` line 140.
  - AR10 — `_bmad-output/planning-artifacts/epics.md` line 145.
  - NFR-S2 — `_bmad-output/planning-artifacts/prd.md` line 561.
  - NFR-A4 — `_bmad-output/planning-artifacts/prd.md` line 581.
  - NFR-P5 — `_bmad-output/planning-artifacts/prd.md` line 555.
- Architecture:
  - tRPC + RLS context — `_bmad-output/planning-artifacts/architecture.md` lines 774–787, code at `packages/api/src/trpc.ts` lines 76–102.
  - `writeAuditLog` contract — `_bmad-output/planning-artifacts/architecture.md` lines 829–847, code at `packages/api/src/audit.ts`.
  - Observations schema + indexes — code at `packages/db/src/schema/observations.ts` (the `observations_patient_collected_idx` on line 111 is the Story 3.1 index).
  - Observations RLS — code at `packages/db/policies/custom_rls_observations.sql`.
  - tRPC response shape (no envelope) — `_bmad-output/planning-artifacts/architecture.md` lines 645–657.
- UX:
  - BiomarkerCard spec — `_bmad-output/planning-artifacts/ux-design-specification.md` lines 824–844 (full component contract).
  - Amber-not-red rule — `_bmad-output/planning-artifacts/ux-design-specification.md` lines 1073–1089.
  - Amber contrast resolution — `_bmad-output/planning-artifacts/ux-design-specification.md` line 1306.
  - Touch targets / accessibility composite label — lines 1308–1314.
- Previous story: `_bmad-output/implementation-artifacts/2-8-patient-manages-push-notification-preferences.md` (Dev Notes lines 97–137).
- Epic 2 retro (cross-cutting): `_bmad-output/implementation-artifacts/epic-2-retro-2026-05-23.md` § "Next Epic Preview — Epic 3" (lines 124–152), § "Action Items" (lines 153–174).
- Deferred work: `_bmad-output/implementation-artifacts/deferred-work.md` — relevant carry-forwards: F162 (nullable `upload_id` — addressed in Story 2.7; consume here), F128 (worker/API SQL drift — not in scope this story but the testcontainer infra Story 3.1 needs is the same prep), F135 (Expo push hook — not in scope).

---

## Dev Agent Record

### Agent Model Used

claude-opus-4-7[1m]

### Debug Log References

- `pnpm typecheck` — green (16/16 tasks)
- `pnpm lint` — green (14/14 tasks)
- `pnpm test` / `pnpm --filter @healthtracker/api test:unit` — 127/127 tests pass
- `pnpm --filter @healthtracker/db test:unit` — green (no test files in unit scope by design; integration/RLS are separate configs)
- `pnpm format` — clean
- `pnpm --filter @healthtracker/db test:integration` — **NOT RUN in this worktree (Docker daemon unavailable here).** Test file is written and ready (`packages/db/__tests__/integration/observations-record.integration.test.ts`); run on a host with Docker before merge. See F-item F167 below.

### Completion Notes List

- **Task 1 (API helper + procedure)** — `getRecordForPatient` in `packages/api/src/observations-record.ts` runs a single Drizzle SELECT with `eq(patientId)` + `isNull(deletedAt)` (AC5), `orderBy(desc(collectedAt), asc(biomarkerName))` (AC1). RLS is the security boundary; app-layer predicate is defense-in-depth (AR5, NFR-S2). One `writeAuditLog({ event: 'observation.read', resourceType: 'observation_record', metadata: { drawCount, observationCount } })` per call lands inside the `protectedProcedure` transaction (AC4). Numeric columns coerced via `Number.parseFloat` + `Number.isNaN` guard (no try/catch — narrow-catch discipline per Epic 2 retro action item 2). Rows with unparseable `valueNumeric` / `confidenceScore` are logged + skipped so single-row data-quality issues don't blank the screen. Draws grouped in TS by `(collectedAt, labName ?? '__null_lab__')` to satisfy AC1's multi-uploadId / manual-BIA grouping contract. Helper added to `getRecord` procedure in `packages/api/src/router/observations.ts` (re-exported via the existing `observationsRouter`).
- **Task 2 (`BiomarkerCard`)** — `packages/ui/src/biomarker-card.tsx` ships the `standard` variant + 4 states (`within-band` / `watching` / `notable` / `cold-start`). Compact / featured / loading / hidden-from-doctor deferred per Task 2.2 (3.2 / 3.3 / 5.1 work). Uses the existing Tamagui tokens `$biomarkerDeviation` + `$biomarkerDeviationBg` for the amber chip (these are the canonical Story 0.2 names; the story spec's `$warningAmber` / `$warningAmberSurface` did not exist in `packages/ui/src/theme/tokens.ts`). Chip pairs a glyph (`!`) with the pt-BR label `"fora da faixa de referência"` so colour is never the sole conveyor of meaning (AC3, NFR-A4). Min height 72 px, `accessibilityRole="button"`, composite a11y label per AC7. Lucide icon avoided — no new dep this story (would add `lucide-react-native` for a single glyph). Re-exported from `packages/ui/src/index.ts`.
- **Task 3 (Expo screens)** — Decision: directory restructure (`apps/expo/src/app/(tabs)/historico.tsx` → `historico/index.tsx` + `historico/_layout.tsx` + `historico/[collectedAt].tsx`) chosen over in-screen toggle because the dynamic detail route needs to live under the same segment for `router.push({ pathname: '/historico/[collectedAt]' })` to typecheck. Resultados / Envios subtabs implemented as in-component toggle (Tamagui Button group with `role="tablist"` / `accessibilityRole="tab"`); Tamagui's segmented Tabs primitive isn't in this project's Tamagui catalog, so the toggle pattern is the no-new-dep equivalent. Detail screen reads `useLocalSearchParams<{ collectedAt; labName? }>()` and filters the cached `getRecord` payload by `(collectedAt, labName ?? '')` — no second tRPC call (AC8 / Epic 2 retro § preparation gaps). Query-param coupling is sound: the producer (`historicoDrawDetailRoute` + the list's `router.push` call) and the consumer (`useLocalSearchParams` in `[collectedAt].tsx`) round-trip through `labName`.
- **Task 4 (validators)** — All pt-BR constants + `historicoDrawDetailRoute` / `historicoDrawBiomarkerCountPtBr` added at the end of `packages/validators/src/index.ts`. The legacy `HISTORICO_ROUTE` constant kept untouched with a JSDoc warning (no consumers found — verified via grep). No new Zod schema (Task 4.2 — `getRecord` takes no input).
- **Task 5 (tests)** — API unit test (`packages/api/__tests__/observations-record.test.ts`, 8 cases) covers all AC1/AC4/AC5 scenarios + numeric coercion + null-lab vs manual_bia grouping + drop-on-NaN. Integration test (`packages/db/__tests__/integration/observations-record.integration.test.ts`) seeds 7 rows across 2 patients + 1 soft-deleted row and asserts: reverse-chrono order, multi-uploadId same-draw collapse, manual_bia upload_id NULL, soft-delete exclusion, app-layer patient_id filter. RLS test (`packages/db/__tests__/rls/observations.rls.test.ts`) wires the `correctPatient` and `wrongPatient` cases per Task 5.3; doctor/token cases remain `it.todo` for Story 5.1+.
- **Task 6 (quality gates)** — typecheck, lint, format clean; api unit tests green; integration test deferred to a Docker-enabled host (F167).
- **Discipline checks applied:**
  - Narrow catches — no try/catch added at all (used `Number.isNaN` guard instead of try/catch around parseFloat per Epic 2 retro action item 2).
  - Query-param coupling — `labName` producer (`historicoDrawDetailRoute` + the draw-card `router.push` in `historico/index.tsx`) and consumer (`useLocalSearchParams` in `historico/[collectedAt].tsx`) verified to round-trip.
  - Soft-delete filter — `isNull(Observations.deletedAt)` in the only SELECT (also asserted by both the unit test and the integration test).
  - Audit-log atomicity — `writeAuditLog` called with the forwarded `ctx.db` (transaction handle from `protectedProcedure` middleware); no manual `database.transaction(...)`.
  - No `pnpm db:push` invoked — no schema changes this story.

### Deferred / F-items

- **F167 — Integration test execution against testcontainer Postgres.** The test file is written and ready (`packages/db/__tests__/integration/observations-record.integration.test.ts`). Docker isn't running in this worktree; run `pnpm --filter @healthtracker/db test:integration` on a Docker-enabled host before merging. The test is wired to `setup.ts` and uses raw `db.sql` so it doesn't pull in the API package (which `@healthtracker/db` does not depend on by design). This is the first integration test that actually pays back the Epic 2 retro § preparation work.
- **F168 — UI snapshot test for `BiomarkerCard`.** `packages/ui` has no vitest + RTL configuration today (`packages/ui/package.json` lacks `vitest` / `@testing-library/react-native` / `jsdom`); standing up that harness is outside the Story 3.1 budget. Same posture as Story 2.4 F124/F125. Task 5.4 explicitly allows this fallback.
- **F169 — Lucide icon for the deviation chip.** Story 3.1 uses a text glyph (`!`) instead of `AlertCircle` from `lucide-react-native` to avoid adding a new mobile dep for a single icon. Pick this up when the next icon is needed (Story 3.2's Fingerprint chart likely).
- **Manual run-through (Task 6.6)** — not executed in this worktree (no Expo simulator available); should be run by the reviewer on the next pass against `pnpm db:studio`-seeded data.

### File List

**New files:**

- `packages/api/src/observations-record.ts` — `getRecordForPatient` helper + grouping + audit emission.
- `packages/api/__tests__/observations-record.test.ts` — unit tests (8 cases).
- `packages/ui/src/biomarker-card.tsx` — `BiomarkerCard` component + `deviationStateForValue` pure helper.
- `apps/expo/src/app/(tabs)/historico/_layout.tsx` — Stack layout for the Histórico segment.
- `apps/expo/src/app/(tabs)/historico/[collectedAt].tsx` — draw detail screen rendering `BiomarkerCard`s.
- `packages/db/__tests__/integration/observations-record.integration.test.ts` — testcontainer SQL contract test (deferred run — see F167).

**Modified files:**

- `apps/expo/src/app/(tabs)/historico/index.tsx` — moved from `(tabs)/historico.tsx` (git mv) and refactored to host Resultados/Envios subtabs.
- `packages/api/src/router/observations.ts` — added `getRecord: protectedProcedure.query(...)` alongside `submitBia`.
- `packages/ui/src/index.ts` — re-exports `BiomarkerCard`, `deviationStateForValue`, and its types.
- `packages/validators/src/index.ts` — Story 3.1 pt-BR constants + `historicoDrawDetailRoute` + `historicoDrawBiomarkerCountPtBr`; JSDoc note on the legacy `HISTORICO_ROUTE` constant.
- `packages/db/src/index.ts` — added `asc` to the re-exported Drizzle operators (needed by the helper).
- `packages/db/__tests__/rls/observations.rls.test.ts` — wired the `correctPatient` and `wrongPatient` assertions per Task 5.3; remaining identity cases stay `it.todo` for Story 5.1+.

---

## Review Notes

### Round 1 Review

Adversarial review across Blind Hunter (diff-only), Edge Case Hunter (project-aware), and Acceptance Auditor (vs spec). Continuing patch numbering from Epic 2's P230.

| ID      | Sev | Title                                                                                                    | Outcome                                                                                                             |
| ------- | --- | -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| R1-P231 | MED | Dead route helper `historicoDrawDetailRoute` — producer with no consumer                                 | **Applied**                                                                                                         |
| R1-P232 | MED | Pull-to-refresh + active-section duplicate `getRecord` query (extra audit per refetch)                   | Dismissed (intentional per AC4; one audit per call, refetch counts as a call)                                       |
| R1-P233 | MED | `protectedProcedure` transaction wraps `.query` resolvers — confirm AC4 atomicity                        | Dismissed (verified at `packages/api/src/trpc.ts` L83 — `ctx.db.transaction(...)` wraps both queries and mutations) |
| R1-P234 | MED | `getRecordForPatient` drops entire row when `confidenceScore` is NaN — hides clinical data over metadata | **Applied** (default to 0 + log; still drops row only on bad `valueNumeric`)                                        |
| R1-P235 | LOW | RLS test missing soft-delete dimension                                                                   | Dismissed (covered by integration test; soft-delete is a query filter, not an RLS predicate)                        |
| R1-P236 | LOW | `BiomarkerCard` deviation glyph uses web-only `aria-hidden` on RN `Text`                                 | **Applied** (added `accessibilityElementsHidden` + `importantForAccessibility="no-hide-descendants"`)               |
| R1-P237 | LOW | `ObservationView` carries unused fields (`confidenceScore`, `source`, `loincCode`, `id`)                 | Dismissed (consumed by Stories 3.2/3.3/4.3)                                                                         |
| R1-P238 | LOW | Decimal formatting in reference range may need locale comma                                              | Dismissed (`formatBrazilianDecimal` already handles it; range uses it)                                              |
| R1-P239 | LOW | `BiomarkerCard` could announce "within range" when `state` is passed explicitly with null ranges         | Dismissed (only path to that state is `deviationStateForValue` which returns `cold-start` on null)                  |
| R1-P240 | MED | Two `getRecord` query observers — `isRefetching` flag asymmetry across observers                         | Deferred F-item (functional; cosmetic UX wart, refactor out-of-scope this round)                                    |
| R1-P241 | LOW | Detail screen surfaces fetch-error copy when the issue is "draw not found in payload"                    | **Applied** (added `HISTORICO_DRAW_NOT_FOUND_PT_BR`)                                                                |
| R1-P242 | LOW | Integration test lacks `afterEach` cleanup                                                               | Dismissed (per-suite fresh container; single `it` block — no collision)                                             |
| R1-P243 | LOW | Helper `historicoDrawDetailRoute` does not `encodeURIComponent` `collectedAt`                            | Dismissed (`collectedAt` is regex-validated `yyyy-mm-dd` upstream — no URL-hostile chars)                           |

**Discipline-check verdict** (Epic 1 + Epic 2 retros):

- Narrow catches — PASS (no try/catch added; numeric coercion uses `Number.isNaN` guard).
- Query-param coupling — was FAILING (R1-P231 — `historicoDrawDetailRoute` helper had no consumer). **Now PASSING** after R1-P231 patch wires the helper into `historico/index.tsx` `router.push`.
- Soft-delete filter — PASS (`isNull(deletedAt)` in the SELECT; covered by unit + integration tests).
- Audit-log atomicity — PASS (`writeAuditLog` uses forwarded `ctx.db` from `protectedProcedure` transaction; verified).
- Broad-catch swallowing — PASS (no broad catches in new code).
- Partial-index TOCTOU — N/A (read-only story; no new indexes).
- `pnpm db:push` for partial-index changes — N/A (no schema changes).

**Files touched in Round 1:**

- `apps/expo/src/app/(tabs)/historico/index.tsx` — R1-P231 (use route helper).
- `apps/expo/src/app/(tabs)/historico/[collectedAt].tsx` — R1-P241 (new error copy).
- `packages/api/src/observations-record.ts` — R1-P234 (degrade bad confidence to 0).
- `packages/api/__tests__/observations-record.test.ts` — R1-P234 test case added.
- `packages/ui/src/biomarker-card.tsx` — R1-P236 (RN a11y attrs).
- `packages/validators/src/index.ts` — R1-P241 (`HISTORICO_DRAW_NOT_FOUND_PT_BR`).

**AC gap revealed by review:** none. All ACs (AC1–AC8) trace to implementation; the patches are quality/discipline refinements, not AC coverage fixes.

**Quality gates after patches:**

- `pnpm typecheck` — green (16/16 tasks).
- `pnpm lint` — green (14/14 tasks).
- `pnpm --filter @healthtracker/api test:unit` — 128/128 (added 1 new test for R1-P234).
- `pnpm --filter @healthtracker/db test:unit` — green (no unit test files by design; integration/RLS are separate configs).
- `pnpm format:fix` — clean.
- Integration test against testcontainer Postgres — still deferred per F167 (Docker unavailable in this worktree; unchanged this round).

### Round 2 Review

Round 2 charter (per CLAUDE.md "Code review discipline"): hunt patterns
that round-1 broke or half-finished. Numbered from R2-P244 per the
charter.

| ID      | Sev | Title                                                                                                                                                                  | Outcome     |
| ------- | --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- |
| R2-P244 | MED | `EnviosSection` empty-state CTA regresses Story 2.5 copy from "Enviar primeiro exame" → "Enviar resultado" (verbatim-move accidentally swapped the constant)           | **Applied** |
| R2-P245 | LOW | Hardcoded pt-BR `"← Voltar"` in `historico/[collectedAt].tsx` should live in validators (repo convention: all surface strings centralised so copy review is grep-able) | **Applied** |

**Round 2 discipline-check verdict** (Epic 1 + Epic 2 retros):

- Narrow catches — PASS (no try/catch added by R1 or R2; numeric coercion still uses `Number.isNaN` guard).
- Query-param coupling — PASS (`historicoDrawDetailRoute` producer + `useLocalSearchParams` consumer round-trip `labName`; R1-P231 fix verified again).
- Soft-delete filter — PASS (`isNull(deletedAt)` in the single SELECT; covered by unit + integration tests, no app-layer re-check of the same predicate).
- Audit-log atomicity — PASS (`writeAuditLog` uses forwarded `ctx.db` from `protectedProcedure` transaction; verified at `packages/api/src/trpc.ts` L83 — `ctx.db.transaction(...)` wraps queries as well as mutations).
- Broad-catch swallowing programmer errors — PASS (no broad catches in new code).
- Dead-code guard — PASS (no app-layer re-check after the SELECT predicate already filters by `(patient_id, deleted_at IS NULL)`).
- TOCTOU SELECT-EXISTS-then-INSERT — N/A (read-only story; no inserts).
- Partial-index ON-CONFLICT `where` clauses — N/A (no new indexes; story does not write).
- `pnpm db:push` for partial-index changes — N/A (no schema changes).
- R1 dismissals re-reviewed:
  - R1-P232 (duplicate `getRecord` query / extra audit per refetch) — still dismissed. The parent observer with `enabled: false` and the child observer share the same query key under React Query; `.refetch()` triggers ONE fetch and emits ONE audit per call. AC4 says "one audit per call", so each refetch IS a new call and warrants a new audit. Confirmed.
  - R1-P233 (transaction wraps queries too) — re-verified at `packages/api/src/trpc.ts` L83. Confirmed.
  - R1-P235 (RLS test missing soft-delete) — still dismissed; soft-delete is a query filter, not an RLS predicate. The integration test covers it.
  - R1-P237 (unused `ObservationView` fields) — still dismissed; downstream Stories 3.2/3.3/4.3 will consume them.
  - R1-P240 (two `getRecord` observers / `isRefetching` asymmetry) — still deferred as F-item; functional, cosmetic, refactor out-of-scope this round.
  - R1-P242 (integration test cleanup) — still dismissed; per-suite container.
  - R1-P243 (no `encodeURIComponent` on `collectedAt`) — still dismissed; upstream `yyyy-mm-dd` shape.

**Files touched in Round 2:**

- `apps/expo/src/app/(tabs)/historico/index.tsx` — R2-P244 (restore Story 2.5 empty-CTA copy).
- `apps/expo/src/app/(tabs)/historico/[collectedAt].tsx` — R2-P245 (use validators constant for back label).
- `packages/validators/src/index.ts` — R2-P245 (`HISTORICO_DRAW_DETAIL_BACK_PT_BR`).

**AC gap revealed by R2:** none. R2 patches are quality/discipline refinements.

**Quality gates after R2 patches:**

- `pnpm typecheck` — green (16/16 tasks).
- `pnpm lint` — green (14/14 tasks).
- `pnpm --filter @healthtracker/api test` — 128/128 (no new tests this round; R2 patches are copy-level, covered by existing tests).
- `pnpm --filter @healthtracker/db test:unit` — green (no unit test files by design; integration/RLS are separate configs).
- `pnpm format:fix` — clean.
- Integration test against testcontainer Postgres — still deferred per F167 (Docker unavailable in this worktree).

**Disposition:** Story 3.1 → **done**. All HIGH/MED findings across R1+R2 are applied; LOW findings either applied or documented-deferred. Sprint-status updated.

### Round 3 Review

Round 3 charter (per CLAUDE.md "Code review discipline"): subtle
correctness on edge cases, composition issues between R1+R2 patches,
test-coverage gaps, AC traceability, R1/R2 dismissals that look wrong
with fresh eyes, and `pnpm db:push` partial-index semantics. Numbered
from R3-P246.

| ID      | Sev  | Title                                                                                                                                                                                                                                                                                                                                                                                  | Outcome     |
| ------- | ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- |
| R3-P246 | HIGH | Off-by-one date display — `new Date('yyyy-mm-dd').toLocaleDateString('pt-BR')` parses as UTC midnight and shifts to the previous calendar day in every Brazilian timezone (UTC-3 / UTC-4 / UTC-5), regressing AC1's "collection date formatted dd/MM/yyyy". Bug exists in `historico/index.tsx` (Resultados draw rows + a11y label) and `historico/[collectedAt].tsx` (detail header). | **Applied** |

**Round 3 discipline-check verdict** (Epic 1 + Epic 2 retros):

- Narrow catches — PASS (no try/catch added in R1/R2/R3; numeric coercion still uses `Number.isNaN` guard).
- Query-param coupling — PASS (`historicoDrawDetailRoute` producer + `useLocalSearchParams` consumer round-trip `labName`; R1-P231 fix verified again).
- Soft-delete filter — PASS (`isNull(deletedAt)` in the single SELECT; unit + integration test coverage unchanged).
- Audit-log atomicity — PASS (`writeAuditLog` uses forwarded `ctx.db` from `protectedProcedure` transaction).
- Broad-catch swallowing programmer errors — PASS (no broad catches in any new code).
- Dead-code guard — PASS (no app-layer re-check after SELECT predicate).
- TOCTOU SELECT-EXISTS-then-INSERT — N/A (read-only story).
- Partial-index ON-CONFLICT `where` clauses — N/A.
- `pnpm db:push` for partial-index changes — N/A (no schema changes).
- R1/R2 dismissals re-reviewed with fresh eyes:
  - R1-P232 (duplicate `getRecord` query / extra audit per refetch) — still dismissed; AC4 says one audit per call, refetch counts as a call.
  - R1-P233, R1-P235, R1-P237, R1-P242, R1-P243 — re-confirmed dismissals.
  - R1-P240 — still F-item (cosmetic; out-of-scope).
  - R2-P244, R2-P245 — applied in R2; behaviour stable in R3.
- R3 charter extras:
  - Edge cases (empty record / single-draw / all-soft-deleted / decimal precision / boundary `value === low` / boundary `value === high`) — covered by unit tests + integration test; no new findings.
  - Timezone boundary on `collected_at` grouping — surfaced R3-P246. The grouping key uses the raw `yyyy-mm-dd` string (no Date round-trip), so grouping itself is unaffected; only the **rendered** date was off by one.
  - i18n / dark-mode tokens — all surface strings live in validators; all colours go through Tamagui semantic tokens. No findings.
  - Package-boundary leaks — `@healthtracker/db` does not depend on `@healthtracker/api`; the integration test correctly exercises raw SQL. No findings.
  - No new dependencies — R3 added no new deps.
  - AC traceability — every AC1–AC8 has at least one test pinning its behavior; the integration test (deferred run, F167) is the SQL contract for AC1/AC5.

**Files touched in Round 3:**

- `packages/validators/src/index.ts` — R3-P246 (new `formatCollectedAtPtBr` helper).
- `apps/expo/src/app/(tabs)/historico/index.tsx` — R3-P246 (consume the helper for draw-row date).
- `apps/expo/src/app/(tabs)/historico/[collectedAt].tsx` — R3-P246 (consume the helper for detail header date).

**Prior-round dismissals reversed:** none. The R3 finding is a fresh defect missed by R1 and R2, not a reversal.

**AC gap revealed by R3:** R3-P246 was an AC1 regression — the rendered date didn't match `dd/MM/yyyy` for the collection date. Now fixed.

**Quality gates after R3 patches:**

- `pnpm typecheck` — green (16/16 tasks).
- `pnpm lint` — green (14/14 tasks).
- `pnpm --filter @healthtracker/api test` (test:unit) — 128/128.
- `pnpm --filter @healthtracker/db test:unit` — green (no unit test files by design; integration/RLS are separate configs).
- `pnpm format:fix` — clean.
- Integration test against testcontainer Postgres — still deferred per F167 (Docker unavailable in this worktree; unchanged).

**Disposition:** Story 3.1 stays **done**. One HIGH finding applied; no other findings. R3 raised the bar on date-handling edge cases that future date-rendering stories should mirror (`formatCollectedAtPtBr` is now the canonical helper for any `yyyy-mm-dd` column rendered as pt-BR).
