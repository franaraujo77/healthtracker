"use client";

import { Sheet, Text, YStack } from "tamagui";

import {
  UPLOAD_SHEET_CANCEL_PT_BR,
  UPLOAD_SHEET_PDF_LABEL_PT_BR,
  UPLOAD_SHEET_PHOTO_DISABLED_LABEL_PT_BR,
  UPLOAD_SHEET_PHOTO_LABEL_PT_BR,
  UPLOAD_SHEET_TITLE_PT_BR,
} from "@healthtracker/validators";

import { Button } from "./button";

/**
 * Story 2.1 AC1 — post-onboarding upload source picker.
 *
 * Two rows: "Arquivo PDF" (active) and "Foto ou câmera" (disabled with
 * "Em breve" label — Story 2.2 wires the photo branch). Cancel returns
 * the patient to Início untouched.
 *
 * Implemented as a Tamagui `Sheet` which renders as a bottom sheet on
 * Expo and as a modal on Web (Tamagui handles the platform mapping).
 */

export interface UploadSourceSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPickPdf: () => void;
  pdfDisabled?: boolean;
}

export function UploadSourceSheet({
  open,
  onOpenChange,
  onPickPdf,
  pdfDisabled,
}: UploadSourceSheetProps) {
  return (
    <Sheet
      modal
      open={open}
      onOpenChange={onOpenChange}
      snapPointsMode="fit"
      dismissOnSnapToBottom
      animation="medium"
    >
      <Sheet.Overlay
        animation="medium"
        enterStyle={{ opacity: 0 }}
        exitStyle={{ opacity: 0 }}
      />
      <Sheet.Handle />
      <Sheet.Frame
        padding="$4"
        gap="$3"
        backgroundColor="$surfaceElevated"
        accessibilityRole="menu"
      >
        <Text
          fontFamily="$body"
          fontSize="$6"
          fontWeight="700"
          color="$textPrimary"
        >
          {UPLOAD_SHEET_TITLE_PT_BR}
        </Text>
        <YStack gap="$2">
          <Button
            onPress={onPickPdf}
            disabled={pdfDisabled}
            accessibilityRole="button"
          >
            {UPLOAD_SHEET_PDF_LABEL_PT_BR}
          </Button>
          {/*
            Story 2.1 P57 — render the "Foto" row as a real disabled
            Button (not an XStack pretending to be one). The previous
            version had `accessibilityRole="button"` + `disabled` state
            but no `onPress`, so screen-reader users could land on it
            and tap with nothing happening. A real `<Button disabled>`
            is visually + behaviourally inert and Tamagui exposes the
            correct disabled semantics to the platform a11y layer.
          */}
          <Button
            variant="outline"
            disabled
            accessibilityHint={UPLOAD_SHEET_PHOTO_DISABLED_LABEL_PT_BR}
          >
            {`${UPLOAD_SHEET_PHOTO_LABEL_PT_BR} (${UPLOAD_SHEET_PHOTO_DISABLED_LABEL_PT_BR})`}
          </Button>
          <Button variant="ghost" onPress={() => onOpenChange(false)}>
            {UPLOAD_SHEET_CANCEL_PT_BR}
          </Button>
        </YStack>
      </Sheet.Frame>
    </Sheet>
  );
}
