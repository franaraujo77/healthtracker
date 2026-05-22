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
 * UX-DR10 names three states (cold-start / partial / filtered-empty)
 * × two variants (full-page / inline). Only `variant` ships in Story 1.2
 * because the single consumer (Início cold-start) doesn't distinguish
 * states yet; restore the `state` prop when a consumer needs different
 * visuals per state.
 */
export interface EmptyStateRecordProps {
  headline: string;
  description?: string;
  ctaLabel: string;
  onCtaPress: () => void;
  variant?: EmptyStateRecordVariant;
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
  illustration,
}: EmptyStateRecordProps) {
  const isFullPage = variant === "full-page";
  return (
    <YStack
      gap="$4"
      alignItems="center"
      justifyContent="center"
      paddingHorizontal="$4"
      paddingVertical={isFullPage ? "$8" : "$4"}
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
        fontSize={isFullPage ? "$7" : "$6"}
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
