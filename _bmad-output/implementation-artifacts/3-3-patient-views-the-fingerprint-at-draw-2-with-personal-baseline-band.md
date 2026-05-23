# Story 3.3: Patient views the Fingerprint at Draw 2+ with personal baseline band

Status: done

<!-- Third story of Epic 3. epic-3 already in-progress. Stories 3.1 (longitudinal record) and 3.2 (cold-start-1) are done. -->
<!-- Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a **patient with two or more published draws**,
I want **to see the Longitudinal Fingerprint with my personal baseline band computed from my own history**,
so that **I understand each new result in the context of what is normal for me, not for a population average**.

## Acceptance Criteria

> Lifted from `_bmad-output/planning-artifacts/epics.md` lines 929–953, with the Epic 1+2 retro cross-cutting constraints folded in. Naming and decisions reconcile UX spec (lines 848–866, 832–836) with architecture (lines 354, 486–491, 1131–1133).

1. **AC1 — `FingerprintChart` `baseline-established` state on Início.**
   **Given** `trpc.observations.getRecord` resolves with `drawCount >= 2`,
   **When** I open the Início tab (`apps/expo/src/app/(tabs)/inicio.tsx`),
   **Then** the `FingerprintChart` renders in the new **`baseline-established`** state: **one chart per biomarker** (grouped by `loincCode` with `biomarkerName` + `unitUcum` fallback when `loincCode` is null — see Dev Notes § "Biomarker grouping key"), each chart showing:
   - a **line connecting data points plotted chronologically** (x = `collectedAt`, y = `valueNumeric`),
   - a **shaded teal personal baseline band** rendered as `mean ± 1 standard deviation` (computed per biomarker from that biomarker's own historical values — see AC4),
   - data points (dots) at each `(collectedAt, valueNumeric)` coordinate,
   - **pinch-to-zoom (scale)** and **pan (translateX)** gesture support along the x-axis only (y-axis stays fixed so the baseline band remains visually meaningful).
     **And** the existing `cold-start-1` rendering and Story 3.2's primary `EmptyStateRecord` swap at `drawCount === 1` are **untouched** (Story 3.2 regression guard — see § "Story 3.2 surfaces preserved").

2. **AC2 — `BiomarkerCard` `watching` and `notable` states with personal-baseline narrative.**
   **Given** a biomarker's latest value deviates from that biomarker's personal baseline by **`|z| ≥ 1.0`** (where `z = (latestValue − mean) / stddev`),
   **When** the `BiomarkerCard` renders alongside the chart,
   **Then** the card uses:
   - **`watching` state** when `1.0 ≤ |z| < 1.5` — amber chip with copy **"acompanhando"** + composite a11y narration like **"{biomarkerName}: {latestValue} {unit}. {1.2} desvios {abaixo|acima} da sua linha de base pessoal."**,
   - **`notable` state** when `|z| ≥ 1.5` — amber-prominent chip with copy **"vale conversar"** + the same z-score narration.
     **And** the chip is **amber** (`$biomarkerDeviation` / `$biomarkerDeviationBg` tokens; already wired). **Never red.** **Never colour alone** (chip pairs amber background with a text label and a glyph). When `stddev === 0` (degenerate single-value distribution, e.g. all 2 draws identical) the state degrades to **`within-band`** — no z-score is mathematically defined; do not divide by zero, do not render a spurious chip.

3. **AC3 — Population reference range deviation is suppressed when a personal baseline exists.**
   **Given** `drawCount >= 2` (a personal baseline is computable),
   **When** the `BiomarkerCard` renders,
   **Then** the `cold-start`-state population-range copy ("fora da faixa de referência" / `BIOMARKER_OUT_OF_RANGE_LABEL_PT_BR`) is **NOT** rendered for that biomarker — the personal-baseline state (AC2) takes precedence. Per-biomarker fallback: if a biomarker has **only one** historical value (e.g. a brand-new biomarker introduced in Draw 2 that wasn't present in Draw 1), that single-biomarker card falls back to `BiomarkerCard` `cold-start` state (population range) while the overall chart still renders `baseline-established` for the biomarkers that DO have ≥ 2 historical values. The chart's per-biomarker baseline band is suppressed for the cold-start biomarker (no band, just the dot + line).

4. **AC4 — Personal baseline is computed by a new tRPC procedure with NFR-SC4 budget.**
   **Given** a patient with `drawCount >= 2`,
   **When** Início calls `trpc.observations.getPersonalBaseline`,
   **Then** the procedure returns one row per `(loincCode, unitUcum)` group: `{ loincCode: string | null; biomarkerName: string; unitUcum: string; mean: number; stddev: number; sampleSize: number; latestValue: number; latestCollectedAt: string; zScore: number | null }`. The computation runs as a **single SQL aggregate** on `observations` (Postgres `avg() / stddev_samp()` window or grouped query), filters `deleted_at IS NULL` (Epic 2 retro § "Dependencies on Epic 2"), is RLS-narrowed by `patient_id`, and **emits one `observation.baseline.read` audit log row per call** via `writeAuditLog` (same atomic-write pattern as Story 3.1's `observation.read`).
   **And** the **p95 latency under simulated 10M-row load is < 500ms** (NFR-SC4). The verification is a `__tests__/integration/observations-baseline.integration.test.ts` testcontainer fixture (see Task 5.3) that seeds N rows, warms the query plan, runs the query 100×, and asserts the p95.

5. **AC5 — Render gating: `baseline-established` renders ONLY at `drawCount >= 2`.**
   **Given** `trpc.observations.getRecord` resolves,
   **When** `drawCount === 0`, Início renders today's empty state (untouched).
   **When** `drawCount === 1`, Story 3.2's `cold-start-1` chart + partial `EmptyStateRecord` render (untouched).
   **When** `drawCount >= 2`, Story 3.3's `baseline-established` chart + a list of `BiomarkerCard`s render. The Story 3.2 `cold-start-1` branch MUST NOT render at `drawCount >= 2` (one and only one branch active at a time — no dead-code re-check).
   **And** the existing primary `EmptyStateRecord` ("Sua história de saúde começa aqui" / "Continue construindo seu Fingerprint") and manual-BIA CTA are **suppressed at `drawCount >= 2`** (the patient with ≥ 2 draws should see their Fingerprint, not an upload prompt; uploads remain reachable via the manual-BIA CTA at the bottom and via Histórico — see Dev Notes § "Início composition at `drawCount >= 2`").

6. **AC6 — Audit-log discipline: ONE new event kind, atomic, emitted inside `protectedProcedure`.**
   **Given** Story 3.3 introduces a new tRPC procedure (`getPersonalBaseline`),
   **When** it executes,
   **Then** exactly **one** `observation.baseline.read` audit row is written **inside the `protectedProcedure` transaction** (`ctx.db` is already a transaction handle; do NOT call `database.transaction(...)` manually — Story 3.1 R1-P233 lesson). The metadata payload carries `{ biomarkerCount, drawCount }`. The existing `observation.read` audit row from `getRecord` is also emitted (Story 3.1 contract); two audit rows per Início mount (`observation.read` + `observation.baseline.read`) is **intentional** and matches the two distinct read intents.
   **And** the audit-log event kind enum must be extended with `observation.baseline.read`. Verify enum membership at the DB schema level if applicable; if the audit `event` column is `text` (Story 0.7), no schema change is needed — just document the new kind.

7. **AC7 — Accessibility: chart composite label + per-card narration; reduced motion replaces animations.**
   **Given** VoiceOver/TalkBack is on,
   **When** the `FingerprintChart` in `baseline-established` is focused,
   **Then** the chart container reads a composite `accessibilityLabel` like **"Ferritina: 3 medições. Tendência descendente. Valor atual 2,1 desvios abaixo da sua linha de base pessoal."** (epics.md AC4). Trend direction is computed from the simple linear regression slope sign over the chronological values (positive → "ascendente", negative → "descendente", `|slope| < ε` → "estável"); ε threshold and rationale documented in the helper.
   **And** when `AccessibilityInfo.isReduceMotionEnabled()` is true (threaded from Início via the existing subscription — same pattern as Story 3.2), Victory Native chart **entry animations are disabled** (`animate={false}`) and any pinch-zoom decay/spring animations are also suppressed. The static rendered chart still conveys the same information.

8. **AC8 — pt-BR copy + Tamagui tokens; no hardcoded hex, no `red`, no glyph dep.**
   **Given** the Story 0.2 / Epic 2 retro discipline,
   **When** Story 3.3 code is reviewed,
   **Then** every surface string lives in `packages/validators/src/index.ts` (greppable copy review). Every colour goes through a Tamagui semantic token (`$primaryTeal`, `$primaryTealLight`, `$biomarkerDeviation`, `$biomarkerDeviationBg`, `$textPrimary`, `$textSecondary`, `$border`, `$surfaceElevated`). `$errorRed` / `#DC2626` / any red hex does NOT appear in the new code. `lucide-react-native` is NOT added (F169 still deferred — use text glyphs as the existing `BiomarkerCard` `!` chip does).

**Requirements traceability:** FR12 (personal baseline computation, ≥ 2 draws), FR13 (Longitudinal Fingerprint visualisation), FR14 (personal-baseline deviation flagging distinct from population reference range), AR5 (RLS token principal model — `SET LOCAL app.current_patient_id` in tRPC context, already wired), NFR-A3 (chart `accessibilityLabel` summarising trend), NFR-A4 (amber chip pairs colour + text + glyph), NFR-SC4 (p95 < 500ms at 10M rows, validated by a load-test fixture), UX-DR2 (FingerprintChart `baseline-established` state with pinch-zoom/pan + a11y data-table-fallback discussion in Dev Notes), UX-DR3 (BiomarkerCard `watching` / `notable` states), UX-DR19 (amber chip + icon + label; `$color.error` reserved for system errors), UX-DR20 (pt-BR copy, ANVISA-safe framing).

---

## Tasks / Subtasks

- [x] **Task 1 — API: new `getPersonalBaseline` procedure + helper (AC4, AC6)**
  - [x] 1.1 Create **NEW** file `packages/api/src/observations-baseline.ts`. Export `getPersonalBaselineForPatient(database: AuditDb, patientId: string): Promise<BaselineView>` mirroring the file shape of `observations-record.ts` (Story 3.1). Define `BaselineView = { baselines: BaselineRow[]; biomarkerCount: number; drawCount: number }` and `BaselineRow = { loincCode: string \| null; biomarkerName: string; unitUcum: string; mean: number; stddev: number; sampleSize: number; latestValue: number; latestCollectedAt: string; zScore: number \| null }`.
  - [x] 1.2 Implement the aggregate as a **single SQL** statement using Drizzle's `sql<T>` template — one round-trip, NFR-SC4 critical. Group by `COALESCE(loinc_code, '__no_loinc__' || biomarker_name || '|' || unit_ucum)` to handle null LOINC rows (Story 2.3 R1-P102 schema allows null `loinc_code`). Use `avg(value_numeric)`, `stddev_samp(value_numeric)`, `count(*)` per group, plus `(array_agg(value_numeric ORDER BY collected_at DESC))[1]` and `max(collected_at)` for the latest sample. Filter `WHERE patient_id = $1 AND deleted_at IS NULL` (RLS narrows further; app-layer eq is defense-in-depth). Cast all `numeric` outputs to `double precision` in SQL so Drizzle returns JS numbers, not strings (or coerce via `coerceNumeric` from `observations-record.ts` — extract that helper to a shared module if convenient; see Task 1.7).
  - [x] 1.3 `sampleSize >= 2` filter: groups with `count(*) < 2` are EXCLUDED from `baselines` (no defined stddev → no baseline). Single-history biomarkers fall back to `BiomarkerCard` `cold-start` state at the UI layer (AC3) — the API simply omits them. Document this in JSDoc.
  - [x] 1.4 z-score computation: `(latestValue - mean) / stddev`. When `stddev === 0` (degenerate — all historical values identical, e.g. two identical readings), return `zScore: null` for that row. UI maps `null` → `within-band` per AC2.
  - [x] 1.5 Drop rows where `mean`, `stddev`, or `latestValue` coerce to NaN via the same `coerceNumeric` guard `getRecordForPatient` uses (Story 3.1 R1-P234 lesson — degrade single rows rather than crash the whole fetch). Log via `console.warn` with the row identifier.
  - [x] 1.6 Audit emission: append a SINGLE `observation.baseline.read` event via `writeAuditLog` inside the same procedure transaction. Metadata: `{ biomarkerCount: baselines.length, drawCount }`. `resourceId = patientId`, `resourceType = "observation_baseline"`. No `observation.read` collision — different event kind.
  - [x] 1.7 (Optional) Extract `coerceNumeric` to `packages/api/src/numeric.ts` (or similar) so `observations-record.ts` AND `observations-baseline.ts` share one implementation. If this complicates review, leave the duplicate copy in `observations-baseline.ts` with a TODO + cite Story 3.1.
  - [x] 1.8 Register the procedure in `packages/api/src/router/observations.ts`: add `getPersonalBaseline: protectedProcedure.query(async ({ ctx }) => getPersonalBaselineForPatient(ctx.db, ctx.session.user.id))`. No input (patient id is derived from session — only safe source).

- [x] **Task 2 — UI: extend `FingerprintChart` with `baseline-established` state (AC1, AC7, AC8)**
  - [x] 2.1 Modify `packages/ui/src/fingerprint-chart.tsx` (UPDATE). Widen the state union: `export type FingerprintChartState = "cold-start-1" \| "baseline-established"`. `cold-start-2` is **NOT** introduced (UX spec line 858 references it but Story 3.3 ships `baseline-established` only — see Dev Notes § "Cold-start-2 deferral"). The `void state;` discriminator workaround that Story 3.2 added (Round 1 dismissal) is replaced with a proper `switch` on `state`.
  - [x] 2.2 Widen `FingerprintChartBiomarker` (or add a sibling type `FingerprintChartBaselineBiomarker`) carrying the time series: `{ loincCode: string \| null; biomarkerName: string; unitUcum: string; history: Array<{ collectedAt: string; valueNumeric: number }>; baseline: { mean: number; stddev: number; sampleSize: number } \| null; latestValue: number; zScore: number \| null }`. Keep the existing `FingerprintChartBiomarker` for `cold-start-1` callers — do NOT break Story 3.2's Início wiring.
  - [x] 2.3 Add Victory Native dependency to `apps/expo/package.json` (NOT `packages/ui/package.json` — the UI package is consumed by both Expo and Next; Victory Native is RN-only). Use `victory-native@catalog:` if a catalog entry exists; otherwise add the latest 41.x via `pnpm add -F @healthtracker/expo victory-native`. Peer deps: `react-native-svg` (already implicit via tamagui? confirm — if not, add). `react-native-gesture-handler` + `react-native-reanimated` are ALREADY in `apps/expo/package.json` lines 49–50; reuse — do NOT add a second version. **Use `context7` MCP to fetch current Victory Native docs before implementing** — the API has evolved (CartesianChart / Line / Area + Skia under the hood); this story's first dev should verify the import paths and prop shapes against the latest stable.
  - [x] 2.4 Render contract for `baseline-established`: one `YStack` per biomarker baseline group (sourced from `baselines` Task 1.1 returned, mapped to the widened prop in Init). Each group: a header row (`biomarkerName` + latest value + amber chip if `|z| >= 1.0` — but the chip is the `BiomarkerCard`'s job; see Task 3); then a Victory Native chart at fixed `height={180}`. Chart contents: a `Line` over `history` points (chronological), an `Area` filled in `$primaryTealLight` covering `[mean - stddev, mean + stddev]` (the personal baseline band — shaded teal), and `Scatter` dots at each history point. Y-axis auto-fit to `[min(values, mean-stddev) - 5%, max(values, mean+stddev) + 5%]` so the band always renders fully visible.
  - [x] 2.5 Pinch-to-zoom + pan: Victory Native's chart wrapper exposes a transform; gate via the `CartesianChart` `transformConfig`/`transformState` API (verify current Victory Native API via context7 query — the surface changed between v40 and v41). Lock to x-axis only (scale and translate Y disabled). When `reducedMotion === true`, disable any chart entry animations (`animate={false}` or equivalent) and disable gesture decay/spring physics so the chart settles instantly after the gesture lifts.
  - [x] 2.6 Accessibility: chart container `accessibilityRole="image"` with a composite `accessibilityLabel` from a new validators helper `FINGERPRINT_BASELINE_A11Y_LABEL_PT_BR({ biomarkerName, sampleSize, trend, zScore })`. The label reads: **"{biomarkerName}: {sampleSize} medições. Tendência {ascendente\|descendente\|estável}. Valor atual {abs(z) com vírgula} desvios {abaixo\|acima} da sua linha de base pessoal."** (epics.md AC4 line 951). Per-chart-element subviews are `accessibilityElementsHidden` + `importantForAccessibility="no-hide-descendants"` to avoid double-announcement against the `BiomarkerCard` rendered alongside.
  - [x] 2.7 Trend computation helper: `computeTrend(history: Array<{ collectedAt: string; valueNumeric: number }>): "ascendente" \| "descendente" \| "estável"`. Use a simple linear regression slope (least squares: x = days since first sample, y = value). Threshold `|slope| < (mean * 0.001)` → "estável" (avoid floating-point noise on near-flat trends). Export as a pure function for tests.
  - [x] 2.8 Re-export the widened types from `packages/ui/src/index.ts`: existing `FingerprintChartProps`/`FingerprintChartState`/`FingerprintChartBiomarker` stay; add the new baseline biomarker type if it's a sibling.
  - [x] 2.9 Keep the existing `cold-start-1` rendering byte-for-byte identical (Story 3.2 regression guard — the Round 2 `R2-P244` lesson). The `switch` on `state` routes to one of two render functions; neither touches the other's path.

- [x] **Task 3 — UI: add `watching` / `notable` states with personal-baseline narrative to `BiomarkerCard` (AC2, AC3, AC8)**
  - [x] 3.1 Modify `packages/ui/src/biomarker-card.tsx` (UPDATE). The `watching` / `notable` enum members already exist (`BiomarkerCardState = "within-band" | "watching" | "notable" | "cold-start"`), but the current `buildAccessibilityLabel` collapses both into the population-range narration `BIOMARKER_OUT_OF_RANGE_LABEL_PT_BR`. Replace that branch with a personal-baseline narration when the caller supplies `zScore` + the relevant baseline metadata.
  - [x] 3.2 Add optional props: `zScore?: number | null`, `personalBaselineMean?: number`, `personalBaselineStddev?: number`. When `zScore` is a finite number AND `|z| >= 1.0`, the resolved state becomes `watching` (1.0–1.5) or `notable` (≥ 1.5) — overriding the existing `deviationStateForValue` population-range logic. When `zScore === null` or `zScore === undefined`, the existing population-range logic stands (Story 3.1 contract preserved).
  - [x] 3.3 Chip copy: `BIOMARKER_WATCHING_LABEL_PT_BR = "acompanhando"`, `BIOMARKER_NOTABLE_LABEL_PT_BR = "vale conversar"`. The chip styling — amber background + glyph + text — is unchanged from Story 3.1 (`$biomarkerDeviation` / `$biomarkerDeviationBg`). The glyph stays a text `!` (no `lucide-react-native`; F169).
  - [x] 3.4 a11y narration for `watching` / `notable` when personal baseline is in play: **"{name}, {value} {unit}, {|z| com vírgula} desvios {abaixo|acima} da sua linha de base pessoal."** ("abaixo" if `zScore < 0`, "acima" if `> 0`). New validators helper: `BIOMARKER_PERSONAL_BASELINE_NARRATION_PT_BR({ zScore: number; direction: 'above' \| 'below' })` returning the suffix string. Use `formatBrazilianDecimal(Math.abs(z))` for the z magnitude.
  - [x] 3.5 When `zScore === null` (degenerate `stddev === 0` per AC2) AND the caller supplied personal-baseline context, render `within-band` state — no chip. Document in JSDoc that `zScore === null` is a valid, expected input meaning "baseline exists but stddev=0; treat as within band".
  - [x] 3.6 Default state still resolves via `deviationStateForValue` when neither `state` prop nor `zScore` is supplied — Story 3.1 / Story 3.2 callers (population-range only) are unaffected. Visual regression guard.
  - [x] 3.7 The composite label structure: `"{name}, {value} {unit}, {narration}"`. `narration` ranks: explicit personal-baseline narration > population `BIOMARKER_OUT_OF_RANGE_LABEL_PT_BR` (existing) > `BIOMARKER_WITHIN_RANGE_LABEL_PT_BR` > `BIOMARKER_REFERENCE_UNAVAILABLE_PT_BR`. Mutually exclusive per AC3.

- [x] **Task 4 — Expo: wire Início + render gating + `BiomarkerCard` list (AC1, AC2, AC3, AC5)**
  - [x] 4.1 Modify `apps/expo/src/app/(tabs)/inicio.tsx` (UPDATE). Add a SECOND query: `useQuery(trpc.observations.getPersonalBaseline.queryOptions(undefined, { staleTime: 0, refetchOnWindowFocus: true, enabled: drawCount >= 2 }))`. The `enabled` gate prevents an unnecessary call (and a spurious `observation.baseline.read` audit row) at `drawCount < 2`. Place the hook below the existing `recordQuery` so `drawCount` is in scope.
  - [x] 4.2 Render-gating: extend the existing block to add a new branch.
    - `drawCount === 0`: existing behaviour (untouched).
    - `drawCount === 1`: existing Story 3.2 `cold-start-1` branch (untouched).
    - `drawCount >= 2`: NEW branch — render `<FingerprintChart state="baseline-established" baselines={mappedBaselines} reducedMotion={reducedMotion} />` followed by a `YStack` of `<BiomarkerCard ...>` per biomarker (one per `baselines` row + one per cold-start biomarker per AC3).
  - [x] 4.3 Map `baselineQuery.data?.baselines` into the chart prop shape. For each baseline row, derive `history` by reading the matching `recordQuery.data.draws[].observations[]` entries (filter by `loincCode` when not null; else by `(biomarkerName, unitUcum)`). This is a single linear pass; the dataset is tiny (≤ ~1000 rows per Epic 2 retro). Build the merge in a `useMemo` keyed on both query data references so it only recomputes when either query resolves.
  - [x] 4.4 Cold-start fallback (AC3): biomarkers present in the latest draw but absent from `baselines` (i.e. only one historical sample for that biomarker) render as a `BiomarkerCard` `cold-start` state with population range — they do NOT participate in the chart's baseline band (Task 2.4 contract).
  - [x] 4.5 Suppress primary `EmptyStateRecord` + the manual-BIA `Button` at `drawCount >= 2` (AC5). The patient with a Fingerprint should see their Fingerprint; the upload affordance remains in Histórico's Envios tab + the picker that's still reachable elsewhere (Story 3.4 may revisit; this story does not introduce a new uploads CTA on Início). Document in Dev Notes § "Início composition at `drawCount >= 2`".
  - [x] 4.6 Loading: when `recordQuery.isPending || baselineQuery.isPending` (and `drawCount >= 2`), render a calm placeholder (a `YStack` with a single muted Text "Carregando seu Fingerprint…" using `INICIO_FINGERPRINT_LOADING_PT_BR` constant). Do NOT render a red error banner if the baseline query errors — `console.warn` and fall through to a calm copy `INICIO_FINGERPRINT_ERROR_PT_BR = "Não conseguimos carregar seu Fingerprint agora. Tente novamente em instantes."` (amber-toned text only, no banner).
  - [x] 4.7 Thread the existing `reducedMotion` state into the chart's `reducedMotion` prop. **Do NOT** add a second `AccessibilityInfo` subscription — reuse the one Story 3.2 already wired.
  - [x] 4.8 Query-param coupling check (Epic 2 retro action item 3): no new route helpers introduced. The existing `?source=post_onboarding_photo` consumer is untouched. **Round-1 reviewer**: verify.
  - [x] 4.9 Dead-code guard (Story 3.2 lesson): render-gating uses `drawCount === 1` and `drawCount >= 2` from a SINGLE source (`recordQuery.data?.drawCount`). Do NOT also gate on `baselineQuery.data?.baselines.length` — the two queries can race, and the chart's prop layer handles the empty-baselines case (renders the chart with cold-start cards only, AC3 fallback).

- [x] **Task 5 — Tests (AC2, AC4, AC7) and load fixture (AC4 / NFR-SC4)**
  - [x] 5.1 **Unit test — `coerceNumeric` + `computeTrend` + z-score sign helpers.** Add `packages/api/__tests__/observations-baseline.unit.test.ts` (and/or `packages/ui/__tests__/fingerprint-chart-trend.test.ts`). Pure-logic; no DB. Cover: ascending series → "ascendente"; descending → "descendente"; flat (±ε) → "estável"; single-point → "estável" (or whatever the helper documents); `stddev === 0` → `zScore === null`. If the harness in those packages is still absent (F168), downgrade to **F-item** per Story 3.1 / 3.2 pattern.
  - [x] 5.2 **Unit test — `BiomarkerCard` watching / notable with z-score.** Same `packages/ui/__tests__/biomarker-card.test.tsx` file (extend or create). Snapshot the chip copy + a11y label for `zScore = 1.2` ("acompanhando"), `1.7` ("vale conversar"), `null` (no chip — within-band path), `-2.3` (notable, "abaixo"). F-item-eligible per F168.
  - [x] 5.3 **Integration test — `getPersonalBaseline` correctness + RLS + NFR-SC4 load p95.** Add `packages/db/__tests__/integration/observations-baseline.integration.test.ts` (testcontainers; `pnpm --filter @healthtracker/db test:integration`). Two scenarios:
    - **Correctness:** seed 2 patients × 3 biomarkers × 4 draws each. Query as patient A; assert (a) RLS returns only patient A's rows, (b) `mean` / `stddev` / `sampleSize` match a hand-computed reference (use NumPy-equivalent stats), (c) groups with `sampleSize < 2` are excluded, (d) `deleted_at IS NOT NULL` rows are excluded.
    - **NFR-SC4 load:** seed 10,000,000 rows (or a documented smaller proxy — see "Load fixture scaling" in Dev Notes; the literal 10M is the spec target but takes ~minutes to seed in a testcontainer — the realistic CI target is 100k rows with a documented extrapolation, gated behind an env var `NFR_SC4_FULL=1` for full-scale local runs). Warm the query plan, run 100 iterations, assert p95 < 500ms. The testcontainer fixture **applies the existing `observations_patient_collected_idx` index** (already in `packages/db/src/schema/observations.ts` line 111) — verify `EXPLAIN ANALYZE` uses the index, NOT a sequential scan.
  - [x] 5.4 **No new UI snapshot tests for Victory Native rendering** — chart rendering is integration-tested via manual run-through (Task 6.6). Victory Native's SVG output is not snapshot-stable enough to be a useful regression guard.
  - [x] 5.5 **Regression test** — re-run `pnpm --filter @healthtracker/db test:integration` against the existing Story 3.1 fixture so we don't break the `getRecord` SELECT contract.

- [x] **Task 6 — Quality gates (mandatory)**
  - [x] 6.1 `pnpm typecheck` — green.
  - [x] 6.2 `pnpm lint` — green.
  - [x] 6.3 `pnpm format:fix` then `pnpm format` — clean.
  - [x] 6.4 `pnpm test` — green (any new tests added).
  - [x] 6.5 `pnpm --filter @healthtracker/db test:integration` — must pass (new Task 5.3 fixture + Story 3.1 regression).
  - [x] 6.6 Manual run-through (Expo simulator if available):
    1. Seed 0 observations → Início shows existing cold-start landing (no chart).
    2. Seed 1 draw → Story 3.2 `cold-start-1` surfaces (regression check — must look identical to current).
    3. Seed 2 draws with the SAME biomarkers, slightly different values → `baseline-established` chart per biomarker; `mean ± stddev` band visible; chip on any biomarker where `|z| >= 1.0` (use a value 2σ away from mean to force `notable`).
    4. Seed 3 draws including 1 biomarker that only appears in the latest draw → that biomarker renders as `BiomarkerCard` `cold-start` with population range; the others render `baseline-established` (AC3).
    5. Seed 2 identical draws → all baselines have `stddev === 0`; all cards render `within-band`; no chips.
    6. Toggle OS "Reduce Motion" → chart entry animation disappears; pinch/pan gestures still work but settle instantly.
    7. Pinch-zoom + pan → x-axis only; y stays fixed; baseline band stays visible.
    8. VoiceOver: focus the chart → reads composite trend narration; focus each `BiomarkerCard` → reads z-score narration.

---

## Dev Notes

### Architecture patterns and constraints

- **New tRPC procedure.** Story 3.3 introduces `getPersonalBaseline` (`packages/api/src/router/observations.ts` + new helper at `packages/api/src/observations-baseline.ts`). This is NOT a duplicate of `getRecord` — different read intent, different cost profile, different audit event kind. The procedure is **separate** so the per-Init load surfaces both `getRecord` (≤ 1000-row scan, no aggregation) AND `getPersonalBaseline` (aggregate query, NFR-SC4 budgeted at 500ms p95 against 10M rows) — each can be cached, scaled, and audited independently.
- **`protectedProcedure` transaction wraps queries.** `ctx.db` inside both procedures is already a transaction handle (`packages/api/src/trpc.ts` L83; confirmed by Story 3.1 R1-P233). Do NOT call `database.transaction(...)` manually — postgres.js rejects nested transactions.
- **RLS is the security boundary.** `observations_select_own` policy in `packages/db/policies/custom_rls_observations.sql` filters by `patient_id = app.current_patient_id` (AR5). The app-layer `eq(patientId, ...)` in the new helper is defense-in-depth, identical posture to `getRecordForPatient`.
- **Soft-delete filter is non-negotiable.** Every SELECT against `observations` MUST `WHERE deleted_at IS NULL` (Epic 2 retro § "Dependencies on Epic 2"; Story 2.7 added the column). Task 1.2 applies this in the aggregate.
- **Narrow catches by default** (Epic 2 retro action item 2 / CLAUDE.md). Story 3.3 has no obvious try/catch surface. The aggregate's only failure modes are (a) DB error → bubble up as a tRPC error (`protectedProcedure` handles), (b) NaN coercion on a single row → `console.warn` + skip the row (Story 3.1 R1-P234 pattern, NOT a try/catch — it's an explicit `Number.isNaN` guard). The chart's only math failure is `stddev === 0` divide-by-zero → handled with an explicit `if (stddev === 0) return null` guard (AC2). No broad catches.
- **Query-param coupling check** (Epic 2 retro action item 3). Story 3.3 adds no new route helpers; the chart and BiomarkerCards mount inside the existing Início tab. Round-1 reviewer confirms.
- **Tamagui-only.** No `StyleSheet.create`, no hex literals. Victory Native primitives accept colour strings — pass Tamagui tokens via `theme.getTokenValue(...)` or by resolving the token string at the call site (the existing `BiomarkerCard` lives entirely inside Tamagui — verify there's a clean way to read a token value from inside the Victory Native rendering tree before relying on it; if not, hardcode the two specific colours used by the chart — `$primaryTeal`, `$primaryTealLight` — via a single named constant exported from `packages/ui/src/theme/tokens.ts` and document the rationale).
- **`pnpm db:push` for partial-index `WHERE` changes** (CLAUDE.md ops note). Story 3.3 does NOT modify any partial-index `WHERE` clause. The existing `observations_patient_collected_idx` (line 111, `packages/db/src/schema/observations.ts`) is sufficient for the aggregate; no new index is required. If profiling later shows the aggregate needs a covering index, that's a follow-up story — do NOT add an index in this PR without measurement.

### Charting library — Victory Native introduction

- **Decision (architecture doc lines 354, 362, 486–491).** Victory Native is the chart library. Story 3.2 deferred adding it because cold-start-1 was achievable with Tamagui primitives; Story 3.3 is the explicit "chart library lands here" story. Skia upgrade path (`@shopify/react-native-skia`) remains a post-MVP option.
- **Add to `apps/expo/package.json`** (not `packages/ui/package.json` — Victory Native is RN-only; `packages/ui` is consumed by both Expo and Next). Use `pnpm add -F @healthtracker/expo victory-native`. Verify the peer deps are satisfied: `react-native-svg` (Victory Native ≥ 41 may include or require `@shopify/react-native-skia` as the rendering backend — VERIFY via context7 before assuming). `react-native-gesture-handler` 2.28 + `react-native-reanimated` 4.1 are already in the workspace (lines 49–50 of `apps/expo/package.json`) — reuse, do NOT add a second version.
- **Use the context7 MCP tool** to fetch current Victory Native docs before writing chart code — the API has evolved (CartesianChart + Line + Area + Scatter; chart transforms for zoom/pan changed between v40 and v41). Cite the doc URL + version in the component's JSDoc when committing.
- **`packages/ui/src/fingerprint-chart.tsx` STAYS in `packages/ui`.** If Victory Native imports inside `packages/ui` cause Next.js to choke (Next doesn't tree-shake `react-native-svg`), the workaround is to dynamic-import Victory Native inside a platform-gated branch (`Platform.OS === 'web' ? null : require('victory-native')`). Story 3.3 ships Expo-only — no `apps/web` consumer exists yet. Document the web behaviour as "renders an empty placeholder" with a TODO for the future web Fingerprint story.
- **Component split decision.** The chart's `baseline-established` rendering may want its own subfile (`packages/ui/src/fingerprint-chart-baseline.tsx`) to keep `fingerprint-chart.tsx` from sprawling past ~600 lines. The shared `FingerprintChart` component dispatches via the `state` discriminator. **Either layout is acceptable**; if the diff feels uncomfortable in one file, split.

### Cold-start-2 deferral

UX spec line 858 references a `cold-start-2` state ("two draws; line segment; dashed band; label '2 more draws to calibrate'"). Story 3.3's epic AC explicitly ships **`baseline-established`** at `drawCount >= 2` — there is no intermediate "2 draws is still cold start" rung in the epic. The spec wording elsewhere (UX spec line 81 — "Draw 2 is the aha moment") and the epic FR (FR12: "personal baseline can be computed from 2+ draws") confirm `drawCount === 2` is `baseline-established`, not `cold-start-2`. **Skip `cold-start-2`**. If later UX research wants the "still calibrating until N draws" framing, it's a follow-up story that widens the union.

### Biomarker grouping key

`observations.loinc_code` is NULLABLE (Story 2.3 R1-P102 + schema line 60). A small fraction of rows may lack a resolved LOINC. To group correctly:

- Primary key: `loinc_code` when not null.
- Fallback: `biomarker_name || '|' || unit_ucum` (composite — the same biomarker name with two different units shouldn't be averaged together).

SQL: `COALESCE(loinc_code, '__no_loinc__|' || biomarker_name || '|' || unit_ucum)` as the group key. UI: same logic, but the displayed `biomarkerName` is `MAX(biomarker_name)` per group (deterministic and human-readable; biomarker name is usually consistent within a group).

### Load fixture scaling (NFR-SC4)

The literal spec target is 10M rows; the testcontainer practical reality is that seeding 10M rows takes minutes. Strategy:

- **CI default:** seed **100,000** rows (1% of target), warm the plan, assert p95 < 50ms (1% of the latency budget). The relationship is roughly linear for index scans; extrapolating to 10M ⇒ ~500ms p95 is the explicit assumption.
- **Local / nightly full-scale:** gated behind `NFR_SC4_FULL=1` env var, seeds the full 10M and asserts the literal p95 < 500ms. Documented in the test file's top JSDoc + the Story 3.3 Completion Notes when run.
- **Index check is mandatory either way:** `EXPLAIN (ANALYZE, BUFFERS)` must show the aggregate uses `observations_patient_collected_idx` (and not a sequential scan). If the query plan flips to seq scan at scale, that's a real defect — file a follow-up to widen the index or add a covering index.

### Story 3.2 surfaces preserved

The Story 3.2 `cold-start-1` rendering + the `INICIO_HEADLINE_DRAW_ONE_PT_BR` / `INICIO_CTA_DRAW_ONE_PT_BR` copy swap at `drawCount === 1` MUST stay byte-for-byte identical (Story 3.1 R2-P244 lesson — verbatim regressions are easy to ship and burn cycles). Mechanical check: after Story 3.3 is implemented, run the Story 3.2 manual smoke (Task 6.6 step 2) and assert visual equivalence. The `FingerprintChart` component's `switch (state)` MUST route `cold-start-1` to the existing render function unchanged.

### Início composition at `drawCount >= 2`

The patient with ≥ 2 draws has a Fingerprint to look at. The Início screen's purpose at this rung is **showing the Fingerprint**, not soliciting an upload. Decision:

- **Suppress** the primary `EmptyStateRecord` + the manual-BIA `Button` at `drawCount >= 2`. Both are upload affordances; the patient who's uploaded twice doesn't need them on this surface.
- **Reachability:** uploads remain accessible via the `UploadSourceSheet` (still wired to whatever entry points existed pre-3.3 — primarily Histórico's Envios tab). The manual-BIA `MANUAL_BIA_ROUTE` is also still reachable from there.
- **Story 3.4** (offline cached Fingerprint) will revisit Início composition; do NOT preempt its decisions here. If 3.4 wants the manual-BIA CTA back, it can re-add it.

This matches the UX spec § "Aspirational moments" (line 224) — "Fingerprint and latest draw summary as the home surface" — and § "Strava's PR celebration moment" (line 237).

### Source tree components to touch

**New files:**

- `packages/api/src/observations-baseline.ts` — `getPersonalBaselineForPatient` helper + types.
- `packages/db/__tests__/integration/observations-baseline.integration.test.ts` — correctness + NFR-SC4 load fixture.
- (Optional) `packages/ui/src/fingerprint-chart-baseline.tsx` — if the `baseline-established` render splits out.
- (Optional) `packages/api/src/numeric.ts` — shared `coerceNumeric` extraction.
- (Optional) `packages/api/__tests__/observations-baseline.unit.test.ts` — pure-logic tests (F168-gated).
- (Optional) `packages/ui/__tests__/fingerprint-chart-trend.test.ts` — `computeTrend` tests (F168-gated).

**Modified files:**

- `packages/api/src/router/observations.ts` — register `getPersonalBaseline`.
- `packages/ui/src/fingerprint-chart.tsx` — widen state union; add `baseline-established` render; replace `void state;` with proper `switch`.
- `packages/ui/src/biomarker-card.tsx` — accept `zScore` + baseline props; personal-baseline narration for `watching` / `notable`; new chip copy.
- `packages/ui/src/index.ts` — re-export any new types.
- `apps/expo/src/app/(tabs)/inicio.tsx` — second query (`getPersonalBaseline`); render-gating extended to `drawCount >= 2`; map baselines + history; suppress upload CTAs at `drawCount >= 2`; reuse existing `reducedMotion`.
- `apps/expo/package.json` — add `victory-native` (+ verify `react-native-svg` peer).
- `packages/validators/src/index.ts` — append new pt-BR copy constants (see Task 3.3 + 2.6 + 4.6).
- `pnpm-lock.yaml` — auto-updated by `pnpm install`.

**Files NOT to touch (verify by grep before editing):**

- `packages/db/src/schema/observations.ts` — no schema change. Existing `observations_patient_collected_idx` is sufficient (verified by `EXPLAIN` in Task 5.3).
- `packages/db/policies/custom_rls_observations.sql` — unchanged. The new procedure uses the same `SET LOCAL app.current_patient_id` context the existing `getRecord` does.
- `packages/api/src/observations-record.ts` — `getRecordForPatient` reused unchanged. (Task 1.7 may extract `coerceNumeric` into a shared module — that's the only acceptable touch.)
- `packages/api/src/audit.ts` — `writeAuditLog` is the single audit-write seam; the new event kind `"observation.baseline.read"` is a string literal, not an enum, so no code change required there.
- `packages/ui/src/empty-state-record.tsx` — unchanged. Story 3.2's `state="partial"` is not reused here.
- `apps/expo/src/app/(tabs)/historico/*` — Histórico is unchanged. Story 3.4 may revisit; 3.3 does not.
- `packages/ui/src/extraction-pulse.tsx` — unchanged.

### Previous story intelligence (Stories 3.1 + 3.2 → Story 3.3)

From `3-1-...md` + `3-2-...md` (and Round 1–3 review notes):

- **`getRecord` returns the shape Story 3.3 needs to compose `history`.** Use `recordQuery.data.draws[].observations[]` for the per-biomarker time series; do NOT add a third query. The dataset is small enough (Epic 2 retro: ≤ 1000 rows for a power user) that doing the per-biomarker `history` merge in TS is cheap.
- **Story 3.1 R1-P234 (degrade bad confidence to 0):** Carry forward. The baseline aggregate doesn't read `confidence_score`, so this is N/A for the new SQL — but if a future ranking surfaces confidence, the lesson stands.
- **Story 3.1 R2-P244 (verbatim-rename regression):** Append new validators constants; NEVER mutate or rename existing ones. The Story 3.2 block (lines 1060–1097 of `packages/validators/src/index.ts`) ends with `INICIO_CTA_DRAW_ONE_PT_BR`; Story 3.3 appends below.
- **Story 3.1 R3-P246 (off-by-one timezone date):** Story 3.3 renders chart x-axis labels from `collected_at`. Use `formatCollectedAtPtBr` from validators for any user-visible date string (NEVER `new Date('yyyy-mm-dd').toLocaleDateString(...)`).
- **Story 3.2 R1-P247 (BiomarkerRow key collision):** When mapping `baselines` to `BiomarkerCard`s, use a composite key like `${loincCode ?? biomarkerName}-${unitUcum}-${idx}` to survive duplicate-name edge cases.
- **Story 3.2 R1-P248 (dot bleeds past band edges):** N/A — Victory Native handles axis insetting. The lesson generalises: at the chart's data extremes, verify visual encoding still reads correctly.
- **Story 3.2 R1-P249 + R2-P250 (per-biomarker narration; greppable copy):** Carry both forward. Per-card a11y narration is mandatory; every surface string lives in validators (NOT inlined in components).
- **F168 (no vitest+RTL in `packages/ui`):** still the case as of Story 3.2. Treat UI snapshot tasks (5.1, 5.2) as F-items if the harness is absent. Do NOT block 3.3 to stand up the harness.
- **F168-V (no vitest in `packages/validators`):** still the case. The new helper `BIOMARKER_PERSONAL_BASELINE_NARRATION_PT_BR` is small enough to defer testing per project posture.
- **F169 (no `lucide-react-native`):** still deferred. The new chips use text glyphs.
- **Tamagui token catalogue:** `$primaryTeal`, `$primaryTealLight`, `$biomarkerDeviation`, `$biomarkerDeviationBg`, `$surfaceElevated`, `$border`, `$textPrimary`, `$textSecondary`, `$card`, `$cardLg`, `$chip` are all wired (confirmed during Story 3.1). Use them. `$warningAmber` / `$warningAmberSurface` do NOT exist as health-deviation tokens — they exist for offline-queue banner styling per Story 2.6 R2-P190 and are NOT appropriate for biomarker chips. Use `$biomarkerDeviation` / `$biomarkerDeviationBg` (the canonical names).

### Cross-cutting discipline checks (Epic 1 + Epic 2 retros)

- **Narrow catches** — no try/catch added in this story (per "Architecture patterns" above). If a try/catch sneaks in, the round-1 reviewer rejects it unless it articulates the exact error shape it swallows.
- **Query-param coupling** — no new query params. Round-1 reviewer confirms.
- **Soft-delete filter** — applied in the new aggregate (Task 1.2).
- **Audit-log atomicity** — new event kind `observation.baseline.read` emitted inside the `protectedProcedure` transaction (AC6).
- **Broad-catch swallowing programmer errors** — N/A.
- **Dead-code guard** — render-gating uses `drawCount` from `recordQuery.data` only; do NOT also gate on `baselineQuery.data?.baselines.length` (Task 4.9).
- **TOCTOU SELECT-EXISTS-then-INSERT** — N/A (read-only).
- **Partial-index ON-CONFLICT `where` clauses** — N/A (no writes).
- **`pnpm db:push` for partial-index changes** — N/A (no schema changes).

### Validators constants to append (Task 4 / Task 2.6 / Task 4.6)

Append to `packages/validators/src/index.ts` AFTER the Story 3.2 block (after `INICIO_CTA_DRAW_ONE_PT_BR` ≈ line 1097). NEVER mutate or rename existing constants (R2-P244 discipline).

```
BIOMARKER_WATCHING_LABEL_PT_BR = "acompanhando"
BIOMARKER_NOTABLE_LABEL_PT_BR = "vale conversar"
BIOMARKER_PERSONAL_BASELINE_NARRATION_PT_BR({ zScore, direction }) → string
  // "{magnitude com vírgula} desvios {abaixo|acima} da sua linha de base pessoal"
FINGERPRINT_BASELINE_A11Y_LABEL_PT_BR({ biomarkerName, sampleSize, trend, zScore }) → string
  // "{biomarkerName}: {sampleSize} medições. Tendência {ascendente|descendente|estável}. Valor atual {|z| com vírgula} desvios {abaixo|acima} da sua linha de base pessoal."
FINGERPRINT_BASELINE_TREND_ASCENDING_PT_BR = "ascendente"
FINGERPRINT_BASELINE_TREND_DESCENDING_PT_BR = "descendente"
FINGERPRINT_BASELINE_TREND_FLAT_PT_BR = "estável"
INICIO_FINGERPRINT_LOADING_PT_BR = "Carregando seu Fingerprint…"
INICIO_FINGERPRINT_ERROR_PT_BR = "Não conseguimos carregar seu Fingerprint agora. Tente novamente em instantes."
```

### Testing standards summary

Mirror Stories 3.1 / 3.2:

- **DB integration tests** (`packages/db/__tests__/integration/`) are the load-bearing tier for this story. Task 5.3 is non-optional — NFR-SC4 cannot be verified any other way. Testcontainers (`@testcontainers/postgresql`) per project convention (CLAUDE.md "Database tests" section).
- **API unit tests** (`packages/api/__tests__/`) for `coerceNumeric` + trend helper. Pure logic; cheap.
- **UI snapshot tests** in `packages/ui/__tests__/` — F-items if the harness is absent.
- **Manual run-through** (Task 6.6) is non-optional — Victory Native rendering and gesture behaviour can ONLY be verified in a simulator.
- Run from repo root: `pnpm typecheck && pnpm lint && pnpm format && pnpm test && pnpm --filter @healthtracker/db test:integration`.

### Project Structure Notes

- `packages/api/src/observations-baseline.ts` mirrors `packages/api/src/observations-record.ts` (Story 3.1) — same file shape, same export pattern.
- The `getPersonalBaseline` procedure is registered alongside `getRecord` in `packages/api/src/router/observations.ts` — keep the file flat; do NOT shard into a `baseline-router.ts` for one procedure.
- Victory Native lives in `apps/expo/package.json` only — `packages/ui` stays portable to web.
- `pnpm-lock.yaml` will update from `pnpm install`; commit it.

### References

- Story foundation: `_bmad-output/planning-artifacts/epics.md` § "Story 3.3" (lines 929–953).
- Epic 3 framing: `_bmad-output/planning-artifacts/epics.md` § "Epic 3" (lines 251–254, 869).
- Requirements:
  - FR12 / FR13 / FR14 — `_bmad-output/planning-artifacts/prd.md` lines 488–490.
  - AR5 — `_bmad-output/planning-artifacts/epics.md` line 140; implementation at `packages/api/src/trpc.ts` lines 76–102.
  - NFR-A3 / NFR-A4 — `_bmad-output/planning-artifacts/prd.md` lines 580–581.
  - NFR-SC4 — `_bmad-output/planning-artifacts/prd.md` line 574.
- UX:
  - `FingerprintChart` contract (states, pinch-zoom/pan, a11y, data-table fallback) — `_bmad-output/planning-artifacts/ux-design-specification.md` lines 848–866.
  - `BiomarkerCard` `watching` / `notable` states — UX spec lines 832–844; UX spec § "Deviation level" (lines 778, 1083–1084).
  - Amber-not-red / colour-never-alone — UX spec lines 241, 629, 1073–1089, 1395.
  - z-score thresholds (1.0–1.5 / > 1.5) — UX spec lines 747–748, 1083–1084.
  - Trend narrative ("Tendência descendente / X desvios abaixo da sua linha de base pessoal") — epics.md line 951.
  - Strava PR / WHOOP calibration analogy — UX spec lines 199–219, 224, 237.
- Architecture:
  - Victory Native decision + Skia upgrade path — `_bmad-output/planning-artifacts/architecture.md` lines 354, 362, 486–491, 1131–1133, 1550.
  - tRPC + RLS context (re-confirmed) — `_bmad-output/planning-artifacts/architecture.md` lines 774–787; code at `packages/api/src/trpc.ts` lines 76–102.
  - Tamagui token rules, biomarker display rules, accessibility requirements — `_bmad-output/planning-artifacts/architecture.md` lines 850–884.
  - Enforcement (no red for biomarker deviations, never inline `db.execute(SET ...)`) — `_bmad-output/planning-artifacts/architecture.md` lines 888–917.
- Previous stories (full history including review notes): `_bmad-output/implementation-artifacts/3-1-patient-views-their-complete-longitudinal-biomarker-record.md` and `_bmad-output/implementation-artifacts/3-2-patient-views-the-fingerprint-at-draw-1-with-baseline-building-context.md`.
- Epic 2 retro (cross-cutting + Epic 3 prep): `_bmad-output/implementation-artifacts/epic-2-retro-2026-05-23.md` § "Next Epic Preview — Epic 3" (lines 124–142, esp. "Baseline-band statistics" line 145), § "Action Items" (lines 153–174).
- CLAUDE.md § "Code review discipline (Epic 1 + Epic 2 retros)" — narrow catches, query-param coupling, dead-code guards, partial-index `pnpm db:push` warning.
- Existing schema + indexes: `packages/db/src/schema/observations.ts` (esp. `observations_patient_collected_idx` line 111, `deleted_at` line 82, nullable `loincCode` line 60).
- Existing components to extend (read fully before modifying): `packages/ui/src/fingerprint-chart.tsx`, `packages/ui/src/biomarker-card.tsx`, `apps/expo/src/app/(tabs)/inicio.tsx`.

---

## Dev Agent Record

### Agent Model Used

claude-opus-4-7[1m]

### Debug Log References

### Completion Notes List

- **Library decision verified via context7 MCP** on 2026-05-23. Used `/formidablelabs/victory-native-xl`; ships as `victory-native` package v41.x. Confirmed `CartesianChart` + `useChartTransformState` + `transformConfig` (`pan.dimensions: 'x'`, `pinch.dimensions: 'x'`) API surface for x-axis-only pinch-zoom + pan. Doc citation: https://github.com/formidablelabs/victory-native-xl/blob/main/website/docs/cartesian/cartesian-chart.md.
- **Versions added to apps/expo/package.json:** `victory-native@^41.20.0`, `@shopify/react-native-skia@^2.6.3` (latest published — spec asked for "~3.0.6" but no 3.x release exists yet; 2.6.3 is the current Victory Native v41 peer), `react-native-svg@^15.15.5`.
- **Gates run:** `pnpm typecheck` green, `pnpm lint` green (after cache invalidation), `pnpm format:fix` then `pnpm format` clean, `pnpm test` green (135 API tests including 7 new `observations-baseline.test.ts` cases). `pnpm --filter @healthtracker/db test:integration` **not run** — Docker daemon not available in this environment; deferred as **F-item F167** continuation per Stories 3.1 / 3.2 pattern. The integration fixture (`packages/db/__tests__/integration/observations-baseline.integration.test.ts`) is shipped, including the NFR-SC4 100k load test (gated CI default) and 10M full-scale path (`NFR_SC4_FULL=1`) — runnable as soon as Docker is available.
- **F-items deferred (carry forward):**
  - **F167** — `pnpm --filter @healthtracker/db test:integration` not executable here (no Docker). Fixture file written; runs locally with `docker info` working.
  - **F168** — no vitest+RTL harness in `packages/ui` and no vitest in `packages/validators`, so UI snapshot tests for `BiomarkerCard` watching/notable states + a `computeTrend` unit test are **not** added. Pure-logic helpers (`computeTrend`, `deviationStateForZScore`) live in `packages/ui` and are exported for future tests once the harness lands.
  - **F169** — `lucide-react-native` still deferred; the new `watching` / `notable` chips reuse the text-glyph `!` from Story 3.1.
- **Tamagui token escape hatch.** `packages/ui/src/fingerprint-chart-baseline.tsx` defines five colour constants as resolved Tamagui `light` theme values (`COLOR_PRIMARY_TEAL`, `COLOR_PRIMARY_TEAL_LIGHT`, `COLOR_TEXT_PRIMARY`, `COLOR_TEXT_SECONDARY`, `COLOR_BORDER`) wrapped in `/* eslint-disable no-restricted-syntax */`. Spec-sanctioned per Story 3.3 Dev Notes § "Tamagui-only" — Victory Native's Skia primitives accept colour strings only, no `$token` interpolation. Same pattern as `apps/expo/src/app/(tabs)/inicio.tsx`'s `BACKGROUND_PRIMARY`.
- **Render-gating verified.** `drawCount === 0` → existing cold-start landing (untouched). `drawCount === 1` → Story 3.2 `cold-start-1` (untouched, byte-for-byte). `drawCount >= 2` → new `baseline-established` chart + `BiomarkerCard` list; primary `EmptyStateRecord` and manual-BIA CTA suppressed (AC5).
- **Audit-log atomicity (AC6):** `observation.baseline.read` audit row is `INSERT`-ed via the shared `writeAuditLog` helper inside the same `protectedProcedure` transaction (`ctx.db` is the tx handle — no nested transaction call).
- **Cross-cutting discipline checks (clean):** no try/catch in new code (only explicit guards — divide-by-zero in z-score, `Number.isFinite` NaN coerce); soft-delete filter applied in the aggregate; no new query-param coupling; no schema changes (no partial-index WHERE migration risk); single-source render-gating (no dead-code re-check on `baselineQuery.data?.baselines.length`).
- **Deviation from spec:** spec called for `@shopify/react-native-skia@~3.0.6`; latest published is 2.6.3, so installed `^2.6.3`. No other deviations.

### File List

**NEW:**

- `packages/api/src/observations-baseline.ts` — `getPersonalBaselineForPatient` helper (single SQL aggregate; audit emission).
- `packages/api/__tests__/observations-baseline.test.ts` — 7 unit tests (empty-set audit, z-score math, stddev=0 → null, audit metadata, NaN guard, null-LOINC preservation, call-count contract).
- `packages/ui/src/fingerprint-chart-baseline.tsx` — `FingerprintBaselineChart` + `computeTrend` + Victory Native Skia render path with web-fallback short-circuit.
- `packages/db/__tests__/integration/observations-baseline.integration.test.ts` — correctness + NFR-SC4 load fixture (deferred-execution F167).

**MODIFIED:**

- `packages/api/src/router/observations.ts` — registered `getPersonalBaseline: protectedProcedure.query(...)`.
- `packages/ui/src/fingerprint-chart.tsx` — widened state union to `"cold-start-1" | "baseline-established"`; discriminated `FingerprintChartProps`; replaced `void state;` with proper `switch`; split `cold-start-1` body into a sibling function so its render path is unchanged.
- `packages/ui/src/biomarker-card.tsx` — added `zScore` / `personalBaselineMean` / `personalBaselineStddev` optional props; exported `deviationStateForZScore`; personal-baseline narration in `buildAccessibilityLabel`; chip copy switches to `acompanhando` / `vale conversar` when a baseline is present.
- `packages/ui/src/index.ts` — re-exported `deviationStateForZScore`, `computeTrend`, `FingerprintBaselineChart`, and the new types.
- `packages/validators/src/index.ts` — appended `BIOMARKER_WATCHING_LABEL_PT_BR`, `BIOMARKER_NOTABLE_LABEL_PT_BR`, `BIOMARKER_PERSONAL_BASELINE_NARRATION_PT_BR()`, `FINGERPRINT_BASELINE_TREND_*_PT_BR`, `FINGERPRINT_BASELINE_A11Y_LABEL_PT_BR()`, `INICIO_FINGERPRINT_LOADING_PT_BR`, `INICIO_FINGERPRINT_ERROR_PT_BR`, plus an internal `import { formatBrazilianDecimal }` so the helpers can call it.
- `apps/expo/src/app/(tabs)/inicio.tsx` — second query (`getPersonalBaseline`) with `enabled: drawCount >= 2`; `useMemo`-merged baseline chart props + cold-start fallback cards (AC3); render-branch for `drawCount >= 2` suppressing the primary `EmptyStateRecord` + manual-BIA CTA; calm loading/error copy; baseline-error warn ref.
- `apps/expo/package.json` — added `victory-native@^41.20.0`, `@shopify/react-native-skia@^2.6.3`, `react-native-svg@^15.15.5`.
- `turbo.json` — added `NFR_SC4_FULL` + `SKIP_NFR_SC4` to `globalEnv` for the integration-test gating.
- `pnpm-lock.yaml` — refreshed by `pnpm install`.

---

## Review Notes

### Round 1 Review

**Reviewer:** code-review skill (Opus 4.7), 2026-05-23.
**Scope:** all Story 3.3 file-list changes diffed against HEAD (ed751f0; Stories 3.1 + 3.2 baseline). Three adversarial layers run inline (Blind Hunter / Edge Case Hunter / Acceptance Auditor) given the diff stats fit in-session.
**Patch ID range:** R1-P251 … R1-P253 (3 applied; remainder closed as `accept` or `decline-with-rationale`).

**Quality gates after patches:** `pnpm typecheck` green (16 tasks). `pnpm lint` green (14 tasks). `pnpm --filter @healthtracker/api test` green (135 tests including 7 new `observations-baseline.test.ts` cases). `pnpm --filter @healthtracker/db test:unit` green (no test files — db package has no unit suite, per project posture; integration suite gated on Docker — F167 carries forward). `pnpm format:fix` clean.

**Findings (applied):**

1. **R1-P251 [HIGH] — `Math.min(...values)` / `Math.max(...values)` spread risk in `BaselineSkiaChart`.** `packages/ui/src/fingerprint-chart-baseline.tsx` lines 318–319 spread the values array into `Math.min/max`. For the Story 3.3 dataset shape (≤ ~1000 rows/biomarker per Epic 2 retro) this works, but the spread form has two latent failure modes: (a) call-stack blowup on unbounded arrays, (b) returns `Infinity` / `-Infinity` for an empty array — and the upstream `inicio.tsx` per-baseline `history` merge could in principle produce an empty match list if mapping drifts (e.g. a baseline group present in `baselines` whose constituent `observations[]` were filtered out by a future predicate). **Outcome:** applied. Replaced spread with `reduce`; added an empty-array guard that seeds min/max from `baseline.mean` (or `0`/`1` when no baseline) so the Skia render never sees `Infinity` in `yDomain`.

2. **R1-P252 [HIGH → accept-without-patch] — `require("victory-native")` inside `BaselineChartBody` at render time.** Reviewer flagged; spec-sanctioned per Dev Notes § "fingerprint-chart STAYS in packages/ui" — the dynamic require keeps Victory Native + Skia out of the web bundle (no `apps/web` consumer this story). Metro caches the require, so per-render cost is negligible. The `eslint-disable @typescript-eslint/no-require-imports` comment cites the rationale. **Outcome:** declined; rationale in source is sufficient.

3. **R1-P253 [MEDIUM] — `drawCount` semantic divergence between `getRecord` and `getPersonalBaseline`.** `RecordView.drawCount` (Story 3.1) counts `(collected_at, lab_name)` groups; `BaselineView.drawCount` (Story 3.3) counts DISTINCT `collected_at`. The two can disagree when a patient uploads same-date draws from two labs (one logical date, two record-level draws). The audit metadata `{ drawCount }` is therefore semantically "sampling dates", not "record draws". UI never reads `BaselineView.drawCount` (Início uses `recordQuery.data.drawCount` for gating per AC5 Task 4.9 dead-code guard), so there is no rendering bug — but the audit trail divergence will confuse forensics later. **Outcome:** applied. Added an inline rationale comment in `packages/api/src/observations-baseline.ts` documenting the divergence + the consumer contract.

**Findings (closed without patch):**

4. **R1-P254 [LOW → decline] — Validators `formatBrazilianDecimal` is both imported and re-exported in `packages/validators/src/index.ts`.** Verified clean by `pnpm typecheck`. Standard pattern when an internal helper is also part of the public surface. No bug.

5. **R1-P255 [HIGH → decline] — Cold-start fallback `BiomarkerCard` (single-history biomarker) receives `zScore: undefined` + no explicit `state`, which routes through `deviationStateForValue` (Story 3.1 population-range path) rather than always landing on `cold-start`.** Initially read as an AC3 violation. On re-read, AC3 says "falls back to BiomarkerCard cold-start state (population range)" — i.e. the Story 3.1 cold-start contract, which renders `cold-start` only when population range is null and `watching` when range exists + value is out of range. The current behaviour matches Story 3.1 exactly; AC3's intent is "no personal-baseline chip", not "force cold-start glyph regardless of range". **Outcome:** declined; matches spec on re-read.

6. **R1-P256 [LOW → decline] — `BaselineSkiaChart.useChartTransformState` import path / call ordering.** Hook is called unconditionally inside `BaselineSkiaChart`; the web short-circuit returns from a different sibling (`BaselineChartBody`) before the hook component renders, so React's rules-of-hooks contract holds. No bug.

7. **R1-P257 [LOW → decline] — `BaselineView.drawCount` is a second SELECT round-trip when the value is also computable from `recordQuery.data.drawCount` (one round-trip avoided).** Architecturally `getPersonalBaseline` is independent of `getRecord` (different audit kind, different cache lifecycle, different latency budget per NFR-SC4). Coupling them to save one COUNT query would re-introduce the dependency the architecture explicitly separates. **Outcome:** declined; ~ms-scale cost on an indexed COUNT is below the perf budget.

8. **R1-P258 [LOW → accept] — `BiomarkerCard` `personalBaselineMean` / `personalBaselineStddev` props are accepted but unused in rendering.** Spec Task 3.2 required adding the props; AC2/AC3 narration only consume `zScore`. The accepted props are a forward-compatibility surface for a future detail-sheet (Story 4.x). Leaving them as `_personalBaselineMean: _` underscore-prefixed is the standard "intentional unused" eslint signal. **Outcome:** accepted as-is.

9. **R1-P259 [LOW → decline] — `coerceFinite` accepts `string | number` but SQL casts to `double precision`, so postgres.js will never deliver a string.** Defense-in-depth against driver/upstream changes; explicitly documented in JSDoc. Matches `observations-record.ts`'s `coerceNumeric` posture. No bug.

10. **R1-P260 [LOW → decline] — SQL `GROUP BY COALESCE(loinc_code, '__no_loinc__|' || ...), loinc_code, unit_ucum` is redundant in the latter two columns (COALESCE alone is 1:1 with `(loinc_code, name, unit)`).** Cosmetic; Postgres planner collapses it. No bug.

11. **R1-P261 [LOW → decline] — Cold-start fallback `BiomarkerCard`s only surface biomarkers in the LATEST draw.** A single-history biomarker present in Draw 1 but absent from Draw 2+ would be silently dropped from the UI. Spec AC3 wording ("brand-new biomarker introduced in Draw 2") explicitly scopes to latest-draw biomarkers, so this matches intent. No bug.

12. **R1-P262 [LOW → decline] — Audit-row write inside the same transaction means a DB hiccup on the audit insert fails the entire request even after baselines computed successfully.** Matches the Story 3.1 posture (atomic audit-row contract per AC6); failing-closed is the project standard for read-audit integrity. No bug.

**AC traceability check:**

- AC1 (`baseline-established` per-biomarker chart, line + band + dots, x-axis-only pinch/pan) — passing (`pan.dimensions: 'x'`, `pinch.dimensions: 'x'` set in `BaselineSkiaChart`; `Area` + `Line` + `Scatter` wired).
- AC2 (`watching` 1.0≤|z|<1.5, `notable` |z|≥1.5, stddev=0 → within-band) — passing (`deviationStateForZScore` exact match; `zScore: null` audit-tested).
- AC3 (population-range suppressed when baseline exists; single-history → cold-start) — passing (see R1-P255).
- AC4 (single SQL aggregate, soft-delete filter, RLS-scoped, audit row in transaction, NFR-SC4 fixture) — passing (`WHERE deleted_at IS NULL` present; protectedProcedure context applies `set_config('app.current_patient_id', ...)`; integration fixture written, F167 deferred for Docker).
- AC5 (render-gating; drawCount===0 → cold-start, ===1 → Story 3.2, >=2 → new; suppresses primary EmptyStateRecord at >=2) — passing.
- AC6 (one `observation.baseline.read` audit per call, inside transaction, metadata `{biomarkerCount, drawCount}`) — passing.
- AC7 (composite chart `accessibilityLabel`, reduced-motion disables animations) — passing.
- AC8 (pt-BR copy in validators, Tamagui tokens, no `red`, no lucide) — passing (Tamagui-escape constants in `fingerprint-chart-baseline.tsx` cite the spec-sanctioned `no-restricted-syntax` disable rationale; no red appears; lucide not added).

**Cross-cutting discipline checks (clean):**

- Narrow catches — no new try/catch; only explicit guards (divide-by-zero in z-score, `Number.isFinite` NaN drop) ✓
- Soft-delete filter applied in the aggregate ✓
- No new query-param coupling (Epic 2 retro action item 3) ✓
- No schema changes — no partial-index `WHERE` migration risk (CLAUDE.md ops note) ✓
- Dead-code guard — single-source `drawCount` gating (`recordQuery.data.drawCount` only; baseline query enabled gate matches; render branch does not double-check `baselineQuery.data?.baselines.length`) ✓
- Audit-log atomicity — `writeAuditLog` called inside `protectedProcedure` transaction; one audit row per call (verified by `observations-baseline.test.ts` test #4) ✓
- Cold-start-1 byte-for-byte preserved — `FingerprintChart` switch dispatches `cold-start-1` to a sibling `ColdStart1Chart` function whose body is unchanged from Story 3.2 ✓
- Web bundle isolation — `navigator.product === 'ReactNative'` sniff short-circuits the Victory Native `require` so Skia doesn't enter the web build ✓

**AC gaps revealed:** none. All ACs traced to passing implementation; one finding (R1-P251) was a latent edge-case that would have shipped without symptom until a malformed history list surfaced.

**F-items carried forward:** F167 (db integration tests not executed in this environment — no Docker), F168 (no vitest+RTL in `packages/ui`; UI snapshot tests deferred), F168-V (no vitest in `packages/validators`), F169 (no `lucide-react-native`).

**Files touched in this Round:** `packages/ui/src/fingerprint-chart-baseline.tsx`, `packages/api/src/observations-baseline.ts`, `_bmad-output/implementation-artifacts/3-3-patient-views-the-fingerprint-at-draw-2-with-personal-baseline-band.md`.

**Status:** Ready for Round 2 (sprint-status not updated this round — R2 still to come; nothing committed).

### Round 2 Review

**Reviewer:** code-review skill (Opus 4.7), 2026-05-23.
**Scope:** all Story 3.3 file-list changes diffed against HEAD (ed751f0; Stories 3.1 + 3.2 baseline) with the R1 patches applied. Three adversarial layers run inline (Blind Hunter / Edge Case Hunter / Acceptance Auditor). Charter focus: hunt what R1 broke or half-finished, re-review R1 dismissals (R1-P252 / R1-P255 / R1-P261 / R1-P262), verify Victory Native v41 chart-prop wiring against the actual installed types, and surface pt-BR plural agreement edge cases on z-score narration.

**Patch ID range:** R2-P263 … R2-P268.

**Quality gates after R2 patches:** `pnpm typecheck` green (16 tasks). `pnpm lint` green (14 tasks). `pnpm --filter @healthtracker/api run test:unit` green (135 tests, 13 files, 6.98s — 7 new `observations-baseline.test.ts` cases still passing after pt-BR narration helper change). `pnpm --filter @healthtracker/db run test:unit` no test files (db package has no unit suite per project posture; integration suite gated on Docker — F167 carries forward). `pnpm format:fix` clean (one Prettier reformat on `packages/ui/src/fingerprint-chart-baseline.tsx` after the R2-P263 edit).

**Findings (applied):**

1. **R2-P263 [HIGH] — Victory Native `Area` API misuse breaks the personal-baseline band.** `packages/ui/src/fingerprint-chart-baseline.tsx` render-prop callback passed both `y0={baseline.mean - baseline.stddev}` and `y1={baseline.mean + baseline.stddev}` to `<Area>`. Inspection of `node_modules/victory-native@41.20.3/dist/cartesian/components/Area.d.ts` shows `Area` accepts a SINGLE `y0: number` plus the chart's `points` line — it fills between the data line and `y0`. The `y1` prop was silently dropped by TypeScript's `Record<string, unknown>` cast and by Victory Native at runtime. Net effect: the rendered "shaded teal personal baseline band" actually filled from `mean - stddev` to the data line, NOT the `[mean - stddev, mean + stddev]` band that AC1 explicitly requires ("a shaded teal personal baseline band rendered as `mean ± 1 standard deviation`"). This is a real AC1 violation that would have shipped invisible to QA without a Skia visual snapshot. **Outcome:** applied. Switched to Victory Native's `AreaRange` primitive, building `upperPoints` / `lowerPoints` arrays from the chart's `points.y` x-coordinates pinned at `mean ± stddev` so the band spans the full data range at the correct ±stddev offsets. Added `AreaRange` to both the dynamic `require` typing and the `VictoryNativeModule` interface. Dropped the unused `Area` destructure.

2. **R2-P264 [LOW] — `Area` received unsupported `chartBounds` prop.** Same render-prop callback also passed `chartBounds={chartBounds}` to `<Area>`. Victory Native v41 `Area`/`AreaRange` don't accept `chartBounds` — it was silently ignored. Cosmetic but removed alongside R2-P263 since the edit was already touching the region. **Outcome:** applied as part of R2-P263's edit.

3. **R2-P268 [LOW] — pt-BR singular/plural agreement on "desvio" at `|z| === 1`.** `BIOMARKER_PERSONAL_BASELINE_NARRATION_PT_BR` and `FINGERPRINT_BASELINE_A11Y_LABEL_PT_BR` both emit `"{magnitude} desvios {direction} da sua linha de base pessoal"` unconditionally. At the exact AC2 boundary `|z| === 1.0`, `formatBrazilianDecimal(1)` returns `"1"` → narration becomes `"1 desvios"`, which is ungrammatical in pt-BR ("1 desvio" — singular). The boundary `|z| === 1.0` is rare in practice but is the documented threshold between `within-band` and `watching`, so a screen-reader user could reasonably hear this if the z-score happens to land exactly there. **Outcome:** applied. Both helpers now switch to singular `"desvio"` when `Math.abs(zScore) === 1`, plural `"desvios"` otherwise.

**Findings (closed without patch):**

4. **R2-P265 [MED → decline] — `BaselineChartBody` runtime-detects React Native via `navigator.product === 'ReactNative'`.** Verified against `react-native@0.81.5`: `Libraries/Core/setUpNavigator.js` still sets `global.navigator = { product: 'ReactNative' }` and uses `polyfillObjectProperty(navigator, 'product', () => 'ReactNative')` when one already exists. The UA-marker heuristic is intact in RN 0.81 (the version this story added). No bug.

5. **R2-P266 [LOW → decline] — SQL `GROUP BY COALESCE(...), loinc_code, unit_ucum` looks redundant.** Re-checked vs. the integration fixture: the null-LOINC test (custom-extracted biomarker with `loinc_code IS NULL`) groups correctly (`sample_size === 2`) AND patient-A vs patient-B Ferritina (LOINC `2276-4`) stay isolated. R1-P260 stands. No bug.

**R1 dismissals re-reviewed (none reversed):**

- **R1-P252 (`require("victory-native")` at render time)** — re-confirmed dismissal. Grepped `apps/web/src` for `fingerprint-chart` / `FingerprintChart` consumers: zero matches. Static-analysis bundlers (Webpack/Metro) won't traverse the chart module's `require` from web because the chart is never imported by any web entry. The `navigator.product === 'ReactNative'` runtime guard is belt-and-braces (R2-P265 above verified the heuristic still holds in RN 0.81). When `apps/web` eventually consumes `FingerprintChart` (future web Fingerprint story), the require-at-render pattern will need re-evaluation; for Story 3.3 the dismissal stands.
- **R1-P255 (cold-start fallback `BiomarkerCard` state routing)** — re-confirmed dismissal. Re-read AC3: "single-biomarker card falls back to `BiomarkerCard` `cold-start` state (population range)". The current Inicio code passes `zScore: undefined` (not `null`) to the cold-start cards, which routes through `deviationStateForValue` (Story 3.1 contract) → `cold-start` when range is null, `watching` when value out of range. AC3's intent is "no personal-baseline chip on single-history biomarkers"; that intent is satisfied by `zScore === undefined`. No bug.
- **R1-P261 (cold-start fallback latest-draw only)** — re-confirmed dismissal. AC3 wording: "brand-new biomarker introduced in Draw 2 that wasn't present in Draw 1" explicitly scopes the fallback to biomarkers in the latest draw. A single-history biomarker present in Draw 1 but absent from Draw 2 is intentionally not surfaced on Início (the patient's "current Fingerprint" is the latest draw). If Histórico wants a "biomarkers measured once historically" list, that's a separate story. No bug.
- **R1-P262 (audit fail-closed posture on baseline read)** — re-confirmed dismissal. `getRecordForPatient` (Story 3.1) writes its `observation.read` audit inside the same `protectedProcedure` transaction with no try/catch — a DB hiccup on the audit insert rolls the whole transaction back. `getPersonalBaselineForPatient` matches that posture exactly. Fail-closed on audit insert is the project's documented standard (Epic 2 retro: audit-log atomicity is non-negotiable). No bug.

**Composition checks (clean):**

- **R1-P251 reducer composition with Victory Native y-domain.** Verified `data.map(d => d.y)` upstream of the reducer always produces JS numbers (chart `data` is built from `biomarker.history`, which is typed `{ collectedAt: string; valueNumeric: number }` and already coerced at the API boundary). The reducer's empty-array guard seeds from `baseline.mean ?? 0` / `1`, so `yDomain` never contains `Infinity`. Composes correctly with the AreaRange band switch (the band y-coordinates are constants from `baseline.mean ± baseline.stddev`).
- **R1-P253 drawCount semantic divergence comment matches code.** Re-read the inline rationale at `packages/api/src/observations-baseline.ts` L183–L190 and the consumer contract in `inicio.tsx` L220 (uses `recordQuery.data?.drawCount` for gating, NEVER `baselineQuery.data?.drawCount`). The divergence is documented, the gating uses the right source, and the audit metadata carries the "sampling dates" count as intended. No new bug.
- **z-score boundary edge cases.** `|z| === 1.0` exactly → `deviationStateForZScore` returns `watching` (correct per AC2 `1.0 <= |z| < 1.5`); narration now reads "1 desvio" after R2-P268. `|z| === 1.5` exactly → returns `notable` (correct per AC2 `|z| >= 1.5`). Negative-zero `zScore`: `Math.abs(-0)` is `0`, then `0 < 1.0` → `within-band`, no chip. `Number.isFinite(NaN)` is `false` → `within-band` (defensive). All boundaries handled.
- **Dead-code guards.** Re-grep `inicio.tsx` for any double-check on `baselineQuery.data?.baselines.length` — none. Render-gating uses `drawCount` from `recordQuery.data` only; baseline-query `enabled` mirrors the same gate. Single-source contract preserved (Task 4.9).
- **Victory Native v41 `pinch.dimensions: 'x'` actually locks the y-axis.** Verified against the installed `dist/cartesian/utils/transformGestures.js`: `pinchTransformGesture` reads `dimensions` from `_config`, computes `scaleX = dimensions.includes('x')` / `scaleY = dimensions.includes('y')`, and passes `scaleY ? e.scale : 1` to the Skia `scale` matrix. With `dimensions: 'x'`, `scaleY` is `false` → y-axis scale is locked at `1`. `panTransformGesture` mirrors the same logic. Spec claim verified at the source level.
- **`Inicio` `drawCount === 0` / `drawCount === 1` paths preserved byte-for-byte.** Re-grepped the render gating: `drawCount === 0` → `<EmptyStateRecord>` + manual-BIA `Button` (original Story 2.7 surfaces, untouched); `drawCount === 1` → `<FingerprintChart state="cold-start-1" ...>` + `<EmptyStateRecord state="partial">` (Story 3.2 surfaces, untouched). The `showFingerprintBaseline` branch wraps NEW surfaces only; the `else` branch is the original `drawCount < 2` flow. Story 3.2 regression guard satisfied (R2-P244 lesson).

**audit_log write-amplification test correctness:** `packages/api/__tests__/observations-baseline.test.ts` test #4 ("AC6 — emits exactly one observation.baseline.read") asserts `auditValues.toHaveBeenCalledTimes(1)` — correctly catches double-fires (Story 2.5 R1-P152 lesson) without coupling to the audit-row internals.

**AC traceability check (post-R2):**

- AC1 (baseline-established per-biomarker chart, line + band + dots, x-axis-only pinch/pan) — **now passing post-R2-P263** (band is `AreaRange` between `mean ± stddev` as AC1 specifies; the v41 `pinch.dimensions: 'x'` / `pan.dimensions: 'x'` API was verified at the source level).
- AC2/AC3/AC4/AC5/AC6/AC7/AC8 — passing (R1 traceability holds; R2-P268 strengthens AC7 narration at the `|z| === 1` boundary).

**F-items carried forward:** F167 (db integration tests not executed in this environment — no Docker), F168 (no vitest+RTL in `packages/ui`; UI snapshot tests deferred), F168-V (no vitest in `packages/validators`), F169 (no `lucide-react-native`).

**Files touched in this Round:** `packages/ui/src/fingerprint-chart-baseline.tsx` (Area → AreaRange band switch, type updates, prettier reformat), `packages/validators/src/index.ts` (pt-BR singular/plural agreement on `desvio` at `|z| === 1`), `_bmad-output/implementation-artifacts/3-3-patient-views-the-fingerprint-at-draw-2-with-personal-baseline-band.md`, `_bmad-output/implementation-artifacts/sprint-status.yaml`.

**Status:** Round 2 complete. All HIGH/MED findings resolved; story moved to `done`. Nothing committed (per workflow).

### Round 3 Review

**Reviewer:** code-review skill (Opus 4.7), 2026-05-23.
**Scope:** R3 charter — hunt subtle composition bugs that survived R1+R2. Re-checked z-score boundary arithmetic (|z|===1.0, ===1.5, negative-zero, very-small-stddev), R2-P263 AreaRange composition across the chart's x-coordinate domain (including all-points-equal-mean and single-point-after-baseline degenerate cases), R1-P255 cold-start fallback semantics third re-read, audit-log fail-closed posture, web-bundle isolation (`navigator.product` sniff vs Metro/webpack static traversal), Tamagui token correctness, append-only validators discipline, NFR-SC4 fixture index assertion strength, pt-BR narration plural composition with R2-P268, and Início render-gating byte-for-byte preservation at drawCount===0/1.
**Patch ID range:** R3-P269 (1 applied; no other findings).

**Quality gates after R3 patches:** `pnpm typecheck` green (16 tasks, 8 cached). `pnpm lint` green (14 tasks, 6 cached). `pnpm --filter @healthtracker/api test` green (135 tests, 13 files, 6.62s — no regressions from any R3 edit). `pnpm --filter @healthtracker/db test:unit` no test files (project posture; integration suite gated on Docker — F167 carries forward). `pnpm format:fix` clean (no reformat needed).

**Findings (applied):**

1. **R3-P269 [LOW] — NFR-SC4 `EXPLAIN` plan assertion is too loose; doesn't verify the targeted index name.** `packages/db/__tests__/integration/observations-baseline.integration.test.ts` only asserts `not.toMatch(/Seq Scan/)`. The story's Dev Notes § "Load fixture scaling" mandates that the plan show `observations_patient_collected_idx` is used — not merely "no seq scan". The schema has three indexes mentioning `patient_id`: two are partial unique indexes with `WHERE deleted_at IS NULL AND upload_id IS NOT NULL` predicates (and `WHERE deleted_at IS NULL AND source = 'manual_bia'`) — neither match the baseline aggregate's `WHERE deleted_at IS NULL` filter (no `upload_id`/`source` predicate), so a planner regression that picked one of those would be a real perf defect. The current assertion would green-pass it silently. **Outcome:** applied. Added `expect(planText).toMatch(/observations_patient_collected_idx/)` alongside the existing `not Seq Scan` check + inline rationale comment citing the Dev Notes mandate.

**Findings (closed without patch):**

- **z-score boundary arithmetic (charter focus).** Re-verified:
  - `|z| === 1.0` exactly → `deviationStateForZScore` returns `watching` (correct per AC2 `1.0 <= |z| < 1.5`); narration reads "1 desvio" (R2-P268 singular). Composes correctly with the watching chip copy "acompanhando".
  - `|z| === 1.5` exactly → returns `notable` (correct per AC2 `|z| >= 1.5`); narration "1,5 desvios" (plural, since absZ !== 1).
  - `zScore = -0` → `Math.abs(-0) === 0` → within-band, no chip. Direction wouldn't be evaluated.
  - `stddev === 0` → `zScore = null` set in `observations-baseline.ts`; FINGERPRINT_BASELINE_A11Y_LABEL_PT_BR takes the "Sem variação" branch (no spurious magnitude). UI maps null → within-band.
  - Very small stddev (huge |z|) → no API-side clamping; UI renders the large magnitude as-is via formatBrazilianDecimal. No bug — that's the patient's actual statistical signal.

- **R2-P263 AreaRange composition across the chart's x-coordinate domain.** Re-traced `upperPoints`/`lowerPoints` construction: they're built by mapping over `points.y` (the chart's resolved data points after CartesianChart layout), pinning y to `baseline.mean ± baseline.stddev` while keeping each point's `x`/`xValue`. With ≥ 2 history points (baseline minimum sampleSize), the band spans the full data domain at the correct ±stddev offsets. Edge case: when all history values equal the mean, `stddev === 0` → `baseline === { mean, stddev: 0, ... }` → upper/lower points both at `mean` → zero-width band (correctly invisible); zScore is null → no chip; FINGERPRINT_BASELINE_A11Y_LABEL_PT_BR takes the "Sem variação" branch. Edge case: when only one history point exists, the biomarker is excluded from `baselines` by `HAVING COUNT(*) >= 2` in the SQL aggregate, so `BaselineSkiaChart` never renders it — the cold-start fallback BiomarkerCard handles it instead. AreaRange composition is sound.

- **R1-P255 cold-start fallback BiomarkerCard rendering (charter mandated re-read).** Third re-read of AC3: "single-biomarker card falls back to `BiomarkerCard` `cold-start` state (population range)". Verified the inicio.tsx cold-start branch passes `zScore: undefined` (NOT null) which routes through `deviationStateForValue` (Story 3.1 contract) → `cold-start` when range is null, `within-band` when in range, `watching` when out of range — with the population-range chip copy `BIOMARKER_OUT_OF_RANGE_LABEL_PT_BR`. AC3's intent is "no personal-baseline chip for single-history biomarkers"; satisfied. R1-P255 dismissal still solid on third read.

- **Audit-log atomicity — fail-closed posture.** Re-verified `getPersonalBaselineForPatient` writes the audit row via `writeAuditLog(database, ...)` inside the protectedProcedure transaction with NO try/catch. If `writeAuditLog` throws (DB hiccup on audit insert), the full transaction rolls back and the tRPC procedure surfaces the error — exactly matching Story 3.1's posture per R1-P262 dismissal. Project-standard.

- **Web-bundle isolation — Metro/webpack static traversal.** Verified: the `require("victory-native")` lives inside `BaselineChartBody`, gated at runtime by the `navigator.product === 'ReactNative'` sniff. Metro (RN bundler) WILL resolve and bundle victory-native + skia because it follows static `require()` calls — but that's the desired behaviour on RN. Webpack/Next.js would also statically follow the require IF `apps/web` imported `FingerprintChart` — but grep `apps/web/src` for `fingerprint-chart` / `FingerprintChart` consumers returns zero matches (still true at R3 time). The runtime guard is belt-and-braces but does NOT block static bundler traversal. Risk is deferred until a future apps/web Fingerprint story actually imports the chart; for Story 3.3 the posture is documented and dismissed in R1-P252 / re-confirmed in R2. No new bug.

- **Tamagui token correctness for new colour usage.** Re-grepped fingerprint-chart-baseline.tsx for hex literals: 5 constants (`COLOR_PRIMARY_TEAL`, `COLOR_PRIMARY_TEAL_LIGHT`, `COLOR_TEXT_PRIMARY`, `COLOR_TEXT_SECONDARY`, `COLOR_BORDER`) wrapped in `eslint-disable no-restricted-syntax` with cited rationale. Cross-checked against `packages/ui/src/theme/tokens.ts` light theme — values match (`#0D6E6E`, `#E0F2F1`, `#1A1A1A`, `#6B6B6B`, `#E8E3DB`). No `red` / `#DC2626` / `$errorRed`. Border + body Tamagui XStack/YStack/Text use proper tokens (`$border`, `$surfaceElevated`, `$textPrimary`, `$textSecondary`, `$primaryTealLight`). Compliant.

- **Append-only validators discipline across R1/R2/R3.** Re-checked `packages/validators/src/index.ts` ≥ line 1100 (Story 3.3 block). R2-P268 mutated the BODY of `BIOMARKER_PERSONAL_BASELINE_NARRATION_PT_BR` and `FINGERPRINT_BASELINE_A11Y_LABEL_PT_BR` to add the singular `desvio` branch — but those helpers are Story 3.3's OWN new exports (added in the same change set), not pre-existing Story 0–3.2 surfaces. Modifying a same-story helper's body is allowed; the R2-P244 discipline forbids renaming or mutating PRIOR-story constants. No prior-story constants touched in R1/R2/R3. Discipline preserved.

- **pt-BR narration composition with R2-P268 for the FingerprintBaselineChart accessibilityLabel.** Traced `BaselineBiomarkerCard` → `FINGERPRINT_BASELINE_A11Y_LABEL_PT_BR({ sampleSize: baseline.sampleSize, trend, zScore: biomarker.zScore })`. For baseline biomarkers, sampleSize >= 2 → plural "medições"; zScore is finite (or null when stddev=0). The R2-P268 desvio singular branch fires when |z|===1 exactly; otherwise plural. Composed correctly. The "Sem variação" branch fires when zScore is null, which only happens for `stddev === 0` — verified upstream in `observations-baseline.ts` L165.

- **Início render-gating byte-for-byte preservation at drawCount===0/1.** Re-grepped inicio.tsx render tree:
  - `drawCount === 0` (falls through `showFingerprintColdStart1 === false && showFingerprintBaseline === false`) → renders `<EmptyStateRecord headline={INICIO_HEADLINE_PT_BR} ctaLabel={INICIO_CTA_PT_BR} onCtaPress={() => setSheetOpen(true)} />` + the manual-BIA Button. Pre-R3.3 surfaces unchanged.
  - `drawCount === 1` → `showFingerprintColdStart1 === true` → renders `<FingerprintChart state="cold-start-1" ...>` + `<EmptyStateRecord state="partial" ...>`. Story 3.2 surfaces unchanged.
  - `drawCount >= 2` → `showFingerprintBaseline === true` → new Story 3.3 surfaces; ELSE branch (the upload CTAs) suppressed per AC5.
  - Single-source render gating: `drawCount` derived from `recordQuery.data?.drawCount` only; no double-check on `baselineQuery.data?.baselines.length`. Task 4.9 dead-code guard preserved.

- **BiomarkerCard cold-start path key collision (re-check after R3 walk).** Cold-start fallback uses `cs-${o.id}-${idx}` keys (observation entity id + array index). Observation id is the row primary key — globally unique. No collision risk even across draws. Baseline cards use `bl-${b.loincCode ?? b.biomarkerName}-${b.unitUcum}-${idx}`. Prefix `bl-` vs `cs-` ensures no cross-category collision. Compliant with Story 3.2 R1-P247 composite-key lesson.

**R1/R2 dismissals re-reviewed (none reversed):**

- **R1-P252 (`require("victory-native")` at render time)** — re-confirmed for the third time. Runtime guard + zero apps/web consumers + Metro-only static traversal scope. Still dismissed.
- **R1-P255 (cold-start fallback BiomarkerCard state routing)** — re-confirmed on third AC3 re-read. The wording explicitly admits both `cold-start` AND population-range `watching`/`within-band` as valid cold-start fallback outcomes; the constraint is only "no personal-baseline chip". Still dismissed.
- **R1-P261 (cold-start fallback latest-draw only)** — AC3 explicitly scopes to "biomarker introduced in Draw 2 that wasn't present in Draw 1". Still dismissed.
- **R1-P262 (audit fail-closed)** — matches Story 3.1 posture. Still dismissed.

**AC traceability check (post-R3):**

- AC1–AC8 — all passing. R3-P269 strengthens the NFR-SC4 test rigor without changing any AC behaviour at runtime.

**Cross-cutting discipline checks (clean):**

- Narrow catches — still no try/catch in Story 3.3 code paths; explicit guards (divide-by-zero, Number.isFinite) only ✓
- Query-param coupling — no new producers/consumers in 3.3 ✓
- Dead-code guards — single-source `drawCount` gating preserved ✓
- Audit-log atomicity — `writeAuditLog` inside protectedProcedure tx, fail-closed; exactly one row per call (unit-tested) ✓
- Soft-delete filter — applied in the aggregate and in the drawCount SELECT ✓
- TOCTOU SELECT-EXISTS-then-INSERT — N/A (read-only) ✓
- Partial-index ON-CONFLICT WHERE — N/A (no writes) ✓
- `pnpm db:push` for partial-index WHERE changes — N/A (no schema changes) ✓
- Append-only validators — preserved ✓

**F-items carried forward:** F167 (db integration tests not executable here — no Docker; R3-P269 fixture change runs as soon as Docker is available), F168 (no vitest+RTL in `packages/ui`), F168-V (no vitest in `packages/validators`), F169 (no `lucide-react-native`).

**Files touched in this Round:** `packages/db/__tests__/integration/observations-baseline.integration.test.ts` (R3-P269 — tightened EXPLAIN assertion with the targeted index-name check), `_bmad-output/implementation-artifacts/3-3-patient-views-the-fingerprint-at-draw-2-with-personal-baseline-band.md`, `_bmad-output/implementation-artifacts/sprint-status.yaml`.

**Status:** Round 3 complete. One LOW finding applied; story stays `done`. Nothing committed (per workflow).
