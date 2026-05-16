"use client";

import type { PopoverProps } from "tamagui";
import { Adapt, Popover, styled, XStack, YStack } from "tamagui";

const MenuItemFrame = styled(XStack, {
  name: "DropdownMenuItem",
  alignItems: "center",
  paddingHorizontal: "$3",
  paddingVertical: "$2",
  borderRadius: "$chip",
  gap: "$2",
  cursor: "pointer",

  hoverStyle: {
    backgroundColor: "$primaryTealLight",
  },

  pressStyle: {
    backgroundColor: "$primaryTealLight",
  },
});

export function DropdownMenu({
  trigger,
  children,
  placement = "bottom-end",
  ...props
}: PopoverProps & {
  trigger: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <Popover size="$5" allowFlip placement={placement} {...props}>
      <Popover.Trigger asChild>{trigger}</Popover.Trigger>

      <Adapt when="sm" platform="touch">
        <Popover.Sheet modal dismissOnSnapToBottom>
          <Popover.Sheet.Frame padding="$4">
            <Adapt.Contents />
          </Popover.Sheet.Frame>
          <Popover.Sheet.Overlay />
        </Popover.Sheet>
      </Adapt>

      <Popover.Content
        borderWidth={1}
        borderColor="$border"
        backgroundColor="$surfaceElevated"
        borderRadius="$card"
        padding="$2"
        elevate
        enterStyle={{ y: -10, opacity: 0 }}
        exitStyle={{ y: -10, opacity: 0 }}
        animation={["quick", { opacity: { overshootClamping: true } }]}
      >
        <Popover.Arrow borderWidth={1} borderColor="$border" />
        <YStack gap="$1">{children}</YStack>
      </Popover.Content>
    </Popover>
  );
}

export function DropdownMenuItem({
  onPress,
  children,
}: {
  onPress?: () => void;
  children: React.ReactNode;
}) {
  return (
    <Popover.Close asChild>
      <MenuItemFrame onPress={onPress}>{children}</MenuItemFrame>
    </Popover.Close>
  );
}
