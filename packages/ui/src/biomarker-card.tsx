"use client";

import { Text, XStack, YStack } from "tamagui";

import {
  BIOMARKER_CARD_A11Y_HINT_PT_BR,
  BIOMARKER_OUT_OF_RANGE_LABEL_PT_BR,
  BIOMARKER_REFERENCE_LABEL_PT_BR,
  BIOMARKER_REFERENCE_UNAVAILABLE_PT_BR,
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

function buildAccessibilityLabel(
  biomarkerName: string,
  valueNumeric: number,
  unitUcum: string,
  state: BiomarkerCardState,
): string {
  const valuePart = `${formatBrazilianDecimal(valueNumeric)} ${unitUcum}`;
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
  return `${biomarkerName}, ${valuePart}, ${narration}`;
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
}: BiomarkerCardProps) {
  const resolvedState =
    state ??
    deviationStateForValue(valueNumeric, referenceRangeLow, referenceRangeHigh);
  const isDeviation =
    resolvedState === "watching" || resolvedState === "notable";
  const rangeText = formatRange(referenceRangeLow, referenceRangeHigh);
  const a11yLabel = buildAccessibilityLabel(
    biomarkerName,
    valueNumeric,
    unitUcum,
    resolvedState,
  );

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
            {BIOMARKER_OUT_OF_RANGE_LABEL_PT_BR}
          </Text>
        </XStack>
      ) : null}
    </YStack>
  );
}
