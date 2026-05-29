"use client";

import { useCallback } from "react";
import { Text, XStack, YStack } from "tamagui";

import type { ExportFormat } from "@healthtracker/validators";

/**
 * Story 5.5 T5.1 — radio-like card for the export-format picker.
 *
 * Mirrors the Story 5.2 `DurationOption` visual shape (Tier-2 sharing
 * styling per UX-DR13) but adds a `hint` slot for the per-format
 * explainer copy (AC1). Reusing `DurationOption` would have required
 * adding an optional `hint` prop and threading the rendered copy on
 * the call site — a dedicated component keeps the surface narrow.
 *
 * Accessibility:
 *   - `accessibilityRole="radio"`, `accessibilityState={{ selected }}`
 *   - `accessibilityLabel` carries the format label + hint
 */
export interface ExportFormatOptionProps {
  value: ExportFormat;
  label: string;
  hint: string;
  selected: boolean;
  onSelect: () => void;
}

export function ExportFormatOption(
  props: ExportFormatOptionProps,
): React.ReactElement {
  const { value, label, hint, selected, onSelect } = props;
  const handlePress = useCallback(() => {
    onSelect();
  }, [onSelect]);

  return (
    <XStack
      testID={`export-format-option-${value}`}
      accessible={true}
      accessibilityRole="radio"
      accessibilityLabel={`${label}. ${hint}`}
      accessibilityState={{ selected }}
      onPress={handlePress}
      paddingVertical="$3"
      paddingHorizontal="$4"
      borderRadius="$card"
      backgroundColor={selected ? "$shareToggleOn" : "$shareToggleOff"}
      borderWidth={selected ? 2 : 1}
      borderColor={selected ? "$primaryTeal" : "$border"}
      animation="quick"
      alignItems="center"
      justifyContent="space-between"
      hoverStyle={{ opacity: 0.95 }}
      pressStyle={{ opacity: 0.85 }}
    >
      <YStack flex={1} gap="$1">
        <Text fontSize="$4" color="$textPrimary">
          {label}
        </Text>
        <Text fontSize="$2" color="$textSecondary">
          {hint}
        </Text>
      </YStack>
      <YStack
        width={20}
        height={20}
        borderRadius={10}
        borderWidth={2}
        borderColor={selected ? "$primaryTeal" : "$border"}
        backgroundColor={selected ? "$primaryTeal" : "transparent"}
      />
    </XStack>
  );
}
