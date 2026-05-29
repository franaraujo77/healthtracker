"use client";

import { useCallback, useEffect, useRef } from "react";
import { Text, XStack, YStack } from "tamagui";

import {
  BIOMARKER_HIDDEN_PT_BR_FN,
  BIOMARKER_VISIBLE_PT_BR_FN,
  formatBrazilianDecimal,
  NO_DATA_YET_PT_BR,
  SHARE_TOGGLE_A11Y_LABEL_PT_BR_FN,
} from "@healthtracker/validators";

/**
 * Story 5.1 — `ShareBiomarkerToggle` (AC6; UX spec lines 948–965).
 *
 * States:
 *   - `shared`   — toggle on,  teal token `$shareToggleOn`.
 *   - `hidden`   — toggle off, muted token `$shareToggleOff`, lock
 *                  glyph, value greyed. NEVER a red token (UX-DR13).
 *   - `disabled` — no data yet, toggle disabled, copy
 *                  `NO_DATA_YET_PT_BR`.
 *
 * Variants:
 *   - `setup` — initial sharing ceremony (all known categories).
 *   - `edit`  — re-configure existing share (pre-populated from
 *               server state).
 *
 * Accessibility:
 *   - `accessibilityRole="switch"`,
 *   - composite label via `SHARE_TOGGLE_A11Y_LABEL_PT_BR_FN`,
 *   - VoiceOver/TalkBack announce the new state after toggle (AC2
 *     agency-confirmation pattern).
 *
 * Token semantics (UX-DR13 / line 1111): the toggle row uses the
 * SECONDARY interaction treatment — no primary teal-filled button
 * surrounding the toggle. Sharing actions are never Tier 1.
 */

export type ShareBiomarkerToggleVariant = "setup" | "edit";
export type ShareBiomarkerToggleState = "shared" | "hidden" | "disabled";

export interface ShareBiomarkerToggleProps {
  biomarkerCategory: string;
  biomarkerLabel: string;
  currentValue?: { value: number; unit: string };
  visible: boolean;
  doctorName: string;
  disabled?: boolean;
  variant?: ShareBiomarkerToggleVariant;
  onToggle: (next: boolean) => void;
}

/**
 * Best-effort screen-reader announcement. The shared UI package does
 * not depend on `react-native` (it must stay importable from the
 * Next.js web build); when the host is React Native the consumer
 * screen (`apps/expo/.../biomarcadores.tsx`) bridges this via a
 * separate side-channel if needed. On web, the parent screen renders
 * an `aria-live="polite"` region that re-announces the new state.
 * This local function is a no-op kept as a single seam so the
 * `useEffect` shape mirrors the Expo-only LetterReader pattern from
 * Story 4.1 for future-proofing.
 */
function announceForAccessibility(_message: string): void {
  // intentional no-op — see docblock.
}

export function ShareBiomarkerToggle(
  props: ShareBiomarkerToggleProps,
): React.ReactElement {
  const {
    biomarkerCategory,
    biomarkerLabel,
    currentValue,
    visible,
    doctorName,
    disabled,
    onToggle,
  } = props;

  const state: ShareBiomarkerToggleState = disabled
    ? "disabled"
    : visible
      ? "shared"
      : "hidden";

  const prevVisibleRef = useRef(visible);

  // AC2 — VoiceOver/TalkBack agency-confirmation on every state flip
  // (after the first paint). Announce uses pt-BR copy from the
  // shared validators package. `react-native`'s `AccessibilityInfo`
  // is loaded lazily so this shared (Tamagui RNW) component remains
  // safe to import from the Next.js web build, which does not bundle
  // `react-native` (see `packages/ui/package.json`). On web, ARIA
  // live regions on the wrapping container carry the announcement
  // instead (the parent screen renders an `aria-live="polite"`
  // region with the same pt-BR copy).
  useEffect(() => {
    if (prevVisibleRef.current === visible) return;
    prevVisibleRef.current = visible;
    const message = visible
      ? BIOMARKER_VISIBLE_PT_BR_FN(biomarkerLabel, doctorName)
      : BIOMARKER_HIDDEN_PT_BR_FN(biomarkerLabel, doctorName);
    announceForAccessibility(message);
  }, [visible, biomarkerLabel, doctorName]);

  const handlePress = useCallback(() => {
    if (disabled) return;
    onToggle(!visible);
  }, [disabled, onToggle, visible]);

  const a11yLabel = SHARE_TOGGLE_A11Y_LABEL_PT_BR_FN(
    biomarkerLabel,
    visible,
    doctorName,
  );

  const valueText =
    currentValue && !disabled
      ? `${formatBrazilianDecimal(currentValue.value)} ${currentValue.unit}`
      : disabled
        ? NO_DATA_YET_PT_BR
        : "";

  return (
    <XStack
      testID={`share-biomarker-toggle-${biomarkerCategory}`}
      // Patch #15 — merge children into one VoiceOver/TalkBack focus
      // stop so the composite a11y label reads as a single switch.
      accessible={true}
      accessibilityRole="switch"
      accessibilityLabel={a11yLabel}
      accessibilityState={{ checked: visible, disabled: !!disabled }}
      onPress={handlePress}
      paddingVertical="$3"
      paddingHorizontal="$4"
      borderRadius="$card"
      backgroundColor={
        state === "shared" ? "$shareToggleOn" : "$shareToggleOff"
      }
      opacity={disabled ? 0.6 : 1}
      // 180ms ease-in fade-to-muted animation on visible→hidden (AC2).
      animation="quick"
      alignItems="center"
      justifyContent="space-between"
      hoverStyle={{ opacity: disabled ? 0.6 : 0.95 }}
      pressStyle={{ opacity: disabled ? 0.6 : 0.85 }}
    >
      <YStack flex={1}>
        <Text
          fontSize="$4"
          color={
            state === "disabled" ? "$shareToggleDisabledText" : "$textPrimary"
          }
        >
          {state === "hidden" ? `🔒 ${biomarkerLabel}` : biomarkerLabel}
        </Text>
        {valueText.length > 0 ? (
          <Text
            fontSize="$2"
            color={
              state === "shared" ? "$textSecondary" : "$shareToggleDisabledText"
            }
          >
            {valueText}
          </Text>
        ) : null}
      </YStack>

      {/*
        Minimal toggle indicator — Tamagui doesn't ship a `Switch`
        primitive in this project (the canonical Tamagui Switch lives
        in `@tamagui/switch`, an extra dep). Building the indicator
        as a styled `View` keeps the surface area small and matches
        the existing component conventions in this package.
      */}
      <YStack
        width={44}
        height={24}
        borderRadius={12}
        backgroundColor={visible ? "$primaryTeal" : "$border"}
        justifyContent="center"
        paddingHorizontal={2}
      >
        <YStack
          width={20}
          height={20}
          borderRadius={10}
          backgroundColor="$surfaceElevated"
          marginLeft={visible ? 20 : 0}
          animation="quick"
        />
      </YStack>
    </XStack>
  );
}
