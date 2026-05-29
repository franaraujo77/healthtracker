"use client";

import { useCallback } from "react";
import { Text, XStack, YStack } from "tamagui";

import type { ShareDuration } from "@healthtracker/validators";

/**
 * Story 5.2 T6.1 — radio-like card for the duration picker.
 *
 * Visual treatment:
 *   - Selected: teal accent border + `$shareToggleOn` fill (Tier 2 —
 *     never the green-filled primary; sharing actions are NEVER Tier 1
 *     per UX-DR13).
 *   - Unselected: `$shareToggleOff` muted fill.
 *
 * Accessibility:
 *   - `accessibilityRole="radio"`, `accessibilityState={{ selected }}`,
 *     `accessibilityLabel` carries the user-facing duration label.
 */

export interface DurationOptionProps {
  value: ShareDuration;
  label: string;
  selected: boolean;
  onSelect: () => void;
}

export function DurationOption(props: DurationOptionProps): React.ReactElement {
  const { value, label, selected, onSelect } = props;

  const handlePress = useCallback(() => {
    onSelect();
  }, [onSelect]);

  return (
    <XStack
      testID={`duration-option-${value}`}
      accessible={true}
      accessibilityRole="radio"
      accessibilityLabel={label}
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
      <YStack flex={1}>
        <Text fontSize="$4" color="$textPrimary">
          {label}
        </Text>
      </YStack>
      {/* Visual radio dot — filled when selected. */}
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
