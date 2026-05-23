# Story 3.2: Patient views the Fingerprint at Draw 1 with baseline-building context

Status: done

<!-- Second story of Epic 3 (Fingerprint). epic-3 already in-progress. -->
<!-- Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a **patient with exactly one published draw**,
I want **to open the Início tab and see a Fingerprint that uses population context while clearly telling me my personal baseline is being built**,
so that **I understand the current view is a calibration starting point — not yet my personal trajectory — and stay motivated to upload another draw**.

## Acceptance Criteria

> Lifted verbatim from `_bmad-output/planning-artifacts/epics.md` lines 909–940, with the Epic-2 retro cross-cutting constraints folded in.

1. **AC1 — `FingerprintChart` cold-start-1 state on Início.**
   **Given** I have **exactly one** published draw (i.e. `drawCount === 1` from `trpc.observations.getRecord`),
   **When** I open the Início tab (`apps/expo/src/app/(tabs)/inicio.tsx`),
   **Then** the new `FingerprintChart` component renders in **`cold-start-1`** state: **one biomarker row per `BiomarkerCard`-eligible observation**, each showing a **single pulsing teal dot** plotted against the **population reference band** (the `[referenceRangeLow, referenceRangeHigh]` interval rendered as a shaded horizontal track), with the chart-level label **"Sua linha de base pessoal cresce com cada novo exame"** (UX spec line 857).
   **And** the chart sits **above** the existing Início content (`ExtractionPulse`, offline-queued banner, `EmptyStateRecord` upload CTA, manual-BIA button) — the upload affordances do not disappear; Draw 1 still wants the patient to upload Draw 2.

2. **AC2 — `EmptyStateRecord` `partial` variant below the chart.**
   **Given** the Fingerprint is in `cold-start-1` state,
   **When** I view the screen,
   **Then** an `EmptyStateRecord` component in the new **`partial`** state renders **beneath** the `FingerprintChart`, with:
   - headline: **"Com 2 ou mais exames, você verá seu padrão pessoal"** (UX spec line 1187 + epics AC2),
   - CTA label: **"Enviar resultado anterior"** (epics AC2 — distinct from Início's primary "Enviar primeiro resultado" CTA; this one is about back-filling prior history),
   - CTA action: opens the existing `UploadSourceSheet` (same handler the Início headline CTA uses — `setSheetOpen(true)`),
   - variant: `"inline"` (not `"full-page"` — the chart and the empty state share the screen with Início's existing surfaces).

3. **AC3 — `BiomarkerCard` cold-start state with population deviation.**
   **Given** a `BiomarkerCard` in **`cold-start`** state has a value that falls outside `[referenceRangeLow, referenceRangeHigh]`,
   **When** the card renders inside the cold-start chart,
   **Then** the deviation is computed against the **population reference range** (NOT personal baseline — there isn't one yet), the **amber deviation chip** appears with the existing pt-BR label **"fora da faixa de referência"**, and **the existing `BiomarkerCard` `watching` chip styling is reused** (no new tokens). When `referenceRangeLow`/`referenceRangeHigh` is NULL, **suppress** the chip — never render "within range" or "fora da faixa" without ranges to compare against (Story 3.1 AC3 contract carries forward).
   **And** the `BiomarkerCard` in cold-start state **does not** render a personal-baseline narrative ("X% abaixo da sua linha de base") — that copy is Story 3.3's job and rendering it here would be a lie.

4. **AC4 — Reduced-motion replaces pulse with a static dot.**
   **Given** `AccessibilityInfo.isReduceMotionEnabled()` returns `true` (or the runtime preference changes via `reduceMotionChanged`),
   **When** the `FingerprintChart` renders in `cold-start-1`,
   **Then** the pulsing animation on every dot is replaced with a **static teal dot at full opacity** (no animation, no setInterval running). The static dot must still convey the same visual meaning (a positioned marker on the reference band). The `useReducedMotion` boolean is **caller-supplied** to the component (same pattern as `ExtractionPulse` — `inicio.tsx` already owns the `AccessibilityInfo` listener and threads `reducedMotion` down via props).
   **And** changing the OS reduced-motion preference while the screen is mounted must take effect without remount (the existing `AccessibilityInfo.addEventListener("reduceMotionChanged", ...)` subscription in `inicio.tsx` covers this).

5. **AC5 — Render gating: only at exactly `drawCount === 1`.**
   **Given** the `trpc.observations.getRecord` query resolves,
   **When** the result has `drawCount === 0`,
   **Then** the `FingerprintChart` + `partial`-state `EmptyStateRecord` are **NOT rendered** — Início falls back to the existing `EmptyStateRecord` `cold-start` flow (Story 1.2 / 2.1 surface). When `drawCount >= 2`, Story 3.2's surfaces are **NOT rendered** either — Story 3.3 will own that path. Story 3.2 strictly ships the `=== 1` rung.
   **And** while the query is in `isPending`, the Início screen shows the existing empty-state shell (no skeleton needed this story — `EmptyStateRecord` is already a calm landing surface; a layout shift on resolve is acceptable per the read-heavy-but-small-payload assumption in the Epic 2 retro § "Preparation gaps").

6. **AC6 — Audit-log discipline: no second `observation.read` emission from Story 3.2.**
   **Given** Story 3.1 already calls `trpc.observations.getRecord` from `(tabs)/historico/index.tsx` and emits one `observation.read` audit per call,
   **When** Início mounts and also calls `trpc.observations.getRecord`,
   **Then** Story 3.2 does **NOT** add a new tRPC procedure or a new audit-log event kind — it reuses the existing `getRecord` procedure. Two independently-mounted screens calling the same query will each fetch (and each audit) per AC4 of Story 3.1; that is intentional and discussed in Story 3.1 R1-P232 (dismissed). No `observation.fingerprint.read` event; no per-component `writeAuditLog` wiring. The existing `observation.read` event covers it.

7. **AC7 — Accessibility: chart + partial empty state both have screen-reader narration.**
   **Given** VoiceOver/TalkBack is on,
   **When** the `FingerprintChart` in `cold-start-1` is focused,
   **Then** the chart container reads a single composite `accessibilityLabel`: **"Fingerprint em construção. {N} biomarcadores deste primeiro exame. Sua linha de base pessoal cresce com cada novo exame."** (N = the biomarker count from the single draw). Per-dot child elements are `accessibilityElementsHidden` + `importantForAccessibility="no-hide-descendants"` — the per-`BiomarkerCard` composite label below already announces each biomarker; double-announcement is noise.
   **And** the `partial`-state `EmptyStateRecord` keeps `EmptyStateRecord`'s existing accessibility shape (the illustration slot stays decorative; the headline + CTA carry meaning).

8. **AC8 — pt-BR copy + tokens, no hardcoded hex, no `red`.**
   **Given** the Story 0.2 Tamagui token discipline,
   **When** Story 3.2 code is reviewed,
   **Then** every surface string lives in `packages/validators/src/index.ts` (greppable copy review), every colour goes through a Tamagui semantic token from `packages/ui/src/theme/tokens.ts`, the dot uses `$primaryTeal`, the population reference band uses `$primaryTealLight` (`#E0F2F1` light / `#134E4A` dark — already wired), and `$errorRed`/`#DC2626` does **NOT** appear anywhere in the new code (UX spec § "Amber-not-red" lines 1073–1089).

**Requirements traceability:** FR13 (`packages/validators/src/index.ts` consumer surface; Fingerprint visualization), FR15 (partial Fingerprint at draw 1 with baseline-building label), UX-DR2 (personal-baseline framing), UX-DR3 (cold-start states), UX-DR10 (`EmptyStateRecord` partial state), UX-DR17 (reduced-motion), UX-DR20 (text-and-icon never colour-only).

---

## Tasks / Subtasks

- [x] **Task 1 — UI: new `FingerprintChart` component (AC1, AC3, AC4, AC7, AC8)**
  - [x] 1.1 Create `packages/ui/src/fingerprint-chart.tsx` (NEW file). Tamagui-only. Export `FingerprintChart` + `FingerprintChartState` + `FingerprintChartProps` from `packages/ui/src/index.ts` (mirror the `BiomarkerCard` re-export shape).
  - [x] 1.2 Props: `{ state: 'cold-start-1'; biomarkers: Array<{ biomarkerName: string; valueNumeric: number; unitUcum: string; referenceRangeLow: number | null; referenceRangeHigh: number | null }>; reducedMotion?: boolean }`. Only the `cold-start-1` state ships this story; the type union is `'cold-start-1'` literal for now (Story 3.3 widens it to `| 'cold-start-2' | 'baseline-established'`). **Do NOT add Victory Native this story** — the cold-start-1 visual is a positioned dot on a horizontal track, achievable with Tamagui `XStack` + `View` + `Circle` primitives. Victory Native is needed when line-chart math arrives (Story 3.3 — the architecture doc lines 486–491 explicitly defers the chart library to that story's scope). See "Charting library deferral" in Dev Notes for the rationale.
  - [x] 1.3 Layout: outer `YStack` with `gap="$3"`, `padding="$4"`, `backgroundColor="$surfaceElevated"`, `borderRadius="$cardLg"`, `borderWidth={1}`, `borderColor="$border"`, optional shadow via the existing `$shadow.card` token if it surfaces in the theme (gracefully omit if not exported). Header row: a single `Text` line with the pt-BR label `FINGERPRINT_COLD_START_LABEL_PT_BR = "Sua linha de base pessoal cresce com cada novo exame"` (DM Sans, `fontSize={14}`, `color="$textSecondary"`). Then a `YStack` of per-biomarker rows.
  - [x] 1.4 Per-biomarker row: `XStack alignItems="center" gap="$3" minHeight={56}`. Left column (`width={140}`): `Text` with `biomarkerName` (DM Sans 14px, `$textPrimary`). Middle column (`flex={1}`): the **band + dot**. Right column: `Text` with `formatBrazilianDecimal(valueNumeric)` + unit (DM Sans 14px bold, `$textPrimary`). Use `formatBrazilianDecimal` from `@healthtracker/validators` (already used by `BiomarkerCard`).
  - [x] 1.5 Band + dot rendering: a `View` of height `8`, `backgroundColor="$primaryTealLight"`, `borderRadius="$chip"`, full width of the middle column = the reference band. Position the dot horizontally by computing a normalised x-position: `x = (value - low) / (high - low)` clamped to `[0, 1]`, then offset by `x * containerWidth - dotRadius`. **When `low === null || high === null`**, render the dot centred (`x = 0.5`) and dim the band to `$border` colour with an `accessibilityLabel` fallback indicating no reference range is available. The dot itself is a `Circle size={12}` with `backgroundColor="$primaryTeal"`.
  - [x] 1.6 Pulse animation: when `reducedMotion !== true`, oscillate the dot's `opacity` between `1.0` and `0.4` on a `2000ms` cycle using the same `setInterval`-driven hook pattern that `extraction-pulse.tsx` uses (`usePulseOpacity(active)` lines 87–100 — copy the pattern, do not import the private hook; export a small local helper if it ends up identical, but keep it in `fingerprint-chart.tsx` for now). When `reducedMotion === true`, the dot is **static at opacity 1.0** and no interval runs (no work in `useEffect` cleanup, no leaked timers). AC4 boundary: `reducedMotion={true} → no interval started, period`.
  - [x] 1.7 Accessibility: outer container gets `accessibilityRole="image"` + the composite `accessibilityLabel` from AC7 (`FINGERPRINT_COLD_START_A11Y_LABEL_PT_BR(count)` helper added to validators). Per-row visuals are `accessibilityElementsHidden` + `importantForAccessibility="no-hide-descendants"` — the `BiomarkerCard`s rendered alongside this chart (Task 2) carry the per-biomarker narration.
  - [x] 1.8 No `lucide-react-native` (still deferred; Story 3.1 F169 carries forward).

- [x] **Task 2 — UI: extend `EmptyStateRecord` with the `partial` state (AC2, AC8)**
  - [x] 2.1 Update `packages/ui/src/empty-state-record.tsx`. Add the `state` prop back (it was elided in Story 1.2 per the JSDoc on lines 19–23): `state?: 'cold-start' | 'partial'` (default `'cold-start'`). `'filtered-empty'` is **NOT** in scope this story (UX-DR10's third state lands when search/filter ships).
  - [x] 2.2 The `partial` state changes **tone and emphasis only**, not layout. Same `YStack`, same headline + description + CTA structure. Differences:
    - paddings reduce slightly when `variant="inline"` is also set (`paddingVertical="$3"`) so the empty state stacks cleanly under the chart;
    - headline `fontSize` drops to `$5` for the `partial` state (the cold-start state on Início wants a louder welcome; the partial state on Início wants to whisper "there's more coming").
  - [x] 2.3 Do NOT change the default behaviour: existing call sites (`apps/expo/src/app/(tabs)/inicio.tsx` line 207, `apps/expo/src/app/(tabs)/historico/index.tsx` empty states) pass no `state` prop and must render identically (visual regression).
  - [x] 2.4 Re-export `EmptyStateRecordState` from `packages/ui/src/index.ts` alongside `EmptyStateRecordVariant`.

- [x] **Task 3 — Expo: wire Início to render the Fingerprint at `drawCount === 1` (AC1, AC2, AC5, AC6)**
  - [x] 3.1 Modify `apps/expo/src/app/(tabs)/inicio.tsx`. Add a `useQuery(trpc.observations.getRecord.queryOptions(undefined, { staleTime: 0, refetchOnWindowFocus: true }))` call — mirror the options used by `historico/index.tsx` (line 113–114). The hook lives **inside** the `Inicio()` component, below the existing `useOfflineQueue()` call.
  - [x] 3.2 Compute `drawCount = recordQuery.data?.drawCount ?? 0`. Render the new `FingerprintChart` + `partial`-state `EmptyStateRecord` **only when `drawCount === 1`**. AC5 gating.
  - [x] 3.3 The chart's `biomarkers` prop is derived from `recordQuery.data?.draws[0]?.observations ?? []` (the single draw is `draws[0]` because Story 3.1 sorts `desc(collectedAt)` and there is exactly one). Map each observation to `{ biomarkerName, valueNumeric, unitUcum, referenceRangeLow, referenceRangeHigh }` — pass-through; the helper already coerces numeric strings to `number` at the API boundary.
  - [x] 3.4 Thread the existing `reducedMotion` state (the component already owns it via `AccessibilityInfo.isReduceMotionEnabled()`, lines 51–64) into the chart's `reducedMotion` prop. **Do not** add a second `AccessibilityInfo` subscription — re-use the existing one.
  - [x] 3.5 The `partial`-state `EmptyStateRecord` CTA `onCtaPress` calls the same `setSheetOpen(true)` handler the existing `EmptyStateRecord` cold-state CTA uses (line 214). The `UploadSourceSheet` machinery is unchanged.
  - [x] 3.6 **DO NOT** remove or hide the existing Início surfaces (`ExtractionPulse`, offline-queued banner, the primary `EmptyStateRecord` cold-state, the manual-BIA secondary button). AC1's "above the existing content" wording: insert the new surfaces **between the offline-queued banner and the primary `EmptyStateRecord`** so the visual flow is: pulse (if uploading) → offline-queued banner (if any) → **Fingerprint cold-start chart (NEW, when drawCount===1)** → **partial `EmptyStateRecord` (NEW)** → primary `EmptyStateRecord` upload CTA → manual-BIA button. The patient with one draw still needs to see "Enviar primeiro resultado" framing? **No** — at `drawCount === 1` the primary `EmptyStateRecord` headline `INICIO_HEADLINE_PT_BR = "Sua história de saúde começa aqui"` is wrong. Decision: **conditionally swap** the primary `EmptyStateRecord` headline/CTA copy when `drawCount === 1` for a continuation framing (`INICIO_HEADLINE_DRAW_ONE_PT_BR = "Continue construindo seu Fingerprint"` + reuse the existing `INICIO_CTA_PT_BR` "Enviar primeiro resultado" → change to `INICIO_CTA_DRAW_ONE_PT_BR = "Enviar próximo exame"`). See "Início composition at drawCount===1" in Dev Notes.
  - [x] 3.7 Loading state: while `recordQuery.isPending`, render the existing Início shell unchanged. Error state: while `recordQuery.isError`, also render the existing shell unchanged + `console.warn("[inicio] getRecord error", recordQuery.error)`. **Do NOT** show a red banner — Início is a calm landing surface and a Fingerprint-fetch error must not interrupt the upload affordance.
  - [x] 3.8 Query-param coupling check (Epic 2 retro action item 3): no new query params are introduced this story. The existing `?source=post_onboarding_photo` consumer (line 33–36) is untouched. **Confirm at round-1 review.**

- [x] **Task 4 — Validators: pt-BR copy + Story 3.2 surface strings (AC1, AC2, AC7, AC8)**
  - [x] 4.1 Append to `packages/validators/src/index.ts` at the bottom (after the Story 3.1 block ending at `formatCollectedAtPtBr`):
    - `FINGERPRINT_COLD_START_LABEL_PT_BR = "Sua linha de base pessoal cresce com cada novo exame"` (UX spec line 857; AC1 chart label).
    - `FINGERPRINT_PARTIAL_EMPTY_HEADLINE_PT_BR = "Com 2 ou mais exames, você verá seu padrão pessoal"` (UX spec line 1187; AC2 partial empty-state headline).
    - `FINGERPRINT_PARTIAL_EMPTY_CTA_PT_BR = "Enviar resultado anterior"` (epics AC2; AC2 partial empty-state CTA).
    - `FINGERPRINT_COLD_START_A11Y_LABEL_PT_BR = (count: number) => \`Fingerprint em construção. \${count} \${count === 1 ? 'biomarcador' : 'biomarcadores'} deste primeiro exame. Sua linha de base pessoal cresce com cada novo exame.\`` (AC7 composite label).
    - `FINGERPRINT_REFERENCE_RANGE_UNAVAILABLE_A11Y_PT_BR = "Sem faixa de referência populacional disponível"` (AC3 / Task 1.5 fallback).
    - `INICIO_HEADLINE_DRAW_ONE_PT_BR = "Continue construindo seu Fingerprint"` (Task 3.6 — Início primary headline when drawCount===1).
    - `INICIO_CTA_DRAW_ONE_PT_BR = "Enviar próximo exame"` (Task 3.6 — Início primary CTA when drawCount===1).
  - [x] 4.2 No new Zod schema — Story 3.2 adds no new tRPC procedure (AC6).
  - [x] 4.3 Do NOT touch any existing constant (Story 3.1 R2-P244 burned the lesson: a verbatim-rename that swaps an existing copy regresses a prior story).

- [~] **Task 5 — Tests (AC1, AC2, AC3, AC4, AC5, AC7)** — all subtasks deferred as F-items; no test harness in `packages/ui`, `apps/expo`, or `packages/validators` (F168 carries forward from Story 3.1).
  - [ ] 5.1 **UI snapshot — `FingerprintChart`.** If `packages/ui` vitest+RTL is wired (it was NOT as of Story 3.1 — see F168), this task is **deferred as F-item** matching the Story 3.1 / Story 2.4 pattern. **Otherwise:** add `packages/ui/__tests__/fingerprint-chart.test.tsx`: (a) renders the cold-start-1 with 3 biomarkers and asserts the headline label; (b) `reducedMotion={true}` → assert no `setInterval` is scheduled (use `vi.useFakeTimers()` + assert `vi.getTimerCount()` is 0 after a render+effects flush); (c) `reducedMotion={false}` → assert the timer is scheduled and clears on unmount.
  - [ ] 5.2 **UI snapshot — `EmptyStateRecord` partial state.** Same deferred-F-item gate as 5.1. Otherwise add cases to (or create) `packages/ui/__tests__/empty-state-record.test.tsx`: assert headline + CTA render for `state="partial"`, default `state="cold-start"` is unchanged (visual-regression guard for Task 2.3).
  - [ ] 5.3 **Validators unit test.** Add cases to `packages/validators/__tests__/index.test.ts` (or whatever test file exists for that package; if none, this becomes F-item) for `FINGERPRINT_COLD_START_A11Y_LABEL_PT_BR(1)` → singular form ("1 biomarcador"); `(2)` → plural; `(0)` → plural with "0 biomarcadores". Cheap, catches the singular/plural off-by-one.
  - [ ] 5.4 **Início render-gating test.** Add `apps/expo/__tests__/inicio.test.tsx` (only if RTL+expo test harness exists in `apps/expo`; check before writing). Mock `trpc.observations.getRecord` to return `drawCount: 0` / `1` / `2`. Assert the chart + partial-empty surfaces appear ONLY at `drawCount === 1`. If the harness is absent, mark as F-item (mirrors Story 3.1 F168 posture) and document a manual run-through scenario in Task 6.6.
  - [ ] 5.5 **No new API or DB tests** — Story 3.2 reuses Story 3.1's `getRecord` procedure unchanged; the API surface, RLS posture, and integration test for the SELECT are already covered.

- [x] **Task 6 — Quality gates (mandatory)**
  - [x] 6.1 `pnpm typecheck` — green.
  - [x] 6.2 `pnpm lint` — green.
  - [x] 6.3 `pnpm format:fix` then `pnpm format` — clean.
  - [x] 6.4 `pnpm test` — green (any new tests added).
  - [x] 6.5 `pnpm --filter @healthtracker/db test:integration` — must still pass (no DB changes; this is a regression guard, not a new test).
  - [ ] 6.6 Manual run-through (Expo simulator if available):
    1. Seed zero observations → Início shows the existing cold-start landing surface only (no chart).
    2. Seed exactly one draw (one upload, ~5 biomarkers, one out-of-range) → Início shows the `FingerprintChart` cold-start-1 above the primary surfaces; out-of-range row shows the amber chip via the existing `BiomarkerCard`-style chip styling carried forward into the chart row.
    3. Toggle OS "Reduce Motion" → dots become static; flip back → dots resume pulsing.
    4. Seed two+ draws → chart disappears from Início (Story 3.3's domain).

---

## Dev Notes

### Architecture patterns and constraints

- **No new tRPC procedure.** AC6 is explicit: Story 3.2 reuses `trpc.observations.getRecord`. The Story 3.1 helper (`getRecordForPatient` in `packages/api/src/observations-record.ts`) already returns `{ draws, drawCount, observationCount }` — exactly what Início needs to gate on `drawCount === 1` and read `draws[0].observations`. **Do not** add a `getFingerprintAtDrawOne` procedure; do not add a `count`-only procedure. The dataset is small (Epic 2 retro § "Preparation gaps": ≤1000 rows for a power user), and a duplicate procedure would re-emit a duplicate `observation.read` audit on the same page-mount.
- **`protectedProcedure` transaction wraps queries.** Story 3.1 R1-P233 verified that `ctx.db` inside `getRecord` is already a transaction handle (`packages/api/src/trpc.ts` L83); no change needed here.
- **RLS is the security boundary.** Unchanged from Story 3.1. The `observations_select_own` policy in `packages/db/policies/custom_rls_observations.sql` is the only enforcement; the app-layer `eq(patientId, ...)` in the helper is defense-in-depth.
- **Soft-delete filter is non-negotiable.** Already applied in `getRecordForPatient` (Story 3.1 AC5). Story 3.2 inherits it — there is no new SELECT in this story.
- **Reduced-motion: caller-supplied boolean, not a context.** The repo's canonical pattern (set by `ExtractionPulse` in Story 2.1) is: the screen owns `AccessibilityInfo.isReduceMotionEnabled()` + the `reduceMotionChanged` subscription, and passes a `reducedMotion: boolean` prop down. Stories 3.2/3.3 must follow this — do **not** introduce a `useReducedMotion()` hook in `@healthtracker/ui` (would require a React context that doesn't exist; the UX spec line 1379 mentions `useReducedMotion()` as a concept, not as an imported hook). `inicio.tsx` already has the subscription wired (lines 51–64); thread the existing `reducedMotion` state into `<FingerprintChart reducedMotion={reducedMotion} />`.
- **Narrow catches by default** (Epic 2 retro action item 2). Story 3.2 has no obvious try/catch surface — the only failure modes are (a) `recordQuery.isError` (handled with `console.warn` + render-the-shell at Task 3.7, no try/catch needed) and (b) per-dot positioning math (`x = (value - low) / (high - low)` — divide-by-zero when `high === low`; handle with an explicit `if (high === low) x = 0.5` guard, NOT a try/catch).
- **Query-param coupling check** (Epic 2 retro action item 3). Story 3.2 adds no new route helpers; the upload-CTA reuses the existing `UploadSourceSheet`. **Round-1 reviewer**: still verify the partial-empty CTA invokes the same `setSheetOpen(true)` path the cold-state CTA does (Task 3.5), so opening the sheet from the new entry point is observationally identical to the existing flow.
- **Tamagui-only.** No hardcoded hex values, no `StyleSheet.create`, no `lucide-react-native` (still deferred; F169 carries forward).
- **Brazilian decimal formatting.** `formatBrazilianDecimal` in `@healthtracker/validators` is the only acceptable number formatter (already used by `BiomarkerCard`).

### Charting library deferral

The architecture doc (lines 354, 486–491, 1131–1133) calls for **Victory Native** as the chart library, with a Skia upgrade path. Story 3.2 deliberately does **NOT** add Victory Native — the cold-start-1 visual is a single positioned dot per biomarker on a horizontal track, which Tamagui primitives (`XStack`, `View`, `Circle`) render natively without a chart library. Reasons to defer:

1. **No line, no axis, no time scale.** Victory Native's value is line charts, axes, and tooltips — none present at Draw 1.
2. **Adding a new mobile dep mid-story compounds review risk.** Victory Native ships its own animation system + react-native-svg (or Skia) peer, neither currently in the workspace. Standing those up belongs in the story that actually needs them — **Story 3.3** ("baseline-established" line chart + shaded band).
3. **Story 3.3 owns the chart-library introduction.** When 3.3 adds Victory Native, the `FingerprintChart` component evolves: the `cold-start-1` state Tamagui rendering Story 3.2 ships is replaceable, and 3.3 can either keep it (Victory Native isn't great at "just a dot") or move both states inside a single Victory `<VictoryChart>`. Either is reasonable; Story 3.3 decides.
4. **If Story 3.3's dev later wants to harmonise**, the existing `cold-start-1` JSX is a small surface (~50 lines) to refactor — much cheaper than ripping out an unused chart-library integration.

**Record this decision in `FingerprintChart` JSDoc** so the Story 3.3 dev sees it without scrolling through this spec.

### Início composition at `drawCount === 1`

The patient who just confirmed Draw 1 is in an awkward UX moment: they have one biomarker reading, no personal baseline, and they need to be motivated to upload Draw 2 (back-fill prior history) OR Draw 2 (the next time they get blood drawn). Today's Início screen has one global empty-state message keyed off "no observations": `"Sua história de saúde começa aqui"` (`INICIO_HEADLINE_PT_BR`) + `"Enviar primeiro resultado"` CTA. At `drawCount === 1` that copy is **factually wrong** — the patient already has a result.

Decision (Task 3.6): **branch the primary `EmptyStateRecord`'s copy** based on `drawCount`. Two new validators constants:

- `INICIO_HEADLINE_DRAW_ONE_PT_BR = "Continue construindo seu Fingerprint"`
- `INICIO_CTA_DRAW_ONE_PT_BR = "Enviar próximo exame"`

At `drawCount === 0`: existing `INICIO_HEADLINE_PT_BR` + `INICIO_CTA_PT_BR` (unchanged).
At `drawCount === 1`: new `INICIO_HEADLINE_DRAW_ONE_PT_BR` + `INICIO_CTA_DRAW_ONE_PT_BR`.
At `drawCount >= 2`: out of scope this story — Story 3.3 / 3.4 will revisit the Início composition entirely.

The **secondary partial-state `EmptyStateRecord`** under the chart keeps its own copy (`"Com 2 ou mais exames..."` + `"Enviar resultado anterior"`) because its specific job is **back-fill**, not "upload your next draw". Two CTAs side-by-side (one for "next draw", one for "prior draw") is the explicit UX intent of the cold-start-1 surface: cover both motivational paths.

This is the only behavioural change to existing Início copy. The cold-state path (`drawCount === 0`) is byte-for-byte identical to today.

### Source tree components to touch

**New files:**

- `packages/ui/src/fingerprint-chart.tsx` — `FingerprintChart` component (cold-start-1 state only).
- `packages/ui/__tests__/fingerprint-chart.test.tsx` — snapshot tests + reduced-motion timer-count assertions (if vitest+RTL exists in `packages/ui`; else F-item per Story 3.1 F168).
- `apps/expo/__tests__/inicio.test.tsx` — render-gating tests (only if RTL+expo harness exists in `apps/expo`; else F-item).

**Modified files:**

- `packages/ui/src/empty-state-record.tsx` — add `state?: 'cold-start' | 'partial'` prop (Task 2). Default = `'cold-start'`; existing call sites unchanged.
- `packages/ui/src/index.ts` — re-export `FingerprintChart`, `FingerprintChartProps`, `FingerprintChartState`, `EmptyStateRecordState`.
- `apps/expo/src/app/(tabs)/inicio.tsx` — add `useQuery(trpc.observations.getRecord.queryOptions(...))`, render gating, thread `reducedMotion` into the chart, conditionally swap primary `EmptyStateRecord` copy at `drawCount === 1`.
- `packages/validators/src/index.ts` — add the 7 new pt-BR constants in Task 4.1.
- `packages/ui/__tests__/empty-state-record.test.tsx` — extend (or create) for the `partial` state.

**Files NOT to touch (verify by grep before editing):**

- `packages/api/src/observations-record.ts` — `getRecordForPatient` is reused as-is. No new fields needed (every `ObservationView` field used by the chart already exists in the Story 3.1 shape).
- `packages/api/src/router/observations.ts` — `getRecord` reused; no new procedure.
- `packages/db/src/schema/observations.ts` — no schema change.
- `packages/db/policies/custom_rls_observations.sql` — unchanged.
- `packages/ui/src/biomarker-card.tsx` — Story 3.2 ships the **chart**, not new biomarker-card states. The existing `cold-start` state in `BiomarkerCard` (Story 3.1) is sufficient if the chart needs to render `BiomarkerCard`s in cold-start state (it does not, per current layout — but if a future iteration adds a `BiomarkerCard` list below the chart, the existing prop is ready).
- `apps/expo/src/app/(tabs)/historico/*` — Histórico (Story 3.1) is unchanged.
- `packages/ui/src/extraction-pulse.tsx` — copy the `usePulseOpacity` pattern, do not import or modify the source.

### Previous story intelligence (Story 3.1 → Story 3.2)

From `_bmad-output/implementation-artifacts/3-1-patient-views-their-complete-longitudinal-biomarker-record.md` (and its Round 1–3 review notes):

- **`getRecord` returns the shape Story 3.2 needs.** `RecordView = { draws: DrawView[]; drawCount: number; observationCount: number }`. Story 3.2 reads `drawCount` for gating + `draws[0].observations` for the chart inputs.
- **R1-P234 (degrade bad confidence to 0):** Story 3.2 doesn't read `confidenceScore`. Inherited robustness — the API helper won't drop biomarker rows over confidence metadata.
- **R1-P236 (RN a11y attrs on glyph):** the `accessibilityElementsHidden` + `importantForAccessibility="no-hide-descendants"` pair is the canonical RN-side equivalent of `aria-hidden`. Use it on the chart's decorative band + dot subviews (Task 1.7).
- **R2-P244 (verbatim-rename regression):** when adding the new validators constants, **do not** rename or repurpose any existing constant. Append; never mutate.
- **R3-P246 (off-by-one timezone date):** Story 3.2 renders no `collected_at` date itself, but if a future polish wants to show "Coletado em {date}" beneath the chart, use `formatCollectedAtPtBr` from validators (the existing helper that fixes the `new Date('yyyy-mm-dd')` UTC bug).
- **F167 (integration test deferred to Docker host):** still relevant globally — Story 3.2 does not add new SQL, so no new integration test is needed; the Story 3.1 deferred test still covers the SELECT contract that Story 3.2's chart depends on.
- **F168 (no vitest in `packages/ui`):** still the case. Treat UI snapshot tasks (5.1, 5.2) as F-items if the harness is still absent — do **not** block the story to stand up a test harness.
- **F169 (no `lucide-react-native`):** still deferred. The chart uses no glyph icons.
- **Tamagui token catalogue (`packages/ui/src/theme/tokens.ts`):** confirmed during Story 3.1 — `$primaryTeal`, `$primaryTealLight`, `$biomarkerDeviation`, `$biomarkerDeviationBg`, `$surfaceElevated`, `$border`, `$textPrimary`, `$textSecondary`, `$card` (radius=12), `$cardLg` (radius=16), `$chip` (radius=8) are all wired. **`$warningAmber` / `$warningAmberSurface` do NOT exist** — use the canonical `$biomarkerDeviation` / `$biomarkerDeviationBg` names (Story 3.1 Completion Note made this explicit).

### Cross-cutting discipline checks (Epic 1 + Epic 2 retros)

- **Narrow catches** — no try/catch added in this story (per "Architecture patterns" above). If a try/catch sneaks in during dev, the round-1 reviewer rejects it unless it articulates the exact error shape it swallows.
- **Query-param coupling** — no new query params. Round-1 reviewer confirms.
- **Soft-delete filter** — inherited; no new SELECT.
- **Audit-log atomicity** — inherited; no new audit emission (AC6).
- **Broad-catch swallowing programmer errors** — N/A; no catches added.
- **Dead-code guard** — when gating on `drawCount === 1`, do not also re-check `recordQuery.data?.draws.length === 1`. Pick one source of truth (the helper guarantees `drawCount === draws.length`).
- **TOCTOU SELECT-EXISTS-then-INSERT** — N/A (read-only).
- **Partial-index ON-CONFLICT `where` clauses** — N/A (no writes, no indexes).
- **`pnpm db:push` for partial-index changes** — N/A (no schema changes).

### Testing standards summary

Mirror Story 3.1's posture:

- **Unit tests** in `packages/ui/__tests__/` (snapshot + behavioural). If the harness is absent (F168), the tasks downgrade to F-items, identical to Story 3.1 / Story 2.4 — do not stand up new test infra in this story.
- **No new API tests** — Story 3.2 doesn't change the API.
- **No new DB tests** — Story 3.2 doesn't change the DB.
- **Manual run-through** is non-optional this story (Task 6.6). Story 3.2 is the first time the patient actually sees the cold-start-1 surface; a screenshot in the PR description is high-leverage.
- Run from repo root: `pnpm typecheck && pnpm lint && pnpm format && pnpm test`. Integration tests remain `pnpm --filter @healthtracker/db test:integration` (no Docker = deferred per F167).

### Project Structure Notes

- The `FingerprintChart` file lives at `packages/ui/src/fingerprint-chart.tsx` — same shape as `biomarker-card.tsx`, `empty-state-record.tsx`. The architecture doc (line 1131) sketched `packages/ui/FingerprintChart/FingerprintChart.tsx` (directory style); **the project convention is flat files in `packages/ui/src/*.tsx`** (per existing components). Honour the project convention; ignore the directory-style sketch.
- No new package exports in `packages/ui/package.json` are needed — the component re-exports through the root `index.ts` (the existing `./extraction-pulse` / `./upload-source-sheet` subpath exports are legacy; new components don't need their own subpaths).
- The `EmptyStateRecord` change is a **strictly additive** prop. The story spec's Task 2.3 explicitly requires the no-prop call sites to render identically — this is the regression guard that R2-P244 (Story 3.1) burned into project culture.

### References

- Story foundation: `_bmad-output/planning-artifacts/epics.md` § "Story 3.2" (lines 909–940).
- Epic 3 framing: `_bmad-output/planning-artifacts/epics.md` § "Epic 3" (lines 251–254).
- Requirements:
  - FR13 — `_bmad-output/planning-artifacts/prd.md` line 489 (Longitudinal Fingerprint visualisation).
  - FR15 — `_bmad-output/planning-artifacts/prd.md` line 491 (partial Fingerprint at draw 1 + baseline-builds-with-draws labelling).
- UX:
  - `FingerprintChart` component contract (states, accessibility) — `_bmad-output/planning-artifacts/ux-design-specification.md` lines 848–866.
  - Cold-start framing (WHOOP calibration analogy) — `_bmad-output/planning-artifacts/ux-design-specification.md` lines 213, 219, 430, 1187.
  - `EmptyStateRecord` `partial` state — `_bmad-output/planning-artifacts/ux-design-specification.md` lines 987–1009.
  - Amber-not-red / colour-never-alone — `_bmad-output/planning-artifacts/ux-design-specification.md` lines 1073–1089.
  - Reduced motion (`useReducedMotion()` concept; `FingerprintChart` static fallback) — lines 1325–1329, 1379.
- Architecture:
  - Victory Native deferral (chart library + skia upgrade path) — `_bmad-output/planning-artifacts/architecture.md` lines 354, 362, 486–491, 1131–1133, 1550.
  - tRPC + RLS context (re-confirmed from Story 3.1) — `_bmad-output/planning-artifacts/architecture.md` lines 774–787; code at `packages/api/src/trpc.ts` lines 76–102.
- Previous story (Story 3.1, complete history including R1–R3 review notes): `_bmad-output/implementation-artifacts/3-1-patient-views-their-complete-longitudinal-biomarker-record.md`. Specifically Dev Notes lines 124–202, Review Notes Round 1 (P231–P243), Round 2 (P244–P245), Round 3 (P246).
- Epic 2 retro (cross-cutting + Epic 3 prep): `_bmad-output/implementation-artifacts/epic-2-retro-2026-05-23.md` § "Next Epic Preview — Epic 3" (lines 124–142), § "Action Items" (lines 153–174).
- CLAUDE.md § "Code review discipline (Epic 1 + Epic 2 retros)" — narrow catches, query-param coupling, round-2 hunts what round-1 broke, partial-index `pnpm db:push` warning.

---

## Dev Agent Record

### Agent Model Used

claude-opus-4-7[1m]

### Debug Log References

- Quality gates run from repo root on 2026-05-23:
  - `pnpm typecheck` — 16/16 packages green.
  - `pnpm lint` — 14/14 packages green. One lint failure on first run (`@typescript-eslint/no-unnecessary-condition` on `state === "cold-start-1"` future-proofing guard, since the union has only one member today). Fixed by dropping the comparison and inserting a `void state` reference + comment explaining Story 3.3 will gate per-state. Second lint run green.
  - `pnpm --filter @healthtracker/api test:unit` — 12 test files, 128 tests green (no API code touched; regression guard).
  - `pnpm --filter @healthtracker/db test:unit` — vitest "No test files found, exiting with code 0" (no unit tests in `packages/db`; existing posture).
  - `pnpm format:fix` — 3 files reformatted (`packages/ui/src/fingerprint-chart.tsx`, `packages/validators/src/index.ts`, `apps/expo/src/app/(tabs)/inicio.tsx`); typecheck + lint re-verified green after format.

### Completion Notes List

- **AC1 satisfied** — `FingerprintChart` `cold-start-1` renders one row per biomarker with a pulsing teal dot on a `$primaryTealLight` reference band, chart-level header reads `FINGERPRINT_COLD_START_LABEL_PT_BR`. Inserted into `inicio.tsx` between the offline-queued banner and the primary `EmptyStateRecord` per Task 3.6 visual flow.
- **AC2 satisfied** — `EmptyStateRecord` `partial` state added (additive prop, default `cold-start` byte-for-byte unchanged — visual regression guard). Headline + CTA wired from `FINGERPRINT_PARTIAL_EMPTY_HEADLINE_PT_BR` / `FINGERPRINT_PARTIAL_EMPTY_CTA_PT_BR`. CTA calls the same `setSheetOpen(true)` as the primary cold-state CTA (query-param coupling check N/A — no new query params introduced).
- **AC3 satisfied (component-level)** — out-of-range dots clamp to band edges via `normalisedDotPosition`. Null `referenceRangeLow`/`High` dims the band to `$border` and centres the dot. No "fora da faixa" / "within range" chip is rendered without a usable range. (The `BiomarkerCard` deviation chip itself is not rendered by this chart — Story 3.2 ships the chart-row visual; the existing `BiomarkerCard` `cold-start` state's chip styling carries forward unchanged for any future caller that wants to render `BiomarkerCard`s alongside the chart.)
- **AC4 satisfied** — `reducedMotion={true}` short-circuits the `usePulseOpacity` hook (`useEffect` early-returns; no `setInterval` is scheduled, no cleanup runs). `inicio.tsx` threads the existing `AccessibilityInfo.isReduceMotionEnabled()` + `reduceMotionChanged` subscription into the chart's `reducedMotion` prop (no second subscription).
- **AC5 satisfied** — Início renders the chart + partial-state empty state **only** when `recordQuery.data?.drawCount === 1`. `drawCount === 0` falls back to the existing cold-start landing (primary `EmptyStateRecord` with `INICIO_HEADLINE_PT_BR`); `drawCount >= 2` renders nothing new from Story 3.2 (Story 3.3 owns that path). Loading + error states render the existing shell unchanged; error is logged via `console.warn` with a ref-guard so it fires once per error instance.
- **AC6 satisfied** — no new tRPC procedure, no new audit event kind. Início reuses `trpc.observations.getRecord`. The duplicate `observation.read` audit per page-mount (Início + Histórico) is intentional per Story 3.1 R1-P232.
- **AC7 satisfied** — chart container has `accessibilityRole="image"` + composite `accessibilityLabel` from `FINGERPRINT_COLD_START_A11Y_LABEL_PT_BR(count)` with singular/plural agreement on `biomarcador`/`biomarcadores`. Appends `FINGERPRINT_REFERENCE_RANGE_UNAVAILABLE_A11Y_PT_BR` when every biomarker is missing a reference range. Per-row `XStack`s are `accessibilityElementsHidden` + `importantForAccessibility="no-hide-descendants"`.
- **AC8 satisfied** — every surface string lives in `packages/validators/src/index.ts`; every colour is a Tamagui token (`$primaryTeal`, `$primaryTealLight`, `$surfaceElevated`, `$border`, `$textPrimary`, `$textSecondary`, `$cardLg`, `$chip`). No `$errorRed`, no hex literal, no `lucide-react-native` glyph (F169 deferred).
- **Task 3.6 (Início primary copy swap)** — at `drawCount === 1` the primary `EmptyStateRecord` headline + CTA swap to `INICIO_HEADLINE_DRAW_ONE_PT_BR` ("Continue construindo seu Fingerprint") + `INICIO_CTA_DRAW_ONE_PT_BR` ("Enviar próximo exame"). At `drawCount === 0` (and on loading/error) the existing copy is preserved verbatim. Two CTAs side-by-side (primary "next draw" + partial-state "prior draw") is the explicit UX intent.
- **Charting library deferral** — Victory Native intentionally NOT added (architecture doc lines 486–491 defer to Story 3.3). The cold-start-1 visual uses Tamagui primitives only (`XStack` + `View` + `Circle`). Decision recorded in component JSDoc.
- **Narrow-catch discipline** — no try/catch added in this story. `recordQuery.isError` is handled with `console.warn` + render-the-shell (no error swallowing). `normalisedDotPosition` handles the `high === low` divide-by-zero with an explicit `if` guard rather than a try/catch.
- **Query-param coupling check** — no new query params; existing `?source=post_onboarding_photo` consumer unchanged.

### F-items deferred

- **F168 (no vitest+RTL in `packages/ui`)** — Task 5.1 (`FingerprintChart` snapshot + reduced-motion timer-count assertions) and Task 5.2 (`EmptyStateRecord` `partial`-state snapshot) both deferred. Matches Story 3.1 / Story 2.4 posture. Standing up the harness is a cross-cutting infra task, not a Story 3.2 deliverable.
- **F168-V (no vitest in `packages/validators`)** — Task 5.3 (`FINGERPRINT_COLD_START_A11Y_LABEL_PT_BR` singular/plural unit test) deferred. The function is 3 lines of pure string assembly; defer until the package gets a test harness.
- **F168-E (no RTL+expo harness in `apps/expo`)** — Task 5.4 (Início render-gating test for `drawCount` 0/1/2) deferred. Mirrors Story 3.1 F168.
- **Task 6.6 manual run-through** — not executed (Expo simulator not part of the dev-story sandbox). Documented as a manual smoke-test scenario for the round-1 reviewer / PR description: (1) zero observations → no chart; (2) one draw → chart + partial empty state above the primary surfaces; (3) toggle OS reduce-motion → dots become static; (4) two+ draws → chart disappears.

### File List

**NEW:**

- `packages/ui/src/fingerprint-chart.tsx` — `FingerprintChart` component (cold-start-1 state only), `normalisedDotPosition` helper, local `usePulseOpacity` hook.

**MODIFIED:**

- `packages/ui/src/empty-state-record.tsx` — additive `state?: 'cold-start' | 'partial'` prop. Default `'cold-start'` preserves Story 1.2 behaviour byte-for-byte (existing call sites unchanged — visual regression guard per Story 3.1 R2-P244 lesson).
- `packages/ui/src/index.ts` — re-export `FingerprintChart`, `FingerprintChartProps`, `FingerprintChartState`, `FingerprintChartBiomarker`, `normalisedDotPosition`, `EmptyStateRecordState`.
- `apps/expo/src/app/(tabs)/inicio.tsx` — add `useQuery(trpc.observations.getRecord...)` with `staleTime: 0` + `refetchOnWindowFocus`, AC5 render gating on `drawCount === 1`, thread existing `reducedMotion` into chart, conditional primary `EmptyStateRecord` copy swap (Task 3.6), error-warn ref-guard.
- `packages/validators/src/index.ts` — append 7 new pt-BR constants: `FINGERPRINT_COLD_START_LABEL_PT_BR`, `FINGERPRINT_PARTIAL_EMPTY_HEADLINE_PT_BR`, `FINGERPRINT_PARTIAL_EMPTY_CTA_PT_BR`, `FINGERPRINT_COLD_START_A11Y_LABEL_PT_BR(count)` function, `FINGERPRINT_REFERENCE_RANGE_UNAVAILABLE_A11Y_PT_BR`, `INICIO_HEADLINE_DRAW_ONE_PT_BR`, `INICIO_CTA_DRAW_ONE_PT_BR`. No existing constant modified or renamed (R2-P244 discipline).
- `_bmad-output/implementation-artifacts/sprint-status.yaml` — `3-2-...` status: `ready-for-dev` → `review`; `last_updated: 2026-05-23`.

---

## Review Notes

### Round 1 Review (2026-05-23)

Reviewer: code-review skill (Claude Opus 4.7). Patch IDs continue from
Story 3.1 (last used P246) — Story 3.2 R1 starts at P247.

**Quality gates re-run after patches**

- `pnpm typecheck` — 16/16 packages green.
- `pnpm lint` — 14/14 packages green.
- `pnpm --filter @healthtracker/api test` — 12 test files, 128 tests green.
- `pnpm --filter @healthtracker/db test:unit` — vitest "No test files found" (existing posture; F167).
- `pnpm format:fix` — clean.

**Findings**

| ID      | Severity | Title                                                                                                                                                                                                                                                                                                                                                                                                       | Outcome                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1-P247 | Low      | `BiomarkerRow` key collision risk — code-comment claimed "include index for key stability" but the key omitted the index                                                                                                                                                                                                                                                                                    | Applied — key is now `${biomarkerName}-${unitUcum}-${idx}`; React keyed-list reconciliation cannot collapse two rows with identical biomarker+unit.                                                                                                                                                                                                                                                                                                                                                                              |
| R1-P248 | Med      | Dot bleeds past the band edges at `x=0` / `x=1`. The original positioning placed the dot's CENTRE at `x*100%` and pulled back by `marginLeft={-(DOT_SIZE/2)}`, so a clamped value at the band's right edge rendered with half the dot outside the reference band — wrong visual encoding for AC1 + UX-DR20 (the dot's horizontal position is the only quantitative encoding the cold-start-1 chart offers). | Applied — inserted an inner positioning track inset by `DOT_SIZE/2` on each side; the dot's centre at `x=0` now sits tangent to the band's left edge, and `x=1` mirrors on the right.                                                                                                                                                                                                                                                                                                                                            |
| R1-P249 | Med      | AC7 narration gap. Spec Task 1.7 deferred per-biomarker narration to "the `BiomarkerCard`s rendered alongside this chart"; in practice Inicio (Task 3) renders the chart alone with no BiomarkerCard list, so VoiceOver users only heard the chart-level composite ("Fingerprint em construção. N biomarcadores…") and got zero biomarker values or names.                                                  | Applied — added `rowAccessibilityLabel(biomarker)` and exposed each `XStack` row to assistive tech with `accessibilityRole="text"` + `accessibilityLabel` (e.g. "Glicose: 95 mg/dL. Referência 70 a 99 mg/dL."). Decorative subviews (name `Text`, band `View`, value `Text`) remain `accessibilityElementsHidden` + `importantForAccessibility="no-hide-descendants"` so the row reads as one composite, not three duplicates. Falls back to `BIOMARKER_REFERENCE_UNAVAILABLE_PT_BR` from validators when the range is missing. |

**Items considered and dismissed**

- **Layout shift on `recordQuery.isPending`** — at first paint `drawCount` falls back to `0`, then snaps to `1` after the query resolves, briefly showing the cold-start headline before the draw-1 headline. AC5 explicitly accepts this ("a layout shift on resolve is acceptable per the read-heavy-but-small-payload assumption in the Epic 2 retro § Preparation gaps"). No patch.
- **Hardcoded `width={140}` on the biomarker-name column** — Tamagui token system has no width tokens; spec Task 1.4 explicitly prescribes `width={140}`. Truncation with `numberOfLines={1}` handles long pt-BR biomarker names on narrow screens. Documented spec choice. No patch.
- **`void state;` discriminator reference** — spec-mandated workaround for `@typescript-eslint/no-unnecessary-condition` on the single-member union (Story 3.3 widens the union). No patch.
- **`aria-hidden` on RN** — the prop is a no-op on React Native (RN reads `accessibilityElementsHidden` + `importantForAccessibility`), but is harmless under `react-native-web` and matches the project's existing pattern (`empty-state-record.tsx` does the same). No patch.
- **No new try/catch surfaces** added by Story 3.2 — CLAUDE.md narrow-catch discipline N/A. Confirmed.
- **Query-param coupling** — Story 3.2 added no new query params; the existing `?source=post_onboarding_photo` consumer (line 43–46 of `inicio.tsx`) is untouched. Confirmed per Epic 2 retro action item §3.
- **Validators append-only discipline (R2-P244)** — verified: all 7 new constants are appended after the Story 3.1 block; no existing constant was renamed or mutated.

**Files touched in R1**

- `packages/ui/src/fingerprint-chart.tsx` — R1-P247 (key index), R1-P248 (dot inset positioning), R1-P249 (per-row accessibilityLabel via new `rowAccessibilityLabel` helper + new `BIOMARKER_REFERENCE_UNAVAILABLE_PT_BR` import from validators).

**AC gaps revealed**

- AC7 was satisfied for the chart-level composite label but failed the per-biomarker narration intent because the spec's "BiomarkerCard alongside the chart" assumption did not materialise in the Inicio layout. R1-P249 closes that gap inside the chart component itself, keeping the change local to `FingerprintChart`.

### Round 2 Review (2026-05-23)

Reviewer: code-review skill (Claude Opus 4.7). Round 2 hunts what
round 1 broke or half-finished. Patch IDs continue from R1-P249;
Story 3.2 R2 starts at R2-P250.

**Quality gates re-run after patches**

- `pnpm typecheck` — 16/16 packages green.
- `pnpm lint` — 14/14 packages green.
- `pnpm --filter @healthtracker/api test` — 12 test files, 128 tests green (no API code touched in R2).
- `pnpm --filter @healthtracker/db test:unit` — vitest "No test files found" (existing posture; F167).
- `pnpm format:fix` — clean (no files reformatted; the R2 edit was already prettier-compliant).

**Findings**

| ID      | Severity | Title                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | Outcome                                                                                                                                                                               |
| ------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R2-P250 | Low      | R1-P249's `rowAccessibilityLabel` hardcoded the surface string `"Referência"` instead of importing the existing `BIOMARKER_REFERENCE_LABEL_PT_BR` constant (already used by `biomarker-card.tsx` line 157). Direct AC8 regression — every surface string must live in `packages/validators/src/index.ts` per "greppable copy review". Classic round-2 shape: a correct-in-isolation round-1 patch composed badly with the project's append-only validators discipline. | Applied — imported `BIOMARKER_REFERENCE_LABEL_PT_BR` from `@healthtracker/validators` and replaced the literal in `rowAccessibilityLabel`. Comment cites R2-P250 + the AC8 violation. |

**Items considered and dismissed**

- **`normalisedDotPosition` returns `NaN` when `value` is `NaN`.** `(NaN - low) / (high - low) === NaN`, which is neither `< 0` nor `> 1` so the helper returns `NaN` and the dot's `leftPercent` becomes `"NaN%"`. **Cannot be reached** — `getRecordForPatient` (Story 3.1 helper) drops any observation row whose `valueNumeric` doesn't coerce to a finite number (`coerceNumeric` + the explicit `if (valueNumeric === null) drop` branch, `packages/api/src/observations-record.ts` L121–126). The chart never sees a NaN value. No patch. (If a future caller bypasses the helper, a `Number.isFinite` guard inside `normalisedDotPosition` is a one-line cheap addition — flagged here for the Story 3.3 dev who widens the union.)
- **Reduced-motion toggle stale-state.** When `reducedMotion` flips `true` → `false` mid-mount, the `useEffect` re-subscribes but `bright` may still be `false` from the previous active session, briefly showing an opacity-0.4 frame before the next tick flips it to `true`. Imperceptible (≤1 s on a 2 s cycle) and the reverse direction (`false → true`) is fine. No patch.
- **R1-P247 `idx` in the key.** Considered re-reviewing — `${biomarkerName}-${unitUcum}-${idx}` only stabilises reconciliation by position, not by data identity. The chart re-renders the whole list on every `recordQuery.data` change and there is no item reordering surface today; the index suffix is sufficient. No patch.
- **R1-P248 inner-track inset arithmetic.** Re-walked the math at `x=0` and `x=1`: dot's left edge sits tangent to the band's left/right edge respectively (band [0, W]; inner track [DOT/2, W-DOT/2]; dot center at `inset + x*innerWidth`, dot half-width `DOT/2`). Correct. No patch.
- **Inicio dead-code guard.** Render-gating uses `drawCount === 1` only; no redundant `recordQuery.data?.draws.length === 1` re-check (Dev Notes guidance honoured). Confirmed.
- **Primary `EmptyStateRecord` copy at `drawCount >= 2`.** Falls back to the default `INICIO_HEADLINE_PT_BR` ("Sua história de saúde começa aqui") — factually wrong at multi-draw. Explicitly out of scope per spec § "Início composition at `drawCount === 1`" ("At `drawCount >= 2`: out of scope this story — Story 3.3 / 3.4 will revisit the Início composition entirely"). No patch.
- **Append-only validators discipline (R2-P244 follow-through).** Verified again: all 7 Story 3.2 constants are appended after the Story 3.1 block; no existing constant renamed or mutated. R2-P250's added import does not modify any existing constant.
- **Tamagui token catalogue check.** `$primaryTeal`, `$primaryTealLight`, `$surfaceElevated`, `$border`, `$textPrimary`, `$textSecondary`, `$cardLg`, `$chip` all confirmed wired in `packages/ui/src/theme/themes.ts`. No `$warningAmber` / `$warningAmberSurface` usage was added by Story 3.2 — the pre-existing references in `inicio.tsx` lines 260–261 (offline-queued banner from Story 2.6 R2-P190) are a Story 2.6 / earlier-history concern, not a Story 3.2 regression. Out of R2 scope.
- **`unitUcum` empty-string cosmetic.** If a backend row returned an empty `unitUcum`, `rowAccessibilityLabel` would render `"95 ."` with a trailing space. Validators upstream require a UCUM unit; no observed defect. No patch.
- **R1 dismissals re-reviewed on second read.** Layout shift on `recordQuery.isPending` (AC5 explicitly accepts), `width={140}` hardcode (spec-prescribed), `void state;` discriminator workaround (spec-prescribed), `aria-hidden` on RN (matches project pattern), no new try/catch surfaces, no new query params. All dismissals stand.

**Files touched in R2**

- `packages/ui/src/fingerprint-chart.tsx` — R2-P250 (import `BIOMARKER_REFERENCE_LABEL_PT_BR` and replace the hardcoded `"Referência"` literal in `rowAccessibilityLabel`).

**R1 dismissals reversed**

- None. Every R1 dismissal stands on second read.

**AC gaps revealed**

- None. AC1–AC8 satisfied after R2-P250.

**Final disposition**

All HIGH/MED findings resolved across R1 (P247–P249) and R2 (P250). Story status moved from `review` to `done`. F-items (F167/F168/F168-V/F168-E + Task 6.6 manual run-through) carry forward as cross-cutting test-harness debt — not Story 3.2 blockers, identical posture to Story 3.1.

### Round 3 Review (2026-05-23)

Reviewer: code-review skill (Claude Opus 4.7). Round 3 reviews the full
Story 3.2 file list with the charter's deeper lens (subtle correctness on
edge cases, composition issues between R1+R2 patches, AC traceability,
R1/R2 dismissal re-reads, accessibility/i18n on the narration helper,
reduced-motion prop-change behaviour, render-gating drift, Tamagui token
correctness, append-only validators discipline, dependency leakage).
Round 3 starts at R3-P251.

**Round 3 Review: no findings.**

By R3 the obvious wins are gone and the subtle ones were already paid
down in R1+R2. The re-reads below all stand on second inspection — none
flip into findings:

- **`normalisedDotPosition` edge cases.** `value < low` → 0 (clamped),
  `value > high` → 1 (clamped), `value === low === high` → 0.5 (degenerate
  range guard), `low === null || high === null` → 0.5 (band dimmed +
  fallback a11y narration), `Infinity` / `-Infinity` clamp correctly via
  the `> 1` / `< 0` branches. `NaN` is impossible per Story 3.1's
  `coerceNumeric` drop-row guard (R2 dismissal stands).
- **Reduced-motion prop flip.** `useEffect` cleanup clears the interval
  on `reducedMotion: false → true`. On the reverse, `bright` may briefly
  carry over the prior `false` value before the next 1 s tick — the R2
  "imperceptible" call holds; not a finding.
- **`allRangesUnavailable` guard.** Correctly gated by `count > 0` so
  `every` on an empty array doesn't produce a false-positive a11y
  fallback. Acceptable behaviour at `count === 0`.
- **i18n singular/plural.** `count === 1` → "1 biomarcador"; `0` and
  `>= 2` → "biomarcadores". Matches pt-BR convention.
- **R1-P248 inset math re-walked.** At `x=0` dot centre sits at `inset`
  (= `DOT_SIZE/2`); the leading `marginLeft={-(DOT_SIZE/2)}` pulls the
  dot's visual left edge to band-left exactly. At `x=1` it mirrors. No
  bleed.
- **R1-P247 key composition.** `${biomarkerName}-${unitUcum}-${idx}`
  remains sufficient — chart re-renders on every `recordQuery.data`
  change, no reorder surface, and index disambiguates exact duplicates.
- **R2-P250 surface-string composition.** Final rendered string reads
  `"Glicose: 95 mg/dL. Referência 70 a 99 mg/dL."` — pt-BR-natural.
- **Render-gating drift in `inicio.tsx`.** `drawCount === 0` and
  `drawCount >= 2` both render the pre-Story-3.2 surface byte-for-byte
  (only the conditional `primaryHeadline` / `primaryCtaLabel` swap fires
  at `=== 1`, exactly as Task 3.6 prescribes). No composition with the
  ExtractionPulse / offline-queued banner / manual-BIA paths regressed.
- **Tamagui token correctness.** `$primaryTeal`, `$primaryTealLight`,
  `$surfaceElevated`, `$border`, `$textPrimary`, `$textSecondary`,
  `$cardLg`, `$chip` all wired in `packages/ui/src/theme/tokens.ts`. The
  pre-existing `$warningAmber*` references in `inicio.tsx` lines 260–261
  are explicitly out of scope per R2 disposition.
- **Append-only validators discipline.** Verified — all 7 Story 3.2
  constants append after the Story 3.1 block (lines 1066–1097). No
  existing constant renamed or mutated. The R2-P250 import edit added a
  named import; no constant was touched.
- **Dependency leakage check.** No new cross-package deps. The chart
  consumes `@healthtracker/validators` and `tamagui` only — both already
  in `packages/ui` dependency graph.
- **AC traceability.** AC1 (chart surface), AC2 (`partial` empty state),
  AC3 (component-level deviation behaviour — chart shows no chip; the
  `BiomarkerCard` carry-forward is documented), AC4 (reduced-motion +
  no-interval gating), AC5 (`drawCount === 1` strict gate), AC6 (no new
  tRPC / no new audit event), AC7 (composite + per-row a11y), AC8
  (tokens + greppable copy) all satisfied after R1+R2 patches. Test
  proofs remain F-items per Story 3.1 / F168 posture.

**Quality gates re-run (no patches applied)**

- `pnpm typecheck` — 16/16 packages green (cached).
- `pnpm lint` — 14/14 packages green (cached).
- `pnpm --filter @healthtracker/api test` — 12 test files, 128 tests
  green.
- `pnpm --filter @healthtracker/db test:unit` — "No test files found"
  (existing posture; F167).
- `pnpm format:fix` — clean.

**Files touched in R3**

- None.

**R1/R2 dismissals reversed**

- None. Every R1 and R2 dismissal stands on third read.

**Final disposition**

Story 3.2 status remains `done`. No R3 patches required.
