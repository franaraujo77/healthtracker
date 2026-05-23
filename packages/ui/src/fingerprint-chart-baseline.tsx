"use client";

import { Text, YStack } from "tamagui";

import type { FingerprintBaselineTrend } from "@healthtracker/validators";
import {
  FINGERPRINT_BASELINE_A11Y_LABEL_PT_BR,
  FINGERPRINT_BASELINE_TREND_ASCENDING_PT_BR,
  FINGERPRINT_BASELINE_TREND_DESCENDING_PT_BR,
  FINGERPRINT_BASELINE_TREND_FLAT_PT_BR,
  formatBrazilianDecimal,
  formatCollectedAtPtBr,
} from "@healthtracker/validators";

/**
 * Story 3.3 — `baseline-established` rendering for `FingerprintChart`.
 *
 * Per-biomarker chart: line over chronological history, shaded teal
 * `mean ± stddev` band, scatter dots at each `(collectedAt,
 * valueNumeric)`. Pinch-to-zoom + pan are **x-axis only** so the
 * baseline band stays visually meaningful (a Y-axis transform would
 * misrepresent the deviation magnitude).
 *
 * **Library:** Victory Native (XL) v41. Doc reference (verified via
 * context7 MCP on 2026-05-23):
 *   https://github.com/formidablelabs/victory-native-xl/blob/main/website/docs/cartesian/cartesian-chart.md
 * Key API:
 *   - `CartesianChart` is the root; receives `data`, `xKey`, `yKeys`.
 *   - `useChartTransformState()` provides pinch/pan state.
 *   - `transformConfig` accepts `pan.dimensions: 'x'` and
 *     `pinch.dimensions: 'x'` to lock the y-axis.
 *   - `Line`, `Area`, `Scatter` are children rendered against
 *     `points` from the render-prop signature.
 *
 * **Skia / SVG dependency.** Victory Native XL ships its rendering
 * via `@shopify/react-native-skia`. On Expo this is bundled with
 * the library. The chart is wrapped in a `Platform.OS === 'web'`
 * guard so the `packages/ui` consumer in `apps/web` (no Expo Skia
 * backend) renders a static fallback instead of attempting Skia.
 *
 * **Tokens.** Hard colour constants below are the resolved Tamagui
 * `light` theme values (per Story 3.3 Dev Notes § "Tamagui-only" —
 * Victory Native primitives accept colour strings only, no
 * `$token` interpolation). Mirrors the rationale used by
 * `inicio.tsx`'s `BACKGROUND_PRIMARY` constant.
 *
 * **Reduced motion.** When `reducedMotion === true`, `animate` is
 * `false` on every Victory Native primitive and the pan/zoom decay
 * physics are disabled by passing `transformConfig` with
 * `activateAfterLongPress: 0` (the gesture still works; it just
 * settles instantly with no spring animation).
 */

// Resolved Tamagui `light` theme values. Victory Native primitives
// accept colour strings only — no `$token` interpolation available
// inside Skia draw calls, per Story 3.3 Dev Notes § "Tamagui-only".
// Mirrors `colorTokens` (light theme) in `./theme/tokens.ts`; if
// those tokens shift, update both. (The `no-restricted-syntax`
// disable is the spec-sanctioned escape hatch — same pattern as
// `BACKGROUND_PRIMARY` in `apps/expo/src/app/(tabs)/inicio.tsx`.)
/* eslint-disable no-restricted-syntax */
const COLOR_PRIMARY_TEAL = "#0D6E6E";
const COLOR_PRIMARY_TEAL_LIGHT = "#E0F2F1";
const COLOR_TEXT_PRIMARY = "#1A1A1A";
const COLOR_TEXT_SECONDARY = "#6B6B6B";
const COLOR_BORDER = "#E8E3DB";
/* eslint-enable no-restricted-syntax */

const CHART_HEIGHT = 180;

export interface FingerprintChartBaselineBiomarker {
  loincCode: string | null;
  biomarkerName: string;
  unitUcum: string;
  /** Chronological history points used for the line + scatter. */
  history: { collectedAt: string; valueNumeric: number }[];
  /**
   * `null` when the biomarker has only one historical sample
   * (cold-start fallback per AC3 — handled by the caller, not
   * rendered as a band).
   */
  baseline: { mean: number; stddev: number; sampleSize: number } | null;
  latestValue: number;
  /** `null` when `stddev === 0` (AC2 degenerate case). */
  zScore: number | null;
}

export interface FingerprintBaselineChartProps {
  biomarkers: FingerprintChartBaselineBiomarker[];
  reducedMotion?: boolean;
}

/**
 * Story 3.3 — simple linear-regression trend over a chronological
 * series. Slope sign drives the verbal trend; near-zero slope
 * (|slope| < mean * 0.001) is "estável" to avoid floating-point
 * jitter on essentially flat series.
 *
 * x = days since the earliest sample (integer days are fine — we
 * only need the sign and a rough magnitude). y = valueNumeric.
 * Empty / single-point series return "estável".
 *
 * Pure function — exported for unit testing.
 */
export function computeTrend(
  history: { collectedAt: string; valueNumeric: number }[],
): FingerprintBaselineTrend {
  if (history.length < 2) return FINGERPRINT_BASELINE_TREND_FLAT_PT_BR;
  // Parse `yyyy-mm-dd` without `new Date(...)` (UTC-shift hazard,
  // Story 3.1 R3-P246) — we only need a relative ordering, so
  // convert to days-from-epoch arithmetic on the parsed parts.
  function daysFromIso(iso: string): number {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
    if (!match) return 0;
    const y = Number.parseInt(match[1] ?? "0", 10);
    const m = Number.parseInt(match[2] ?? "1", 10);
    const d = Number.parseInt(match[3] ?? "1", 10);
    // Date.UTC returns ms since epoch — divide to days.
    return Math.floor(Date.UTC(y, m - 1, d) / 86_400_000);
  }
  const xs = history.map((h) => daysFromIso(h.collectedAt));
  const ys = history.map((h) => h.valueNumeric);
  const n = xs.length;
  const sumX = xs.reduce((a, b) => a + b, 0);
  const sumY = ys.reduce((a, b) => a + b, 0);
  const meanX = sumX / n;
  const meanY = sumY / n;
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    const dx = (xs[i] ?? 0) - meanX;
    num += dx * ((ys[i] ?? 0) - meanY);
    den += dx * dx;
  }
  if (den === 0) return FINGERPRINT_BASELINE_TREND_FLAT_PT_BR;
  const slope = num / den;
  // Threshold relative to mean magnitude — avoids declaring noise
  // a trend on tightly clustered series.
  const epsilon = Math.max(Math.abs(meanY) * 0.001, 1e-9);
  if (Math.abs(slope) < epsilon) return FINGERPRINT_BASELINE_TREND_FLAT_PT_BR;
  return slope > 0
    ? FINGERPRINT_BASELINE_TREND_ASCENDING_PT_BR
    : FINGERPRINT_BASELINE_TREND_DESCENDING_PT_BR;
}

/**
 * Single-biomarker chart card. Kept as a sub-component so the
 * shared `YStack` shell + per-card a11y label stays close to the
 * Skia render call.
 */
function BaselineBiomarkerCard({
  biomarker,
  reducedMotion,
}: {
  biomarker: FingerprintChartBaselineBiomarker;
  reducedMotion: boolean;
}) {
  const trend = computeTrend(biomarker.history);
  const sampleSize = biomarker.baseline?.sampleSize ?? biomarker.history.length;
  const a11yLabel = FINGERPRINT_BASELINE_A11Y_LABEL_PT_BR({
    biomarkerName: biomarker.biomarkerName,
    sampleSize,
    trend,
    zScore: biomarker.zScore,
  });

  // Header text (visible) — biomarker name + latest value.
  const latestText = `${formatBrazilianDecimal(biomarker.latestValue)} ${biomarker.unitUcum}`;
  const latestDate = biomarker.history.at(-1)?.collectedAt ?? "";
  const latestDateLabel = latestDate ? formatCollectedAtPtBr(latestDate) : "";

  return (
    <YStack
      gap="$2"
      padding="$3"
      borderRadius="$card"
      borderWidth={1}
      borderColor="$border"
      backgroundColor="$surfaceElevated"
      accessibilityRole="image"
      accessibilityLabel={a11yLabel}
      aria-label={a11yLabel}
    >
      <Text
        fontFamily="$body"
        fontSize={14}
        fontWeight="600"
        color="$textPrimary"
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        aria-hidden
      >
        {biomarker.biomarkerName}
      </Text>
      <Text
        fontFamily="$body"
        fontSize={12}
        color="$textSecondary"
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        aria-hidden
      >
        {latestText}
        {latestDateLabel ? ` · ${latestDateLabel}` : ""}
      </Text>
      <BaselineChartBody biomarker={biomarker} reducedMotion={reducedMotion} />
    </YStack>
  );
}

/**
 * Renders the actual Victory Native chart. Split out so the
 * `Platform.OS === 'web'` short-circuit can early-return a
 * placeholder without paying for the Skia bridge on web (no
 * `apps/web` consumer this story; future web Fingerprint story
 * will revisit).
 */
function BaselineChartBody({
  biomarker,
  reducedMotion,
}: {
  biomarker: FingerprintChartBaselineBiomarker;
  reducedMotion: boolean;
}) {
  // Avoid importing Victory Native on web — it pulls in Skia which
  // chokes Next.js. Story 3.3 ships Expo-only.
  // `packages/ui` doesn't depend on react-native (it's consumed by
  // both Expo and Next), so we detect the native runtime by sniffing
  // `globalThis.navigator?.product === 'ReactNative'` — the canonical
  // RN UA marker — instead of importing `Platform`.
  const isReactNative =
    typeof navigator !== "undefined" &&
    (navigator as { product?: string }).product === "ReactNative";
  if (!isReactNative) {
    return (
      <YStack
        height={CHART_HEIGHT}
        backgroundColor="$primaryTealLight"
        borderRadius="$card"
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        aria-hidden
      />
    );
  }
  // `require` keeps Victory Native off the web bundle entirely
  // (Story 3.3 Dev Notes § "fingerprint-chart STAYS in packages/ui").
  // The require result + transform-state hook surface are typed
  // narrowly here so the rest of the file remains strictly typed.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const VictoryNative = require("victory-native") as {
    CartesianChart: React.ComponentType<Record<string, unknown>>;
    Line: React.ComponentType<Record<string, unknown>>;
    Area: React.ComponentType<Record<string, unknown>>;
    AreaRange: React.ComponentType<Record<string, unknown>>;
    Scatter: React.ComponentType<Record<string, unknown>>;
    useChartTransformState: (init?: { scaleX?: number; scaleY?: number }) => {
      state: unknown;
    };
  };

  return (
    <BaselineSkiaChart
      biomarker={biomarker}
      reducedMotion={reducedMotion}
      VictoryNative={VictoryNative}
    />
  );
}

interface VictoryNativeModule {
  CartesianChart: React.ComponentType<Record<string, unknown>>;
  Line: React.ComponentType<Record<string, unknown>>;
  Area: React.ComponentType<Record<string, unknown>>;
  AreaRange: React.ComponentType<Record<string, unknown>>;
  Scatter: React.ComponentType<Record<string, unknown>>;
  useChartTransformState: (init?: { scaleX?: number; scaleY?: number }) => {
    state: unknown;
  };
}

function BaselineSkiaChart({
  biomarker,
  reducedMotion,
  VictoryNative,
}: {
  biomarker: FingerprintChartBaselineBiomarker;
  reducedMotion: boolean;
  VictoryNative: VictoryNativeModule;
}) {
  const { CartesianChart, Line, AreaRange, Scatter, useChartTransformState } =
    VictoryNative;
  const { state: transformState } = useChartTransformState();

  // Build chart data — Victory Native's CartesianChart wants a
  // single `data` array with shared `xKey` / `yKeys`. Encode
  // `collectedAt` as days-from-epoch for monotonic x; the visible
  // x-axis tick labels would be opt-in via `axisOptions.formatXLabel`
  // (deferred — Story 3.3 uses the visible header date label
  // instead, and the chart is an accessibility composite with a
  // single narrated label).
  const data = biomarker.history.map((h) => {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(h.collectedAt);
    const x = match
      ? Math.floor(
          Date.UTC(
            Number.parseInt(match[1] ?? "0", 10),
            Number.parseInt(match[2] ?? "1", 10) - 1,
            Number.parseInt(match[3] ?? "1", 10),
          ) / 86_400_000,
        )
      : 0;
    return { x, y: h.valueNumeric };
  });

  const baseline = biomarker.baseline;
  // Y-axis bounds: include the band so it always renders fully visible
  // (Task 2.4). Pad 5% on each side.
  // R1-P251 — Use a reducer instead of `Math.min(...values)` /
  // `Math.max(...values)`: the spread form blows the call stack on
  // unbounded arrays and is wasteful churn for the per-biomarker
  // history we expect (≤ ~1000 rows; Epic 2 retro). The reducer is
  // also defensive against `values.length === 0` (empty history
  // upstream — e.g. inicio.tsx's per-baseline `history` merge could
  // theoretically produce an empty array if a row mapping drifts;
  // returning Infinity/-Infinity would crash the Skia render).
  const values = data.map((d) => d.y);
  let minObserved = baseline ? baseline.mean : 0;
  let maxObserved = baseline ? baseline.mean : 1;
  if (values.length > 0) {
    minObserved = values.reduce(
      (acc, v) => (v < acc ? v : acc),
      values[0] ?? 0,
    );
    maxObserved = values.reduce(
      (acc, v) => (v > acc ? v : acc),
      values[0] ?? 0,
    );
  }
  const minY = baseline
    ? Math.min(minObserved, baseline.mean - baseline.stddev)
    : minObserved;
  const maxY = baseline
    ? Math.max(maxObserved, baseline.mean + baseline.stddev)
    : maxObserved;
  const span = Math.max(maxY - minY, 1e-9);
  const yDomain: [number, number] = [minY - span * 0.05, maxY + span * 0.05];

  // x-axis only pan + pinch per AC1.
  const transformConfig = {
    pan: {
      enabled: true,
      dimensions: "x" as const,
      activateAfterLongPress: reducedMotion ? 0 : 100,
    },
    pinch: { enabled: true, dimensions: "x" as const },
  };

  // Render-prop child returns Skia primitives. The Area covers the
  // teal personal-baseline band; Line + Scatter render the
  // historical trajectory.
  return (
    <YStack
      height={CHART_HEIGHT}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      aria-hidden
    >
      <CartesianChart
        data={data}
        xKey="x"
        yKeys={["y"]}
        domain={{ y: yDomain }}
        transformState={transformState}
        transformConfig={transformConfig}
      >
        {({ points }: { points: { y: { x: number; xValue: unknown }[] } }) => {
          // R2-P263 — Victory Native v41 `Area` accepts a single `y0:
          // number` (fill between the data line and `y0`), NOT a `(y0,
          // y1)` pair. Passing `y1` was silently ignored, which made
          // the rendered "personal baseline band" actually fill from
          // `mean - stddev` to the data line — NOT the `[mean - stddev,
          // mean + stddev]` band AC1 requires. Use `AreaRange` with
          // `upperPoints` / `lowerPoints` derived from the chart's `points.y`
          // x-coordinates so the band spans the full data range at the
          // correct ±stddev offsets. Also dropped the unsupported
          // `chartBounds` prop (R2-P264 — silently ignored by `Area`).
          const lowerPoints = baseline
            ? points.y.map((p) => ({
                x: p.x,
                xValue: p.xValue,
                y: baseline.mean - baseline.stddev,
                y0: baseline.mean - baseline.stddev,
                yValue: baseline.mean - baseline.stddev,
              }))
            : [];
          const upperPoints = baseline
            ? points.y.map((p) => ({
                x: p.x,
                xValue: p.xValue,
                y: baseline.mean + baseline.stddev,
                y0: baseline.mean + baseline.stddev,
                yValue: baseline.mean + baseline.stddev,
              }))
            : [];
          return (
            <>
              {baseline ? (
                <AreaRange
                  upperPoints={upperPoints}
                  lowerPoints={lowerPoints}
                  color={COLOR_PRIMARY_TEAL_LIGHT}
                  animate={reducedMotion ? false : { type: "timing" }}
                />
              ) : null}
              <Line
                points={points.y}
                color={COLOR_PRIMARY_TEAL}
                strokeWidth={2}
                animate={reducedMotion ? false : { type: "timing" }}
              />
              <Scatter
                points={points.y}
                radius={4}
                color={COLOR_PRIMARY_TEAL}
                animate={reducedMotion ? false : { type: "timing" }}
              />
            </>
          );
        }}
      </CartesianChart>
    </YStack>
  );
}

// Re-export the resolved tokens so callers/tests can inspect them.
export const FINGERPRINT_BASELINE_TOKENS = {
  primaryTeal: COLOR_PRIMARY_TEAL,
  primaryTealLight: COLOR_PRIMARY_TEAL_LIGHT,
  textPrimary: COLOR_TEXT_PRIMARY,
  textSecondary: COLOR_TEXT_SECONDARY,
  border: COLOR_BORDER,
} as const;

export function FingerprintBaselineChart({
  biomarkers,
  reducedMotion,
}: FingerprintBaselineChartProps) {
  return (
    <YStack
      gap="$3"
      padding="$3"
      backgroundColor="$surfaceElevated"
      borderRadius="$cardLg"
      borderWidth={1}
      borderColor="$border"
      margin="$3"
    >
      {biomarkers.map((b, idx) => (
        <BaselineBiomarkerCard
          // Composite key per Story 3.2 R1-P247 — duplicate
          // `(loincCode|biomarkerName, unit)` rows survive React
          // keyed reconciliation.
          key={`${b.loincCode ?? b.biomarkerName}-${b.unitUcum}-${idx}`}
          biomarker={b}
          reducedMotion={reducedMotion ?? false}
        />
      ))}
    </YStack>
  );
}
