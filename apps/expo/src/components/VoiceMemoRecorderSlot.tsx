import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AudioModule,
  RecordingPresets,
  useAudioRecorder,
  useAudioRecorderState,
} from "expo-audio";
import * as FileSystem from "expo-file-system";
import { Text, View, YStack } from "tamagui";

import { Button } from "@healthtracker/ui";
import {
  VOICE_MEMO_LIMIT_REACHED_PT_BR,
  VOICE_MEMO_MAX_DURATION_MS,
  VOICE_MEMO_PERMISSION_DENIED_PT_BR,
  VOICE_MEMO_RECORD_PT_BR,
  VOICE_MEMO_STOP_PT_BR,
} from "@healthtracker/validators";

/**
 * Story 7.4 — Expo-side recorder slot for `VoiceMemoRecorder` shell.
 *
 * Implements:
 * - Microphone permission request on first Record tap.
 * - 30-second cap with auto-stop and pt-BR limit message (AC3).
 * - Cleanup of the local file URI on skip (`FileSystem.deleteAsync`).
 * - Emits `(uri, durationMs)` to the parent shell via
 *   `onRecordingComplete` so the Save button enables.
 *
 * The `expo-audio` API is mobile-only and would break Next.js
 * bundling if imported from `packages/ui` — this slot lives in
 * `apps/expo/` and is passed via `renderRecorder` prop.
 */

export interface VoiceMemoRecorderSlotProps {
  onRecordingComplete: (uri: string | null, durationMs: number) => void;
  /** Re-render trigger from parent for cleanup-on-close. */
  resetSignal?: number;
}

export function VoiceMemoRecorderSlot({
  onRecordingComplete,
  resetSignal,
}: VoiceMemoRecorderSlotProps) {
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const recorderState = useAudioRecorderState(recorder);

  const [permissionDenied, setPermissionDenied] = useState(false);
  const [limitReached, setLimitReached] = useState(false);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [savedUri, setSavedUri] = useState<string | null>(null);

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startedAtRef = useRef<number>(0);
  // R1-C2 / R1-H3 — `isRecordingRef` is the authoritative "are we
  // recording" signal during async stop paths. `recorderState` is
  // React state captured at render time; in stale-closure paths
  // (the interval callback + unmount cleanup), reading
  // `recorderState.isRecording` returns the snapshot at the closure's
  // creation time, not "now". The ref reflects the latest fact.
  const isRecordingRef = useRef(false);
  // Single-shot guard so the 30s auto-stop interval can't run
  // `stopAndFinalize` twice if a tick fires while a prior stop is
  // still resolving.
  const finalizingRef = useRef(false);

  const clearTimer = useCallback(() => {
    if (intervalRef.current !== null) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  const stopAndFinalize = useCallback(async () => {
    if (finalizingRef.current) return;
    finalizingRef.current = true;
    clearTimer();
    if (!isRecordingRef.current) {
      finalizingRef.current = false;
      return;
    }
    isRecordingRef.current = false;
    try {
      await recorder.stop();
    } catch {
      // expo-audio's stop() can throw if the recorder was already
      // stopped (e.g. unmount race). Swallow and continue to surface
      // whatever URI was captured.
    }
    // `recorder.uri` is populated after stop().
    const uri = recorder.uri ?? null;
    const durationMs = Math.min(
      Date.now() - startedAtRef.current,
      VOICE_MEMO_MAX_DURATION_MS,
    );
    setSavedUri(uri);
    setElapsedMs(durationMs);
    onRecordingComplete(uri, durationMs);
    finalizingRef.current = false;
  }, [clearTimer, recorder, onRecordingComplete]);

  // Cleanup on unmount: clear interval + stop recorder if still
  // active. Reads the ref so we don't rely on the stale-closure of
  // `recorderState.isRecording` captured at first mount.
  useEffect(() => {
    return () => {
      clearTimer();
      if (isRecordingRef.current) {
        isRecordingRef.current = false;
        void recorder.stop();
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Cleanup the saved file when the parent flips `resetSignal` (sheet
  // closed without save). Idempotent delete avoids surfacing
  // ENOENT on a re-skip.
  useEffect(() => {
    if (resetSignal === undefined) return;
    const uri = savedUri;
    if (uri !== null) {
      void FileSystem.deleteAsync(uri, { idempotent: true });
    }
    setSavedUri(null);
    setElapsedMs(0);
    setLimitReached(false);
    onRecordingComplete(null, 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetSignal]);

  async function handleStart() {
    setLimitReached(false);
    setSavedUri(null);
    setElapsedMs(0);
    onRecordingComplete(null, 0);

    // expo-audio's runtime API for permissions: cast through unknown
    // because the published types are inconsistent across SDK builds.
    const statusRaw: unknown =
      await AudioModule.requestRecordingPermissionsAsync();
    const status = statusRaw as { granted: boolean };
    if (!status.granted) {
      setPermissionDenied(true);
      return;
    }
    setPermissionDenied(false);

    await recorder.prepareToRecordAsync();
    recorder.record();
    isRecordingRef.current = true;
    startedAtRef.current = Date.now();
    intervalRef.current = setInterval(() => {
      const elapsed = Date.now() - startedAtRef.current;
      if (elapsed >= VOICE_MEMO_MAX_DURATION_MS) {
        // R1-C2 — clear the interval BEFORE calling stopAndFinalize
        // so a second tick can't fire a parallel stop() before the
        // first await resolves.
        clearTimer();
        setElapsedMs(VOICE_MEMO_MAX_DURATION_MS);
        setLimitReached(true);
        void stopAndFinalize();
        return;
      }
      setElapsedMs(elapsed);
    }, 100);
  }

  async function handleStop() {
    await stopAndFinalize();
  }

  const timerLabel = useMemo(() => {
    const totalSeconds = Math.floor(elapsedMs / 1000);
    const mm = String(Math.floor(totalSeconds / 60)).padStart(2, "0");
    const ss = String(totalSeconds % 60).padStart(2, "0");
    return `${mm}:${ss}`;
  }, [elapsedMs]);

  return (
    <YStack gap="$3" alignItems="center">
      <Text
        fontFamily="$body"
        fontSize="$8"
        fontWeight="700"
        color="$textPrimary"
        accessibilityLiveRegion="polite"
      >
        {timerLabel}
      </Text>

      {permissionDenied ? (
        <Text fontFamily="$body" fontSize="$3" color="$textSecondary">
          {VOICE_MEMO_PERMISSION_DENIED_PT_BR}
        </Text>
      ) : null}

      {limitReached ? (
        <Text
          fontFamily="$body"
          fontSize="$3"
          color="$textSecondary"
          accessibilityLiveRegion="polite"
        >
          {VOICE_MEMO_LIMIT_REACHED_PT_BR}
        </Text>
      ) : null}

      <View>
        {recorderState.isRecording ? (
          <Button onPress={() => void handleStop()} accessibilityRole="button">
            {VOICE_MEMO_STOP_PT_BR}
          </Button>
        ) : (
          <Button
            onPress={() => void handleStart()}
            disabled={limitReached && savedUri !== null}
            accessibilityRole="button"
          >
            {VOICE_MEMO_RECORD_PT_BR}
          </Button>
        )}
      </View>
    </YStack>
  );
}
