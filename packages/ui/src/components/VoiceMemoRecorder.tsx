"use client";

import type { ReactNode } from "react";
import { useCallback, useState } from "react";
import { Sheet, Text, YStack } from "tamagui";

import {
  VOICE_MEMO_PRIVACY_HINT_PT_BR,
  VOICE_MEMO_RECORDER_TITLE_PT_BR,
  VOICE_MEMO_SAVE_PT_BR,
  VOICE_MEMO_SKIP_PT_BR,
} from "@healthtracker/validators";

import { Button } from "../button";

/**
 * Story 7.4 — `VoiceMemoRecorder` (mobile bottom sheet shell).
 *
 * Tamagui-only shell. The native recording API (`expo-audio`) is
 * native-only and cannot be imported from `packages/ui` (web build).
 * The `renderRecorder` slot is the architectural seam — consumer
 * passes a render function that uses the native API; this shell
 * handles the sheet chrome (title, privacy hint, Save/Pular).
 *
 * Mirrors Story 7.5's `LifeEventSheet.renderDateField` slot pattern.
 */

export interface VoiceMemoRecorderProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /**
   * Called when Save is tapped with a recorded URI + duration. Parent
   * uploads the audio to Supabase Storage and calls the tRPC
   * `voiceMemos.attachToUpload` mutation.
   */
  onSubmit: (recording: { uri: string; durationMs: number }) => void;
  /** Called when Pular is tapped or the sheet closes without a save. */
  onSkip: () => void;
  /** True while the parent mutation is in flight. */
  isSaving?: boolean;
  /**
   * Story 7.4 / 7.5 slot pattern — consumer-owned recording UI. The
   * slot receives a stable `onRecordingComplete` callback; when the
   * user has a saved-but-not-yet-submitted recording, the slot
   * exposes it back to the shell via this callback so the Save
   * button can enable.
   */
  renderRecorder: (props: {
    onRecordingComplete: (uri: string | null, durationMs: number) => void;
  }) => ReactNode;
}

export function VoiceMemoRecorder({
  open,
  onOpenChange,
  onSubmit,
  onSkip,
  isSaving,
  renderRecorder,
}: VoiceMemoRecorderProps) {
  // The slot owns recording start/stop/timer; the shell tracks only
  // the latest "completed" payload so the Save button's enabled
  // state reflects whether a recording exists.
  const [recordingUri, setRecordingUri] = useState<string | null>(null);
  const [recordingDurationMs, setRecordingDurationMs] = useState(0);

  // Stable callback so the slot's useEffect deps don't churn.
  const handleRecordingComplete = useCallback(
    (uri: string | null, durationMs: number) => {
      setRecordingUri(uri);
      setRecordingDurationMs(durationMs);
    },
    [],
  );

  const canSave = !isSaving && recordingUri !== null && recordingDurationMs > 0;

  function handleSave() {
    // Re-derive narrowing locally because TS can't narrow
    // recordingUri across the `canSave` boolean.
    if (isSaving || recordingUri === null || recordingDurationMs <= 0) return;
    onSubmit({ uri: recordingUri, durationMs: recordingDurationMs });
  }

  function handleOpenChange(next: boolean) {
    if (!next) {
      setRecordingUri(null);
      setRecordingDurationMs(0);
    }
    onOpenChange(next);
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
        accessibilityRole="none"
      >
        <Text
          fontFamily="$body"
          fontSize="$6"
          fontWeight="700"
          color="$textPrimary"
        >
          {VOICE_MEMO_RECORDER_TITLE_PT_BR}
        </Text>

        {renderRecorder({ onRecordingComplete: handleRecordingComplete })}

        <Text fontFamily="$body" fontSize="$2" color="$textSecondary">
          {VOICE_MEMO_PRIVACY_HINT_PT_BR}
        </Text>

        <YStack gap="$2">
          <Button
            onPress={handleSave}
            disabled={!canSave}
            accessibilityRole="button"
          >
            {VOICE_MEMO_SAVE_PT_BR}
          </Button>
          <Button
            variant="ghost"
            onPress={onSkip}
            disabled={isSaving}
            accessibilityRole="button"
          >
            {VOICE_MEMO_SKIP_PT_BR}
          </Button>
        </YStack>
      </Sheet.Frame>
    </Sheet>
  );
}
