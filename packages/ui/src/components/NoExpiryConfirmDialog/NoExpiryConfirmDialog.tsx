"use client";

import { Dialog, Text, XStack, YStack } from "tamagui";

import {
  NO_EXPIRY_CONFIRM_BODY_PT_BR,
  NO_EXPIRY_CONFIRM_BUTTON_PT_BR,
  NO_EXPIRY_CONFIRM_CANCEL_PT_BR,
} from "@healthtracker/validators";

import { Button } from "../../button";

/**
 * Story 5.2 T6.2 — extra-confirmation modal shown when the patient
 * picks "Sem prazo" and taps Continuar (AC2).
 *
 * Buttons: "Confirmar" is Tier 2 (secondary outlined teal), "Voltar"
 * is Tier 3 (text-only). Dismissing via backdrop tap or the cancel
 * button is equivalent to "do not proceed".
 */

export interface NoExpiryConfirmDialogProps {
  open: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function NoExpiryConfirmDialog(
  props: NoExpiryConfirmDialogProps,
): React.ReactElement {
  const { open, onConfirm, onCancel } = props;
  return (
    <Dialog
      modal
      open={open}
      onOpenChange={(next) => {
        if (!next) onCancel();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay
          key="overlay"
          animation="quick"
          opacity={0.5}
          enterStyle={{ opacity: 0 }}
          exitStyle={{ opacity: 0 }}
          onPress={onCancel}
        />
        <Dialog.Content
          key="content"
          bordered
          elevate
          animation="quick"
          enterStyle={{ opacity: 0, y: 8 }}
          exitStyle={{ opacity: 0, y: 8 }}
          padding="$5"
          gap="$4"
          maxWidth={480}
          width="90%"
        >
          <YStack gap="$3">
            <Text fontSize="$4" color="$textPrimary">
              {NO_EXPIRY_CONFIRM_BODY_PT_BR}
            </Text>
            <XStack gap="$2" justifyContent="flex-end">
              <Button variant="ghost" onPress={onCancel}>
                {NO_EXPIRY_CONFIRM_CANCEL_PT_BR}
              </Button>
              <Button variant="secondary" onPress={onConfirm}>
                {NO_EXPIRY_CONFIRM_BUTTON_PT_BR}
              </Button>
            </XStack>
          </YStack>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog>
  );
}
