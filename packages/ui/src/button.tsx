"use client";

import { styled, Button as TamaguiButton } from "tamagui";

export const Button = styled(TamaguiButton, {
  name: "Button",
  fontFamily: "$body",
  borderRadius: "$button",
  pressStyle: { opacity: 0.85 },

  variants: {
    variant: {
      primary: {
        backgroundColor: "$primaryTeal",
        color: "$primaryTealText",
        borderWidth: 0,
      },
      secondary: {
        backgroundColor: "$primaryTealLight",
        color: "$primaryTeal",
        borderWidth: 0,
      },
      outline: {
        backgroundColor: "transparent",
        borderWidth: 1,
        borderColor: "$border",
        color: "$textPrimary",
      },
      ghost: {
        backgroundColor: "transparent",
        borderWidth: 0,
        color: "$textPrimary",
      },
      destructive: {
        backgroundColor: "$error",
        color: "$primaryTealText",
        borderWidth: 0,
      },
    },
    size: {
      sm: { height: 32, paddingHorizontal: "$3", fontSize: "$3" },
      md: { height: 40, paddingHorizontal: "$4", fontSize: "$4" },
      lg: { height: 48, paddingHorizontal: "$5", fontSize: "$5" },
    },
  } as const,

  defaultVariants: {
    variant: "primary",
    size: "md",
  },
});
