"use client";

import { useEffect, useState } from "react";
import { Circle, Text, View, YStack } from "tamagui";

import {
  EXTRACTION_PULSE_COMPLETE_PT_BR,
  EXTRACTION_PULSE_MANUAL_ENTRY_CTA_PT_BR,
  EXTRACTION_PULSE_REVIEW_NEEDED_PT_BR,
  extractionPulseCopyForElapsedMs,
  extractionPulseShouldShowManualEntry,
  UPLOAD_IMAGE_OCR_FAILED_PT_BR,
  UPLOAD_RECOVERY_MANUAL_PT_BR,
  UPLOAD_RECOVERY_RETAKE_PT_BR,
  UPLOAD_RECOVERY_UPLOAD_PDF_PT_BR,
} from "@healthtracker/validators";

import { Button } from "./button";

/**
 * Story 2.1 — `ExtractionPulse` ambient extraction UI (UX-DR4).
 *
 * The component is intentionally minimal: a centered teal circle that
 * pulses (opacity oscillation on a ~3 s cycle, driven by state +
 * `setInterval` so the same code paths work on Expo and Web without
 * pulling in `@tamagui/animations-react-native`), a per-upload filename
 * list, and the patience-pattern micro-copy line keyed off `elapsedMs`.
 *
 * Reduced-motion: the caller passes `reducedMotion={true}` (e.g., from
 * `AccessibilityInfo.isReduceMotionEnabled()` on Expo or
 * `matchMedia('(prefers-reduced-motion: reduce)')` on Web). When true,
 * the circle is static at full opacity.
 *
 * A11y: the wrapping View is `accessibilityRole="status"` +
 * `accessibilityLiveRegion="polite"`, so screen readers announce the
 * patience copy as it advances.
 */

export type ExtractionPulseState =
  | "processing"
  | "review-needed"
  | "complete"
  // Story 2.2 AC4 — image OCR confidence < 0.01 surfaces a dedicated
  // failure state with three recovery options (retake / PDF /
  // manual). The worker-side `applyDeadLetter` call lands in Story
  // 2.3; Story 2.2 ships the UI ahead of the trigger so Story 2.3 has
  // no UI work to do.
  | "failed";

export interface ExtractionPulseProps {
  state: ExtractionPulseState;
  /** Filenames currently being processed; rendered as a small list. */
  filenames: string[];
  /**
   * Milliseconds elapsed since this batch started (set by the caller
   * from `Date.now() - startedAt`). Drives the patience-pattern copy.
   * Only meaningful for `state === 'processing'`.
   */
  elapsedMs: number;
  /**
   * Optional callback for the 30s+ "Inserir manualmente" escape hatch
   * (processing state) AND the `failed` state's third recovery
   * option. When undefined, the button is not rendered. Story 2.7
   * (manual BIA entry) wires the destination.
   */
  onManualEntry?: () => void;
  /**
   * Story 2.2 — `failed`-state recovery: re-opens the camera picker.
   * When undefined, the button is not rendered.
   */
  onRetake?: () => void;
  /**
   * Story 2.2 — `failed`-state recovery: re-opens the sheet in PDF
   * mode. When undefined, the button is not rendered.
   */
  onUploadPdf?: () => void;
  /**
   * When true, suppresses the pulse animation. Caller-supplied so each
   * platform owns its own reduced-motion detection.
   */
  reducedMotion?: boolean;
}

const PULSE_PERIOD_MS = 3000;

function usePulseOpacity(active: boolean): number {
  // The circle alternates between two opacity values on a 3 s cycle.
  // Two `setInterval` ticks per cycle (1.5 s each) is the simplest
  // correct shape; finer steps don't read as different to the eye at
  // ambient pulse pacing.
  const [bright, setBright] = useState(true);
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setBright((b) => !b), PULSE_PERIOD_MS / 2);
    return () => clearInterval(id);
  }, [active]);
  if (!active) return 1;
  return bright ? 1 : 0.4;
}

function pulseCopyForState(
  state: ExtractionPulseState,
  elapsedMs: number,
): string {
  if (state === "review-needed") return EXTRACTION_PULSE_REVIEW_NEEDED_PT_BR;
  if (state === "complete") return EXTRACTION_PULSE_COMPLETE_PT_BR;
  if (state === "failed") return UPLOAD_IMAGE_OCR_FAILED_PT_BR;
  return extractionPulseCopyForElapsedMs(elapsedMs);
}

export function ExtractionPulse({
  state,
  filenames,
  elapsedMs,
  onManualEntry,
  onRetake,
  onUploadPdf,
  reducedMotion,
}: ExtractionPulseProps) {
  const animating = state === "processing" && !reducedMotion;
  const opacity = usePulseOpacity(animating);
  const copy = pulseCopyForState(state, elapsedMs);
  const showManualEntry =
    state === "processing" &&
    extractionPulseShouldShowManualEntry(elapsedMs) &&
    onManualEntry !== undefined;

  return (
    <View
      // Story 2.1 P56 — drop `accessibilityRole="alert"` (assertive).
      // React Native's `AccessibilityRole` union doesn't include
      // "status", so cross-platform polite-live semantics come from
      // `accessibilityLiveRegion="polite"` (Android RN) and
      // `aria-live="polite"` / `role="status"` (web). No
      // `accessibilityRole` is the right answer for a passive
      // status surface — iOS VoiceOver picks up the live-region
      // announcement without an explicit role.
      role="status"
      accessibilityLiveRegion="polite"
      aria-live="polite"
    >
      <YStack alignItems="center" gap="$3" paddingVertical="$4">
        <Circle
          size={64}
          // Story 2.1 P64 — keep the teal fill in every state; signal
          // `review-needed` with an amber border (Task 4 line 75:
          // "static teal circle, amber ring"). Story 2.2 — `failed`
          // state uses an amber background (calm-not-red per UX spec)
          // because the failure is the message, not an alarm.
          backgroundColor={
            state === "failed" ? "$biomarkerDeviation" : "$primaryTeal"
          }
          borderWidth={state === "review-needed" ? 3 : 0}
          borderColor="$biomarkerDeviation"
          opacity={opacity}
          aria-hidden
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        />
        {filenames.length > 0 ? (
          <YStack gap="$1" alignItems="center">
            {filenames.map((name, idx) => (
              <Text
                // Story 2.1 P58 — append idx so two files with the
                // same name don't trigger React's duplicate-key
                // warning (legal scenario: same lab report picked
                // twice in one batch).
                key={`${name}-${idx}`}
                fontFamily="$body"
                fontSize="$3"
                color="$textSecondary"
              >
                {name}
              </Text>
            ))}
          </YStack>
        ) : null}
        <Text
          fontFamily="$body"
          fontSize="$4"
          color="$textPrimary"
          textAlign="center"
        >
          {copy}
        </Text>
        {showManualEntry ? (
          <Button variant="outline" onPress={onManualEntry}>
            {EXTRACTION_PULSE_MANUAL_ENTRY_CTA_PT_BR}
          </Button>
        ) : null}
        {state === "failed" ? (
          <YStack gap="$2" width="100%">
            {onRetake ? (
              <Button onPress={onRetake}>{UPLOAD_RECOVERY_RETAKE_PT_BR}</Button>
            ) : null}
            {onUploadPdf ? (
              <Button variant="outline" onPress={onUploadPdf}>
                {UPLOAD_RECOVERY_UPLOAD_PDF_PT_BR}
              </Button>
            ) : null}
            {onManualEntry ? (
              <Button variant="ghost" onPress={onManualEntry}>
                {UPLOAD_RECOVERY_MANUAL_PT_BR}
              </Button>
            ) : null}
            {/*
              Round-1 P82 — when a caller forgets to wire any recovery
              callback, the `failed` state would otherwise render an
              empty button area below the failure copy. Surface a
              generic fallback line so the patient isn't stranded.
            */}
            {!onRetake && !onUploadPdf && !onManualEntry ? (
              <Text
                fontFamily="$body"
                fontSize="$3"
                color="$textSecondary"
                textAlign="center"
              >
                Tente novamente em alguns instantes.
              </Text>
            ) : null}
          </YStack>
        ) : null}
      </YStack>
    </View>
  );
}
