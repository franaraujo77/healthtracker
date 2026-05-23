"use client";

import { useEffect, useState } from "react";
import { Circle, Text, View, XStack, YStack } from "tamagui";

import {
  BIOMARKER_REFERENCE_LABEL_PT_BR,
  BIOMARKER_REFERENCE_UNAVAILABLE_PT_BR,
  FINGERPRINT_COLD_START_A11Y_LABEL_PT_BR,
  FINGERPRINT_COLD_START_LABEL_PT_BR,
  FINGERPRINT_REFERENCE_RANGE_UNAVAILABLE_A11Y_PT_BR,
  formatBrazilianDecimal,
} from "@healthtracker/validators";

/**
 * Story 3.2 — `FingerprintChart` (UX spec lines 848–866).
 *
 * Ships the `cold-start-1` state only — one biomarker row per
 * observation, each showing a single pulsing teal dot positioned on
 * the population reference band (a shaded horizontal track). The
 * union widens to `| 'cold-start-2' | 'baseline-established'` in
 * Story 3.3.
 *
 * **Charting library deferral.** This story does NOT add Victory
 * Native. The cold-start-1 visual (positioned dot on a horizontal
 * track) is achievable with Tamagui primitives (`XStack`, `View`,
 * `Circle`) without a chart library. Victory Native arrives in
 * Story 3.3 when line-chart math actually lands (architecture doc
 * lines 486–491). When that happens, this ~50 line component is
 * easy to refactor — much cheaper than carrying an unused chart
 * library through Story 3.2.
 *
 * **Reduced motion** is caller-supplied (same pattern as
 * `ExtractionPulse`). When `reducedMotion === true` the pulse
 * animation is replaced by a static teal dot at full opacity, and
 * **no `setInterval` is scheduled** (AC4 boundary).
 *
 * **Accessibility.** The chart container reads one composite
 * `accessibilityLabel` (AC7); per-row decorative elements are
 * `accessibilityElementsHidden` + `importantForAccessibility=
 * "no-hide-descendants"` so VoiceOver/TalkBack don't double-announce
 * (the per-`BiomarkerCard` label below the chart carries each
 * biomarker's narration).
 */

export type FingerprintChartState = "cold-start-1";

export interface FingerprintChartBiomarker {
  biomarkerName: string;
  valueNumeric: number;
  unitUcum: string;
  referenceRangeLow: number | null;
  referenceRangeHigh: number | null;
}

export interface FingerprintChartProps {
  state: FingerprintChartState;
  biomarkers: FingerprintChartBiomarker[];
  /**
   * When true, suppresses the pulse animation. Caller-supplied so
   * each platform owns its own reduced-motion detection (matches
   * `ExtractionPulse`).
   */
  reducedMotion?: boolean;
}

const PULSE_PERIOD_MS = 2000;
const DOT_SIZE = 12;

/**
 * Compute the dot's normalised x position in `[0, 1]` for a value in
 * `[low, high]`. Clamps out-of-range values to `0` / `1`. When low or
 * high is null, OR when `high === low` (divide-by-zero — degenerate
 * single-point range), returns `0.5` (centred). Pure function — no
 * try/catch needed; the only failure mode is the explicit guard.
 */
export function normalisedDotPosition(
  value: number,
  low: number | null,
  high: number | null,
): number {
  if (low === null || high === null) return 0.5;
  if (high === low) return 0.5;
  const x = (value - low) / (high - low);
  if (x < 0) return 0;
  if (x > 1) return 1;
  return x;
}

/**
 * Local pulse hook — copied from `extraction-pulse.tsx`'s
 * `usePulseOpacity` pattern rather than imported (private helper there;
 * keep the surface narrow per Story 3.2 Task 1.6). When `active` is
 * false, no `setInterval` runs and the cleanup is a no-op.
 */
function usePulseOpacity(active: boolean): number {
  const [bright, setBright] = useState(true);
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setBright((b) => !b), PULSE_PERIOD_MS / 2);
    return () => clearInterval(id);
  }, [active]);
  if (!active) return 1;
  return bright ? 1 : 0.4;
}

interface BiomarkerRowProps {
  biomarker: FingerprintChartBiomarker;
  opacity: number;
}

/**
 * R1-P249 — per-row composite accessibilityLabel. The Story 3.2 spec
 * Task 1.7 assumed BiomarkerCards would render alongside the chart and
 * carry per-biomarker narration; in practice Inicio renders the chart
 * alone (no BiomarkerCard list), so without a per-row label VoiceOver
 * only hears the chart-level count and would miss every value.
 */
function rowAccessibilityLabel(b: FingerprintChartBiomarker): string {
  const valueText = `${formatBrazilianDecimal(b.valueNumeric)} ${b.unitUcum}`;
  if (b.referenceRangeLow === null || b.referenceRangeHigh === null) {
    return `${b.biomarkerName}: ${valueText}. ${BIOMARKER_REFERENCE_UNAVAILABLE_PT_BR}.`;
  }
  // R2-P250 — use the canonical `BIOMARKER_REFERENCE_LABEL_PT_BR`
  // surface string (matches `biomarker-card.tsx`'s rendering). R1-P249
  // introduced a hardcoded "Referência" literal, violating AC8's
  // greppable-copy discipline.
  return `${b.biomarkerName}: ${valueText}. ${BIOMARKER_REFERENCE_LABEL_PT_BR} ${formatBrazilianDecimal(b.referenceRangeLow)} a ${formatBrazilianDecimal(b.referenceRangeHigh)} ${b.unitUcum}.`;
}

function BiomarkerRow({ biomarker, opacity }: BiomarkerRowProps) {
  const {
    biomarkerName,
    valueNumeric,
    unitUcum,
    referenceRangeLow,
    referenceRangeHigh,
  } = biomarker;
  const rangeUnavailable =
    referenceRangeLow === null || referenceRangeHigh === null;
  const x = normalisedDotPosition(
    valueNumeric,
    referenceRangeLow,
    referenceRangeHigh,
  );
  // R1-P248 — inset the dot's positioning track by half the dot's
  // diameter so x=0 lands the dot tangent to the band's left edge
  // (not half off the edge) and x=1 mirrors on the right. Without
  // this inset + the leading `marginLeft={-(DOT_SIZE / 2)}`, a value
  // clamped to either band edge renders with half the dot bleeding
  // outside the reference band — wrong visual encoding.
  const leftPercent = `${(x * 100).toFixed(2)}%`;
  const a11yLabel = rowAccessibilityLabel(biomarker);
  return (
    <XStack
      alignItems="center"
      gap="$3"
      minHeight={56}
      accessibilityRole="text"
      accessibilityLabel={a11yLabel}
      aria-label={a11yLabel}
    >
      <Text
        fontFamily="$body"
        fontSize={14}
        color="$textPrimary"
        width={140}
        numberOfLines={1}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        aria-hidden
      >
        {biomarkerName}
      </Text>
      <View
        flex={1}
        height={8}
        justifyContent="center"
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        aria-hidden
      >
        <View
          height={8}
          width="100%"
          // When no population reference range is available, dim the
          // band (per AC3 fallback — Task 1.5). Use `$border` for the
          // dim colour to stay inside the token system.
          backgroundColor={rangeUnavailable ? "$border" : "$primaryTealLight"}
          borderRadius="$chip"
        />
        {/* Inner track inset by DOT_SIZE/2 on each side so the dot
            never bleeds past the band edges (R1-P248). */}
        <View
          position="absolute"
          left={DOT_SIZE / 2}
          right={DOT_SIZE / 2}
          top={0}
          bottom={0}
          justifyContent="center"
        >
          <View position="absolute" left={leftPercent}>
            <View marginLeft={-(DOT_SIZE / 2)}>
              <Circle
                size={DOT_SIZE}
                backgroundColor="$primaryTeal"
                opacity={opacity}
              />
            </View>
          </View>
        </View>
      </View>
      <Text
        fontFamily="$body"
        fontSize={14}
        fontWeight="700"
        color="$textPrimary"
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        aria-hidden
      >
        {formatBrazilianDecimal(valueNumeric)} {unitUcum}
      </Text>
    </XStack>
  );
}

export function FingerprintChart({
  state,
  biomarkers,
  reducedMotion,
}: FingerprintChartProps) {
  // AC4 — `reducedMotion === true` means no interval is scheduled.
  // The `state` discriminator only has `cold-start-1` today; Story
  // 3.3 widens it to `| 'cold-start-2' | 'baseline-established'` and
  // will gate the animation per-state then. Reference `state` so the
  // discriminator is observable in render even before Story 3.3.
  void state;
  const animating = !reducedMotion;
  const opacity = usePulseOpacity(animating);

  const count = biomarkers.length;
  const a11yLabel = FINGERPRINT_COLD_START_A11Y_LABEL_PT_BR(count);
  // When NO biomarker has a usable reference range, append the
  // fallback narration so a screen reader user knows the dots are
  // centred-by-default, not "in the middle of the band".
  const allRangesUnavailable =
    count > 0 &&
    biomarkers.every(
      (b) => b.referenceRangeLow === null || b.referenceRangeHigh === null,
    );
  const compositeLabel = allRangesUnavailable
    ? `${a11yLabel} ${FINGERPRINT_REFERENCE_RANGE_UNAVAILABLE_A11Y_PT_BR}.`
    : a11yLabel;

  return (
    <YStack
      gap="$3"
      padding="$4"
      backgroundColor="$surfaceElevated"
      borderRadius="$cardLg"
      borderWidth={1}
      borderColor="$border"
      margin="$3"
      accessibilityRole="image"
      accessibilityLabel={compositeLabel}
      aria-label={compositeLabel}
    >
      <Text fontFamily="$body" fontSize={14} color="$textSecondary">
        {FINGERPRINT_COLD_START_LABEL_PT_BR}
      </Text>
      <YStack gap="$2">
        {biomarkers.map((b, idx) => (
          <BiomarkerRow
            // R1-P247 — same biomarker name + unit could repeat (a row
            // with two POTASSIUM mmol/L entries from different orders
            // within one draw is rare but possible at the API layer);
            // include the index so React's keyed-list reconciliation
            // never collapses two rows into one (Story 2.1 P58 pattern).
            key={`${b.biomarkerName}-${b.unitUcum}-${idx}`}
            biomarker={b}
            opacity={opacity}
          />
        ))}
      </YStack>
    </YStack>
  );
}
