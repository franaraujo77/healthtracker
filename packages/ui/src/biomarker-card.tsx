"use client";

import { Text, XStack, YStack } from "tamagui";

import {
  BIOMARKER_CARD_A11Y_HINT_PT_BR,
  BIOMARKER_NOTABLE_LABEL_PT_BR,
  BIOMARKER_OUT_OF_RANGE_LABEL_PT_BR,
  BIOMARKER_PERSONAL_BASELINE_NARRATION_PT_BR,
  BIOMARKER_REFERENCE_LABEL_PT_BR,
  BIOMARKER_REFERENCE_UNAVAILABLE_PT_BR,
  BIOMARKER_RESULT_STALE_A11Y_PT_BR,
  BIOMARKER_RESULT_STALE_LABEL_PT_BR,
  BIOMARKER_WATCHING_LABEL_PT_BR,
  BIOMARKER_WITHIN_RANGE_LABEL_PT_BR,
  formatBrazilianDecimal,
} from "@healthtracker/validators";

/**
 * Story 3.1 — `BiomarkerCard` (UX spec lines 824–844).
 *
 * Ships the `standard` variant + 4 states (`within-band` / `watching` /
 * `notable` / `cold-start`) only. `compact`, `featured`, `loading`,
 * and `hidden-from-doctor` are deferred to Stories 3.2 / 3.3 / 5.1
 * per Task 2.2.
 *
 * **Amber, never red, never colour-only** (AC3, UX spec § "Amber-not-
 * red", UX-DR19/20). Deviation chip uses the existing
 * `$biomarkerDeviation` + `$biomarkerDeviationBg` Tamagui tokens
 * (already wired in `packages/ui/src/theme`). The chip pairs a glyph
 * with the pt-BR label `"fora da faixa de referência"` so the meaning
 * survives a monochrome screenshot.
 *
 * Reduce-motion: no animations on the shipped variants this story
 * (animation lands in Stories 3.2/3.3). Reduced-motion compliance is
 * trivial.
 *
 * Accessibility: the composite label reads
 * `"{name}, {value} {unit}, {referenceRangeNarration|deviationDescription}"`
 * (AC7). `accessibilityRole="button"` even though the tap is a no-op
 * today — Story 4.3 wires the detail sheet.
 */

export type BiomarkerCardVariant = "standard";
export type BiomarkerCardState =
  | "within-band"
  | "watching"
  | "notable"
  | "cold-start";

export interface BiomarkerCardProps {
  biomarkerName: string;
  valueNumeric: number;
  unitUcum: string;
  referenceRangeLow: number | null;
  referenceRangeHigh: number | null;
  variant?: BiomarkerCardVariant;
  state?: BiomarkerCardState;
  onPress?: () => void;
  /**
   * Story 3.3 — personal-baseline z-score for the latest value.
   *   - finite number → resolves to `watching` / `notable` per `|z|`
   *     thresholds (AC2) and overrides the population-range state.
   *   - `null` → personal baseline exists but `stddev === 0` (AC2
   *     degenerate) — resolves to `within-band`, no chip rendered.
   *   - `undefined` → no personal baseline (Story 3.1 / 3.2 caller);
   *     fall back to population-range `deviationStateForValue`.
   */
  zScore?: number | null;
  /** Story 3.3 — personal baseline metadata for the narration. */
  personalBaselineMean?: number;
  personalBaselineStddev?: number;
  /**
   * Story 6.5 — when `true`, render a "Resultado antigo" chip in
   * addition to any deviation chip. Orthogonal to `state`. Pair with
   * `stalenessThresholdDays` to compose the a11y narration.
   *
   * `undefined` MUST behave identically to pre-6.5 (no chip, no a11y
   * change) — patient surfaces (Início, Histórico) never pass it.
   */
  isStale?: boolean;
  /**
   * Story 6.5 — doctor's configured threshold (or
   * `STALENESS_DEFAULT_DAYS`) used for the a11y narration. REQUIRED
   * when `isStale === true`; otherwise ignored.
   */
  stalenessThresholdDays?: number;
}

/** Pure helper — exported for tests / future consumers. */
export function deviationStateForValue(
  value: number,
  low: number | null,
  high: number | null,
): BiomarkerCardState {
  if (low === null || high === null) return "cold-start";
  if (value < low || value > high) return "watching";
  return "within-band";
}

function formatRange(low: number | null, high: number | null): string | null {
  if (low === null || high === null) return null;
  return `${formatBrazilianDecimal(low)} – ${formatBrazilianDecimal(high)}`;
}

/**
 * Story 3.3 — resolve the deviation state from an explicit personal-
 * baseline z-score. Mirrors AC2 thresholds:
 *   |z| >= 1.5 → notable
 *   1.0 <= |z| < 1.5 → watching
 *   |z| < 1.0 → within-band
 * `zScore === null` (degenerate stddev=0) → within-band (no chip).
 * Pure function — exported for tests.
 */
export function deviationStateForZScore(
  zScore: number | null,
): BiomarkerCardState {
  if (zScore === null || !Number.isFinite(zScore)) return "within-band";
  const abs = Math.abs(zScore);
  if (abs >= 1.5) return "notable";
  if (abs >= 1.0) return "watching";
  return "within-band";
}

function buildAccessibilityLabel(
  biomarkerName: string,
  valueNumeric: number,
  unitUcum: string,
  state: BiomarkerCardState,
  zScore: number | null | undefined,
  isStale?: boolean,
  stalenessThresholdDays?: number,
): string {
  const valuePart = `${formatBrazilianDecimal(valueNumeric)} ${unitUcum}`;
  // Story 3.3 — personal-baseline narration takes precedence over
  // population-range narration when the caller supplied a finite z
  // (AC3). `zScore === null` falls through to the existing within-
  // band / cold-start path.
  let base: string;
  if (
    typeof zScore === "number" &&
    Number.isFinite(zScore) &&
    (state === "watching" || state === "notable")
  ) {
    const direction: "above" | "below" = zScore < 0 ? "below" : "above";
    const narration = BIOMARKER_PERSONAL_BASELINE_NARRATION_PT_BR({
      zScore,
      direction,
    });
    base = `${biomarkerName}, ${valuePart}, ${narration}.`;
  } else {
    let narration: string;
    switch (state) {
      case "watching":
      case "notable":
        narration = BIOMARKER_OUT_OF_RANGE_LABEL_PT_BR;
        break;
      case "within-band":
        narration = BIOMARKER_WITHIN_RANGE_LABEL_PT_BR;
        break;
      case "cold-start":
      default:
        narration = BIOMARKER_REFERENCE_UNAVAILABLE_PT_BR;
        break;
    }
    base = `${biomarkerName}, ${valuePart}, ${narration}`;
  }
  // Story 6.5 — orthogonal staleness narration appended after the
  // existing deviation/within-band narration. `isStale === undefined`
  // produces no change (patient-surface invariant).
  if (isStale === true && typeof stalenessThresholdDays === "number") {
    return `${base} ${BIOMARKER_RESULT_STALE_A11Y_PT_BR(stalenessThresholdDays)}`;
  }
  return base;
}

export function BiomarkerCard({
  biomarkerName,
  valueNumeric,
  unitUcum,
  referenceRangeLow,
  referenceRangeHigh,
  variant: _variant = "standard",
  state,
  onPress,
  zScore,
  personalBaselineMean: _personalBaselineMean,
  personalBaselineStddev: _personalBaselineStddev,
  isStale,
  stalenessThresholdDays,
}: BiomarkerCardProps) {
  // State resolution priority:
  //   1. explicit `state` prop (test / caller override),
  //   2. Story 3.3 personal-baseline z-score (when provided),
  //   3. Story 3.1 population-range fallback.
  // `zScore === null` resolves via the z-score path to `within-band`
  // (AC2 degenerate stddev=0); only `undefined` falls through to
  // population range — preserves Story 3.1 / 3.2 caller behaviour.
  const resolvedState =
    state ??
    (zScore !== undefined
      ? deviationStateForZScore(zScore)
      : deviationStateForValue(
          valueNumeric,
          referenceRangeLow,
          referenceRangeHigh,
        ));
  const isDeviation =
    resolvedState === "watching" || resolvedState === "notable";
  const rangeText = formatRange(referenceRangeLow, referenceRangeHigh);
  const a11yLabel = buildAccessibilityLabel(
    biomarkerName,
    valueNumeric,
    unitUcum,
    resolvedState,
    zScore,
    isStale,
    stalenessThresholdDays,
  );
  // Story 3.3 — chip copy maps:
  //   watching → "acompanhando"
  //   notable  → "vale conversar"
  // Story 3.1 population-range path keeps the original
  // "fora da faixa de referência" copy (AC3 — when zScore is
  // undefined, this is the population-range surface).
  const isPersonalBaselineDeviation =
    typeof zScore === "number" &&
    Number.isFinite(zScore) &&
    (resolvedState === "watching" || resolvedState === "notable");
  let chipLabel = BIOMARKER_OUT_OF_RANGE_LABEL_PT_BR;
  if (isPersonalBaselineDeviation) {
    chipLabel =
      resolvedState === "notable"
        ? BIOMARKER_NOTABLE_LABEL_PT_BR
        : BIOMARKER_WATCHING_LABEL_PT_BR;
  }

  return (
    <YStack
      gap="$2"
      padding="$3"
      borderRadius="$card"
      borderWidth={1}
      borderColor="$border"
      backgroundColor="$surfaceElevated"
      minHeight={72}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={a11yLabel}
      accessibilityHint={BIOMARKER_CARD_A11Y_HINT_PT_BR}
    >
      <Text
        fontFamily="$body"
        fontSize={16}
        fontWeight="500"
        color="$textPrimary"
      >
        {biomarkerName}
      </Text>
      <XStack gap="$2" alignItems="baseline">
        <Text
          fontFamily="$body"
          fontSize={18}
          fontWeight="700"
          color="$textPrimary"
        >
          {formatBrazilianDecimal(valueNumeric)}
        </Text>
        <Text fontFamily="$body" fontSize={12} color="$textSecondary">
          {unitUcum}
        </Text>
      </XStack>
      {rangeText ? (
        <Text fontFamily="$body" fontSize={12} color="$textSecondary">
          {`${BIOMARKER_REFERENCE_LABEL_PT_BR}: ${rangeText} ${unitUcum}`}
        </Text>
      ) : null}
      {isStale === true ? (
        // Story 6.5 — orthogonal "Resultado antigo" chip. Tamagui
        // tokens only (R1-M3 from Story 6.3): muted info, NOT amber.
        // Distinct from the deviation chip so the doctor sees both
        // signals when a value is BOTH deviant AND stale.
        //
        // Story 6.5 R1-H1 fix-up: previously used
        // `backgroundColor="$textSecondary"` (a TEXT token mis-applied as
        // a surface). In dark theme that produced light-text-on-light-bg
        // (~2.3:1 contrast — FAILS WCAG AA). Use the existing neutral
        // surface token `$accessLogNeutral` (Story 5.3 muted-warm
        // neutral surface) paired with `$textPrimary` — passes AA in
        // both themes, NOT amber per UX-DR13.
        <XStack
          alignSelf="flex-start"
          gap="$1"
          paddingHorizontal="$2"
          paddingVertical="$1"
          borderRadius="$chip"
          backgroundColor="$accessLogNeutral"
          borderWidth={1}
          borderColor="$border"
          alignItems="center"
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        >
          <Text
            fontFamily="$body"
            fontSize={12}
            fontWeight="600"
            color="$textPrimary"
          >
            {BIOMARKER_RESULT_STALE_LABEL_PT_BR}
          </Text>
        </XStack>
      ) : null}
      {isDeviation ? (
        <XStack
          alignSelf="flex-start"
          gap="$1"
          paddingHorizontal="$2"
          paddingVertical="$1"
          borderRadius="$chip"
          backgroundColor="$biomarkerDeviationBg"
          alignItems="center"
        >
          {/* Icon glyph paired with the text label so colour is never
              the sole conveyor of meaning (AC3 / NFR-A4). Using a
              text glyph instead of `lucide-react-native` to avoid
              adding a new dep this story. */}
          <Text
            fontFamily="$body"
            fontSize={12}
            fontWeight="700"
            color="$biomarkerDeviation"
            aria-hidden
            // R1-P236 — `aria-hidden` is a web-only attribute; on RN
            // (Expo) the equivalent is `accessibilityElementsHidden`
            // + `importantForAccessibility`. The parent YStack already
            // owns the composite `accessibilityLabel`, so children
            // shouldn't be announced; this just makes the contract
            // explicit on both platforms.
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
          >
            {"!"}
          </Text>
          <Text
            fontFamily="$body"
            fontSize={12}
            fontWeight="600"
            color="$biomarkerDeviation"
          >
            {chipLabel}
          </Text>
        </XStack>
      ) : null}
    </YStack>
  );
}
