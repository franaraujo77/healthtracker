"use client";

import { useEffect, useRef, useState } from "react";
import { Text, XStack, YStack } from "tamagui";

import {
  DELETE_ACCOUNT_CANCEL_A11Y_PT_BR,
  DELETE_ACCOUNT_CANCEL_BUTTON_PT_BR,
  DELETE_ACCOUNT_CONFIRM_WORD,
  DELETE_ACCOUNT_CONTINUE_BUTTON_PT_BR,
  DELETE_ACCOUNT_COUNTDOWN_MS,
  DELETE_ACCOUNT_COUNTDOWN_PT_BR_FN,
  DELETE_ACCOUNT_HEADER_PT_BR,
  DELETE_ACCOUNT_INPUT_PLACEHOLDER_PT_BR,
  DELETE_ACCOUNT_IRREVERSIBLE_PT_BR,
  DELETE_ACCOUNT_SUMMARY_LINES_PT_BR,
} from "@healthtracker/validators";

import { Button } from "../../button";
import { Input } from "../../input";

/**
 * Story 5.6 T6.1 — three-state confirmation card for the Excluir
 * conta ceremony (AC1). State machine lives in the component; the
 * parent screen passes only the start/cancel callbacks.
 *
 * States:
 *   - `input` — header + summary + EXCLUIR text field + Continuar
 *     (Tier-2 secondary outline, muted neutral — UX-DR13; NEVER red).
 *   - `cooldown` — 30s visible countdown with linear progress bar
 *     + Cancelar (Tier-2; primary affordance). Mirrors Story 5.4
 *     `UndoToast` dual-timer pattern: setInterval(50ms) drives the
 *     bar; a separate setTimeout(DELETE_ACCOUNT_COUNTDOWN_MS) fires
 *     `onTimeout` (the deletion mutation). Cleared on Cancelar + on
 *     unmount.
 *
 * The "failed" state is owned by the parent (toast / inline error +
 * reset to `input` via the `key` prop / forced remount).
 *
 * Backdrop tap is NOT a dismiss (spec — patient must explicitly
 * Cancelar or wait the full 30s). Single-use per ceremony — the
 * parent should remount via `key` change rather than cache state
 * across re-mounts.
 */

const TICK_MS = 50;

export interface DeleteAccountConfirmationCardProps {
  /** Fired when the 30s cooldown expires. The parent runs the mutation. */
  onTimeout: () => void;
  /** Fired when the patient taps Cancelar during cooldown. */
  onCancel?: () => void;
  /** Override the cooldown duration (default: 30s). For tests only. */
  durationMs?: number;
}

type CardState = "input" | "cooldown";

export function DeleteAccountConfirmationCard(
  props: DeleteAccountConfirmationCardProps,
): React.ReactElement {
  const {
    onTimeout,
    onCancel,
    durationMs = DELETE_ACCOUNT_COUNTDOWN_MS,
  } = props;

  const [state, setState] = useState<CardState>("input");
  const [confirmText, setConfirmText] = useState("");
  const [remaining, setRemaining] = useState<number>(durationMs);

  // Stable ref to onTimeout so the cooldown effect doesn't tear down
  // and rebuild on every parent re-render (mirror of Story 5.4
  // UndoToast Patch — each rebuild would clear the timers mid-window).
  const onTimeoutRef = useRef(onTimeout);
  useEffect(() => {
    onTimeoutRef.current = onTimeout;
  }, [onTimeout]);

  // Cooldown effect — runs only in the cooldown state.
  useEffect(() => {
    if (state !== "cooldown") return;
    const start = Date.now();
    const interval = setInterval(() => {
      const left = Math.max(0, durationMs - (Date.now() - start));
      setRemaining(left);
    }, TICK_MS);
    const timeout = setTimeout(() => {
      onTimeoutRef.current();
    }, durationMs);
    return () => {
      clearInterval(interval);
      clearTimeout(timeout);
    };
  }, [state, durationMs]);

  const confirmEnabled =
    confirmText.trim().toUpperCase() === DELETE_ACCOUNT_CONFIRM_WORD;

  const handleContinue = (): void => {
    if (!confirmEnabled) return;
    setRemaining(durationMs);
    setState("cooldown");
  };

  const handleCancel = (): void => {
    setState("input");
    setConfirmText("");
    setRemaining(durationMs);
    onCancel?.();
  };

  if (state === "input") {
    return (
      <YStack
        testID="delete-account-card-input"
        padding="$4"
        gap="$3"
        borderRadius="$card"
        backgroundColor="$surfaceElevated"
        borderWidth={1}
        borderColor="$borderSubtle"
      >
        <Text fontSize="$6" color="$textPrimary">
          {DELETE_ACCOUNT_HEADER_PT_BR}
        </Text>
        <Text fontSize="$3" color="$textSecondary">
          {DELETE_ACCOUNT_IRREVERSIBLE_PT_BR}
        </Text>
        <YStack gap="$1" paddingVertical="$2">
          {DELETE_ACCOUNT_SUMMARY_LINES_PT_BR.map((line) => (
            <Text key={line} fontSize="$3" color="$textPrimary">
              • {line}
            </Text>
          ))}
        </YStack>
        <Input
          testID="delete-account-confirm-input"
          placeholder={DELETE_ACCOUNT_INPUT_PLACEHOLDER_PT_BR}
          value={confirmText}
          onChangeText={setConfirmText}
          autoCapitalize="characters"
          autoCorrect={false}
        />
        <XStack justifyContent="flex-end">
          <Button
            testID="delete-account-continue-button"
            variant="secondary"
            disabled={!confirmEnabled}
            onPress={handleContinue}
          >
            {DELETE_ACCOUNT_CONTINUE_BUTTON_PT_BR}
          </Button>
        </XStack>
      </YStack>
    );
  }

  // Cooldown state.
  const secondsRemaining = Math.ceil(remaining / 1000);
  const progressPct =
    durationMs <= 0
      ? 0
      : Math.max(0, Math.min(100, (remaining / durationMs) * 100));

  return (
    <YStack
      testID="delete-account-card-cooldown"
      padding="$4"
      gap="$3"
      borderRadius="$card"
      backgroundColor="$surfaceElevated"
      borderWidth={1}
      borderColor="$borderSubtle"
      accessibilityRole="alert"
    >
      <Text fontSize="$6" color="$textPrimary">
        {DELETE_ACCOUNT_HEADER_PT_BR}
      </Text>
      <Text
        fontSize="$3"
        color="$textPrimary"
        // a11y: announce the countdown periodically. Story 5.4 R1
        // pattern — `polite` so the live region doesn't preempt
        // user focus.
        accessibilityLiveRegion="polite"
      >
        {DELETE_ACCOUNT_COUNTDOWN_PT_BR_FN(secondsRemaining)}
      </Text>
      {/* Linear progress bar — drains over the 30s window. */}
      <XStack
        height={3}
        borderRadius="$chip"
        backgroundColor="$backgroundSurface"
        overflow="hidden"
      >
        <XStack
          height="100%"
          width={`${progressPct}%`}
          backgroundColor="$accessLogRevoked"
        />
      </XStack>
      <XStack justifyContent="flex-end">
        <Button
          testID="delete-account-cancel-button"
          variant="secondary"
          onPress={handleCancel}
          accessibilityLabel={DELETE_ACCOUNT_CANCEL_A11Y_PT_BR}
        >
          {DELETE_ACCOUNT_CANCEL_BUTTON_PT_BR}
        </Button>
      </XStack>
    </YStack>
  );
}
