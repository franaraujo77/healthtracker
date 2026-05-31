"use client";

import { useEffect, useRef, useState } from "react";
import { Sheet, Text, YStack } from "tamagui";

import type { EmotionalCheckinState } from "@healthtracker/validators";
import {
  EMOTIONAL_CHECKIN_ACKNOWLEDGMENT_MS,
  EMOTIONAL_CHECKIN_ACKNOWLEDGMENT_PT_BR,
  EMOTIONAL_CHECKIN_POST_SHEET_TITLE_PT_BR,
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
  /**
   * Story 7.3 — selects the title copy. `'pre'` (default) shows the
   * pre-results question; `'post'` shows the post-results question.
   * Everything else (5 state buttons, Pular, acknowledgment, R1-H1
   * guards, non-dismissibility) is unchanged across modes.
   */
  mode?: "pre" | "post";
}

export function EmotionalCheckInSheet({
  open,
  onOpenChange,
  onSubmit,
  onSkip,
  isSubmitting,
  mode = "pre",
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

  // R1-M1 (Story 7.3) — invariant: callers MUST render a fresh
  // instance per `mode` (the Story 7.3 upload detail screen does this
  // via two separate `<EmotionalCheckInSheet>` siblings). Toggling
  // `mode` on a single mounted instance is not supported because it
  // would leak the prior mode's acknowledgment / error UI state. If
  // a future consumer needs single-instance toggling, the React
  // idiom is `key={mode}` on the parent to force remount.

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
      // R1-M2 (Story 7.3) — non-dismissibility is load-bearing for
      // the PRE sheet (AC1 first-view gate); for the POST sheet
      // (voluntary CTA entry), the patient must be able to back out
      // without making a selection.
      dismissOnSnapToBottom={mode === "post"}
      dismissOnOverlayPress={mode === "post"}
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
          {mode === "post"
            ? EMOTIONAL_CHECKIN_POST_SHEET_TITLE_PT_BR
            : EMOTIONAL_CHECKIN_SHEET_TITLE_PT_BR}
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
