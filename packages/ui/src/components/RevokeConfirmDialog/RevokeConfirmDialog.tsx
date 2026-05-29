"use client";

import { Dialog, Text, XStack, YStack } from "tamagui";

import {
  REVOKE_CONFIRM_BODY_PT_BR_FN,
  REVOKE_CONFIRM_BUTTON_PT_BR,
  REVOKE_CONFIRM_CANCEL_PT_BR,
} from "@healthtracker/validators";

import { Button } from "../../button";

/**
 * Story 5.4 T3.1 — Tier-2 confirmation dialog for the revoke
 * ceremony (AC1, AC2). Mirrors `NoExpiryConfirmDialog` (Story 5.2)
 * in structure.
 *
 * Buttons: "Revogar" is Tier 2 (secondary outlined) with the muted
 * `$accessLogRevoked` neutral treatment — NEVER red per UX line
 * 1079. "Cancelar" is Tier 3 (text-only ghost). Dismissing via
 * backdrop tap is equivalent to cancel.
 */

export interface RevokeConfirmDialogProps {
  open: boolean;
  displayName: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export function RevokeConfirmDialog(
  props: RevokeConfirmDialogProps,
): React.ReactElement {
  const { open, displayName, onConfirm, onCancel } = props;
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
              {REVOKE_CONFIRM_BODY_PT_BR_FN(displayName)}
            </Text>
            <XStack gap="$2" justifyContent="flex-end">
              <Button variant="ghost" onPress={onCancel}>
                {REVOKE_CONFIRM_CANCEL_PT_BR}
              </Button>
              <Button variant="secondary" onPress={onConfirm}>
                {REVOKE_CONFIRM_BUTTON_PT_BR}
              </Button>
            </XStack>
          </YStack>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog>
  );
}
