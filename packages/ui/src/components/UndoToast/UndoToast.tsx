"use client";

import { useEffect, useRef, useState } from "react";
import { Text, XStack, YStack } from "tamagui";

import { Button } from "../../button";

/**
 * Story 5.4 T2.1 — bottom-anchored undo toast for the 5-second
 * deferred-server-write revoke window (AC3, AC7).
 *
 * Architecture: this component owns the visual countdown indicator
 * (a simple linear progress bar driven by a 50ms `setInterval`)
 * and the auto-dismiss timer; the parent Acessos screen owns the
 * pending-mutation timer keyed by `shareTokenId`. When the parent
 * flips `visible: false` (either because the user tapped "Desfazer"
 * or because the 5s expired), both timers are cleared via the
 * cleanup function of `useEffect`.
 *
 * Backdrop is intentionally NOT clickable — the patient must
 * either explicitly tap "Desfazer" or wait for auto-dismiss
 * (spec, AC7).
 *
 * Why custom (not `@tamagui/toast`): the toast package is not a
 * workspace dep (see `packages/ui/package.json`). A 50ms interval
 * is the simplest cross-platform implementation that survives
 * RNW; the parent's `setTimeout(handler, REVOKE_TIMEOUT_MS)` is
 * the source of truth for the server-write deadline — this
 * component's `onTimeout` callback is just visual sugar.
 *
 * Multi-revoke (AC8): when the parent flips a different
 * `shareTokenId` into the toast surface while a previous toast is
 * still visible, the parent calls `setActiveToast({...})` —
 * remounting this component with new `message`/`shareTokenId`
 * resets the internal timer for the new toast. The PREVIOUS
 * timer continues to run silently in the parent's `timers` ref;
 * the user has lost the undo opportunity for the earlier revoke
 * (spec: most-recent toast wins; documented in dev notes).
 */

export interface UndoToastProps {
  visible: boolean;
  /**
   * Stable identity for the toast surface — when this changes, the
   * internal timer/progress restarts. Use the `shareTokenId` of the
   * pending revoke as the key on the consuming side too.
   */
  toastId: string;
  message: string;
  undoLabel: string;
  onUndo: () => void;
  onTimeout: () => void;
  durationMs?: number;
}

const TICK_MS = 50;

export function UndoToast(props: UndoToastProps): React.ReactElement | null {
  const {
    visible,
    toastId,
    message,
    undoLabel,
    onUndo,
    onTimeout,
    durationMs = 5000,
  } = props;

  // `remaining` is for the progress bar only; the auto-dismiss
  // fire is owned by a single `setTimeout` (not by the interval),
  // so dropped ticks under background pressure can't extend the
  // window past `durationMs`. The initial value matches durationMs
  // so the bar starts full — avoiding a `setRemaining(durationMs)`
  // inside the effect (react-hooks/set-state-in-effect).
  const [remaining, setRemaining] = useState<number>(durationMs);
  // R1 anti-pattern guard — stable ref to `onTimeout` so the effect
  // doesn't tear down + rebuild on every parent re-render (each
  // teardown would clear the interval mid-window). The ref must be
  // updated inside an effect (react-hooks/refs forbids ref writes
  // during render).
  const onTimeoutRef = useRef(onTimeout);
  useEffect(() => {
    onTimeoutRef.current = onTimeout;
  }, [onTimeout]);

  useEffect(() => {
    if (!visible) return;
    const start = Date.now();
    // First tick is asynchronous, so the initial render shows the
    // full bar — no setState during effect required.
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
    // `toastId` is in the dep list so a new pending revoke restarts
    // the timer when the parent swaps the surface.
  }, [visible, toastId, durationMs]);

  if (!visible) return null;

  const progressPct = Math.max(
    0,
    Math.min(100, (remaining / durationMs) * 100),
  );

  return (
    <YStack
      accessibilityRole="alert"
      testID={`undo-toast-${toastId}`}
      position="absolute"
      bottom="$4"
      left="$3"
      right="$3"
      padding="$3"
      gap="$2"
      borderRadius="$card"
      backgroundColor="$surfaceElevated"
      borderWidth={1}
      borderColor="$borderSubtle"
    >
      <XStack justifyContent="space-between" alignItems="center" gap="$3">
        <Text fontSize="$3" color="$textPrimary" flex={1}>
          {message}
        </Text>
        <Button variant="secondary" onPress={onUndo}>
          {undoLabel}
        </Button>
      </XStack>
      {/*
        Linear progress bar (5→0 over 5s). A circular ring would
        require a Reanimated dep; the linear treatment satisfies
        the "visual countdown" requirement at minimum cost.
      */}
      <XStack
        height={3}
        borderRadius="$chip"
        backgroundColor="$backgroundSurface"
        overflow="hidden"
      >
        <XStack
          height="100%"
          width={`${progressPct}%`}
          backgroundColor="$accessLogNeutral"
        />
      </XStack>
    </YStack>
  );
}
