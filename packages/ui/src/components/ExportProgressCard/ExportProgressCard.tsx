"use client";

import { Button, Spinner, Text, YStack } from "tamagui";

import type { ExportStatus } from "@healthtracker/validators";
import {
  EXPORT_DOWNLOAD_BUTTON_PT_BR,
  EXPORT_FAILED_PT_BR,
  EXPORT_PROGRESS_PT_BR,
  EXPORT_READY_PT_BR,
  EXPORT_RETRY_BUTTON_PT_BR,
} from "@healthtracker/validators";

/**
 * Story 5.5 T5.2 — `ExportProgressCard`. Renders the four states of
 * an in-flight export request:
 *   - queued / generating: indeterminate spinner + "Gerando seu
 *     registro… (até 60 segundos)" copy (AC2).
 *   - ready: "Pronto" copy + Tier-2 "Baixar" button that calls
 *     `onDownload` (which the screen wires to a fresh `getExport`
 *     query + system share-sheet / browser download — AC2 + AC11).
 *   - failed: "Não foi possível gerar o registro. Tente novamente."
 *     copy + Tier-2 "Tentar novamente" button (AC2).
 *
 * Tier-2 button styling per UX-DR13 — no green-filled primary; export
 * actions stay calm.
 */
export interface ExportProgressCardProps {
  status: ExportStatus;
  onDownload?: () => void;
  onRetry?: () => void;
  /** When true (download click in flight), disable the button. */
  downloadInFlight?: boolean;
}

export function ExportProgressCard(
  props: ExportProgressCardProps,
): React.ReactElement {
  const { status, onDownload, onRetry, downloadInFlight } = props;
  return (
    <YStack
      testID="export-progress-card"
      padding="$4"
      borderRadius="$card"
      backgroundColor="$shareToggleOff"
      borderWidth={1}
      borderColor="$border"
      gap="$3"
    >
      {status === "ready" ? (
        <>
          <Text fontSize="$5" color="$textPrimary">
            {EXPORT_READY_PT_BR}
          </Text>
          <Button
            testID="export-download-button"
            onPress={onDownload}
            disabled={downloadInFlight === true}
            accessibilityLabel={EXPORT_DOWNLOAD_BUTTON_PT_BR}
          >
            {EXPORT_DOWNLOAD_BUTTON_PT_BR}
          </Button>
        </>
      ) : status === "failed" ? (
        <>
          <Text accessibilityRole="alert" fontSize="$4" color="$errorRed">
            {EXPORT_FAILED_PT_BR}
          </Text>
          <Button
            testID="export-retry-button"
            onPress={onRetry}
            accessibilityLabel={EXPORT_RETRY_BUTTON_PT_BR}
          >
            {EXPORT_RETRY_BUTTON_PT_BR}
          </Button>
        </>
      ) : (
        <>
          <Spinner size="small" />
          <Text fontSize="$4" color="$textPrimary">
            {EXPORT_PROGRESS_PT_BR}
          </Text>
        </>
      )}
    </YStack>
  );
}
