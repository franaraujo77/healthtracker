"use client";

import { Text, YStack } from "tamagui";

/**
 * Story 6.2 T6.1 — `ConversationStarterPrompt` (UX spec line 932).
 *
 * `default` state only this story; the `highlighted` interactivity is
 * deferred per UX spec line 940 + dev-notes deferral entry.
 *
 * Props:
 *   - `index` — 1-based ordinal shown in the badge.
 *   - `text` — pt-BR prompt body (LLM-generated; ANVISA-compliant).
 */

export interface ConversationStarterPromptProps {
  index: number;
  text: string;
}

export function ConversationStarterPrompt(
  props: ConversationStarterPromptProps,
): React.ReactElement {
  return (
    <YStack
      testID={`conversation-starter-prompt-${props.index}`}
      padding="$4"
      gap="$2"
      borderRadius="$card"
      backgroundColor="$surfaceElevated"
      borderWidth={1}
      borderColor="$borderSubtle"
      accessibilityRole="text"
      accessibilityLabel={`Prompt ${props.index}: ${props.text}`}
    >
      <Text fontSize="$2" color="$textSecondary">
        {`Prompt ${props.index}`}
      </Text>
      <Text fontSize="$4" color="$textPrimary">
        {props.text}
      </Text>
    </YStack>
  );
}
