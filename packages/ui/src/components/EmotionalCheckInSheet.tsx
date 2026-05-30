"use client";

import { useEffect, useRef, useState } from "react";
import { Sheet, Text, YStack } from "tamagui";

import type { EmotionalCheckinState } from "@healthtracker/validators";
import {
  EMOTIONAL_CHECKIN_ACKNOWLEDGMENT_MS,
  EMOTIONAL_CHECKIN_ACKNOWLEDGMENT_PT_BR,
  EMOTIONAL_CHECKIN_SAVE_ERROR_PT_BR,
  EMOTIONAL_CHECKIN_SHEET_A11Y_LABEL_PT_BR,
  EMOTIONAL_CHECKIN_SHEET_TITLE_PT_BR,
  EMOTIONAL_CHECKIN_SKIP_PT_BR,
  EMOTIONAL_CHECKIN_STATE_LABELS_PT_BR,
  EMOTIONAL_CHECKIN_STATES,
} from "@healthtracker/validators";

import { Button } from "../button";

/**
 * Story 7.2 — `EmotionalCheckInSheet` (pre-results check-in).
 *
 * Non-dismissible bottom sheet shown on FIRST view of a `complete`
 * draw (gating lives at the screen level via `isFirstView` +
 * `hasPreEmotionalCheckIn`). Five state buttons + a Pular skip link.
 *
 * Flow:
 *   - state-tap → `onSubmit(state)` (parent owns the mutation) →
 *     acknowledgment line shows for `EMOTIONAL_CHECKIN_ACKNOWLEDGMENT_MS`
 *     → sheet closes via `onOpenChange(false)`.
 *   - "Pular" → `onSkip()` → parent closes the sheet (no
 *     acknowledgment).
 *
 * The sheet is pure presentation — the parent screen owns the mutation
 * AND the `markUploadViewed` write that fires from both branches.
 */

export interface EmotionalCheckInSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called when the user taps one of the 5 state buttons. */
  onSubmit: (state: EmotionalCheckinState) => Promise<void>;
  /** Called when the user taps Pular. */
  onSkip: () => void;
  /** True while the parent mutation is in flight. */
  isSubmitting?: boolean;
}

export function EmotionalCheckInSheet({
  open,
  onOpenChange,
  onSubmit,
  onSkip,
  isSubmitting,
}: EmotionalCheckInSheetProps) {
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [showAcknowledgment, setShowAcknowledgment] = useState(false);
  // R1-H1 — re-entry guard runs synchronously (the `isSubmitting`
  // prop is async, so two synchronous taps before the parent
  // re-renders would both pass an `if (isSubmitting)` check).
  const inFlightRef = useRef(false);
  // R1-H1 — acknowledgment timer stored in a ref so it can be
  // cleared on unmount + on a re-open.
  const ackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (ackTimerRef.current !== null) {
        clearTimeout(ackTimerRef.current);
        ackTimerRef.current = null;
      }
    };
  }, []);

  function handleOpenChange(next: boolean) {
    if (!next) {
      // Reset transient UI state on close so a defensive re-open
      // (shouldn't happen given AC1 first-view gating) starts clean.
      setSubmitError(null);
      setShowAcknowledgment(false);
      inFlightRef.current = false;
      if (ackTimerRef.current !== null) {
        clearTimeout(ackTimerRef.current);
        ackTimerRef.current = null;
      }
    }
    onOpenChange(next);
  }

  async function handleStateTap(state: EmotionalCheckinState) {
    if (inFlightRef.current || isSubmitting || showAcknowledgment) return;
    inFlightRef.current = true;
    setSubmitError(null);
    try {
      await onSubmit(state);
    } catch {
      setSubmitError(EMOTIONAL_CHECKIN_SAVE_ERROR_PT_BR);
      inFlightRef.current = false;
      return;
    }
    setShowAcknowledgment(true);
    ackTimerRef.current = setTimeout(() => {
      ackTimerRef.current = null;
      handleOpenChange(false);
    }, EMOTIONAL_CHECKIN_ACKNOWLEDGMENT_MS);
  }

  return (
    <Sheet
      modal
      open={open}
      onOpenChange={handleOpenChange}
      snapPointsMode="fit"
      dismissOnSnapToBottom={false}
      dismissOnOverlayPress={false}
      animation="medium"
    >
      <Sheet.Overlay
        animation="medium"
        enterStyle={{ opacity: 0 }}
        exitStyle={{ opacity: 0 }}
      />
      <Sheet.Frame
        padding="$4"
        gap="$3"
        backgroundColor="$surfaceElevated"
        accessibilityLabel={EMOTIONAL_CHECKIN_SHEET_A11Y_LABEL_PT_BR}
      >
        <Text
          fontFamily="$body"
          fontSize="$6"
          fontWeight="700"
          color="$textPrimary"
        >
          {EMOTIONAL_CHECKIN_SHEET_TITLE_PT_BR}
        </Text>

        {showAcknowledgment ? (
          <Text
            fontFamily="$body"
            fontSize="$4"
            color="$textPrimary"
            accessibilityLiveRegion="polite"
          >
            {EMOTIONAL_CHECKIN_ACKNOWLEDGMENT_PT_BR}
          </Text>
        ) : (
          <YStack gap="$2">
            {EMOTIONAL_CHECKIN_STATES.map((state) => (
              <Button
                key={state}
                variant="outline"
                onPress={() => {
                  void handleStateTap(state);
                }}
                disabled={isSubmitting}
                accessibilityRole="button"
                accessibilityLabel={EMOTIONAL_CHECKIN_STATE_LABELS_PT_BR[state]}
              >
                {EMOTIONAL_CHECKIN_STATE_LABELS_PT_BR[state]}
              </Button>
            ))}

            {submitError ? (
              <Text
                fontFamily="$body"
                fontSize="$2"
                color="$textSecondary"
                accessibilityLiveRegion="polite"
              >
                {submitError}
              </Text>
            ) : null}

            <Button
              variant="ghost"
              onPress={onSkip}
              disabled={isSubmitting}
              accessibilityRole="button"
            >
              {EMOTIONAL_CHECKIN_SKIP_PT_BR}
            </Button>
          </YStack>
        )}
      </Sheet.Frame>
    </Sheet>
  );
}
