"use client";

import { Text, YStack } from "tamagui";

import { Button } from "./button";

/**
 * Empty-state component used for the "Início" landing and other
 * post-onboarding zero-data screens (UX-DR10, Story 1.2 AC5).
 *
 * The illustration slot is marked `aria-hidden` per spec — all meaning
 * is conveyed in text. The CTA is the primary interactive element. No
 * hex literals: every color comes from a Tamagui semantic token.
 */

export type EmptyStateRecordVariant = "full-page" | "inline";

/**
 * Story 3.2 — UX-DR10 names three states (cold-start / partial /
 * filtered-empty). Story 3.2 ships `cold-start` (default; unchanged
 * from Story 1.2) and `partial` (Fingerprint at draw 1 — secondary
 * surface beneath the chart). `filtered-empty` is **NOT** in scope
 * until search/filter ships.
 *
 * The `partial` state changes tone and emphasis only, not layout:
 * smaller headline + tighter vertical padding so it stacks cleanly
 * under the chart without competing for attention.
 */
export type EmptyStateRecordState = "cold-start" | "partial";

export interface EmptyStateRecordProps {
  headline: string;
  description?: string;
  ctaLabel: string;
  onCtaPress: () => void;
  variant?: EmptyStateRecordVariant;
  /**
   * Story 3.2 — tone variant. Default `cold-start` is byte-for-byte
   * identical to Story 1.2 (existing call sites omit this prop and
   * must render unchanged — visual regression guard).
   */
  state?: EmptyStateRecordState;
  /**
   * Optional illustration slot. Wrapped in `aria-hidden` because all
   * meaning lives in the text. Pass an Image, an SVG, or null.
   */
  illustration?: React.ReactNode;
}

export function EmptyStateRecord({
  headline,
  description,
  ctaLabel,
  onCtaPress,
  variant = "full-page",
  state = "cold-start",
  illustration,
}: EmptyStateRecordProps) {
  const isFullPage = variant === "full-page";
  const isPartial = state === "partial";
  // Story 3.2 Task 2.2 — `partial` × `inline` tightens vertical padding
  // so the empty state docks under the FingerprintChart without a
  // floating gap. `full-page` × `partial` is not a documented
  // combination, but preserve the full-page padding if it ever shows
  // up (defensive default).
  let paddingVertical: "$3" | "$4" | "$8";
  if (isFullPage) {
    paddingVertical = "$8";
  } else if (isPartial) {
    paddingVertical = "$3";
  } else {
    paddingVertical = "$4";
  }
  // Cold-start wants a loud welcome ("$7" full-page, "$6" inline);
  // partial wants to whisper "there's more coming" ("$5").
  let headlineFontSize: "$5" | "$6" | "$7";
  if (isPartial) {
    headlineFontSize = "$5";
  } else if (isFullPage) {
    headlineFontSize = "$7";
  } else {
    headlineFontSize = "$6";
  }
  return (
    <YStack
      gap="$4"
      alignItems="center"
      justifyContent="center"
      paddingHorizontal="$4"
      paddingVertical={paddingVertical}
      flex={isFullPage ? 1 : undefined}
    >
      {illustration ? (
        <YStack
          aria-hidden
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        >
          {illustration}
        </YStack>
      ) : null}
      <Text
        fontFamily="$body"
        fontSize={headlineFontSize}
        fontWeight="700"
        color="$textPrimary"
        textAlign="center"
      >
        {headline}
      </Text>
      {description ? (
        <Text
          fontFamily="$body"
          fontSize="$4"
          color="$textSecondary"
          textAlign="center"
          maxWidth={420}
        >
          {description}
        </Text>
      ) : null}
      <Button onPress={onCtaPress} size={isFullPage ? "lg" : "md"}>
        {ctaLabel}
      </Button>
    </YStack>
  );
}
