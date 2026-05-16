"use client";

import { styled, Input as TamaguiInput } from "tamagui";

export const Input = styled(TamaguiInput, {
  name: "Input",
  fontFamily: "$body",
  borderRadius: "$input",
  borderWidth: 1,
  borderColor: "$border",
  backgroundColor: "$surfaceElevated",
  color: "$textPrimary",
  paddingHorizontal: "$3",
  height: 44,

  focusStyle: {
    borderColor: "$primaryTeal",
    borderWidth: 1,
  },

  placeholderTextColor: "$textTertiary",
});
