import { createAnimations } from "@tamagui/animations-css";
import { createFont, createTamagui, createTheme, createTokens } from "tamagui";

import { darkTheme, lightTheme } from "./src/theme/themes";
import {
  colorTokens,
  fontFamilyTokens,
  fontSizeTokens,
  radiusTokens,
  spaceTokens,
} from "./src/theme/tokens";

const dmSansFont = createFont({
  family: `${fontFamilyTokens.uiFont}, system-ui, sans-serif`,
  size: {
    1: fontSizeTokens.caption,
    2: fontSizeTokens.label,
    3: fontSizeTokens.bodySmall,
    4: fontSizeTokens.body,
    5: fontSizeTokens.bodyLarge,
    6: fontSizeTokens.h4,
    7: fontSizeTokens.h3,
    8: fontSizeTokens.h2,
    9: fontSizeTokens.h1,
    10: fontSizeTokens.display,
    true: fontSizeTokens.body,
  },
  weight: {
    1: "400",
    2: "500",
    3: "600",
    4: "700",
  },
  letterSpacing: {
    1: 0,
    2: 0.5,
    3: 1,
  },
  lineHeight: {
    1: 16,
    2: 20,
    3: 22,
    4: 24,
    5: 28,
    6: 32,
    7: 36,
    8: 40,
    true: 22,
  },
});

const loraFont = createFont({
  family: `${fontFamilyTokens.letterFont}, Georgia, serif`,
  size: {
    1: fontSizeTokens.caption,
    2: fontSizeTokens.body,
    3: fontSizeTokens.letterBody,
    4: fontSizeTokens.h3,
    true: fontSizeTokens.letterBody,
  },
  weight: {
    1: "400",
    2: "500",
    3: "700",
  },
  letterSpacing: {
    1: 0,
  },
  lineHeight: {
    1: 24,
    2: 28,
    3: 32,
    true: 28,
  },
});

const dmMonoFont = createFont({
  family: `${fontFamilyTokens.monoFont}, monospace`,
  size: {
    1: fontSizeTokens.caption,
    2: fontSizeTokens.body,
    true: fontSizeTokens.body,
  },
  weight: {
    1: "400",
    2: "500",
  },
  letterSpacing: {
    1: 0,
  },
  lineHeight: {
    1: 20,
    true: 20,
  },
});

const tokens = createTokens({
  color: {
    backgroundPrimary: colorTokens.backgroundPrimary.light,
    backgroundPrimaryDark: colorTokens.backgroundPrimary.dark,
    surface: colorTokens.surface.light,
    surfaceDark: colorTokens.surface.dark,
    surfaceElevated: colorTokens.surfaceElevated.light,
    surfaceElevatedDark: colorTokens.surfaceElevated.dark,
    border: colorTokens.border.light,
    borderDark: colorTokens.border.dark,
    primaryTeal: colorTokens.primaryTeal.light,
    primaryTealDark: colorTokens.primaryTeal.dark,
    primaryTealLight: colorTokens.primaryTealLight.light,
    primaryTealLightDark: colorTokens.primaryTealLight.dark,
    primaryTealText: colorTokens.primaryTealText.light,
    textPrimary: colorTokens.textPrimary.light,
    textPrimaryDark: colorTokens.textPrimary.dark,
    textSecondary: colorTokens.textSecondary.light,
    textSecondaryDark: colorTokens.textSecondary.dark,
    textTertiary: colorTokens.textTertiary.light,
    textTertiaryDark: colorTokens.textTertiary.dark,
    biomarkerDeviation: colorTokens.biomarkerDeviation.light,
    biomarkerDeviationDark: colorTokens.biomarkerDeviation.dark,
    biomarkerDeviationBg: colorTokens.biomarkerDeviationBg.light,
    biomarkerDeviationBgDark: colorTokens.biomarkerDeviationBg.dark,
    trendDown: colorTokens.trendDown.light,
    trendDownDark: colorTokens.trendDown.dark,
    trendDownBg: colorTokens.trendDownBg.light,
    trendDownBgDark: colorTokens.trendDownBg.dark,
    trendUp: colorTokens.trendUp.light,
    trendUpDark: colorTokens.trendUp.dark,
    trendUpBg: colorTokens.trendUpBg.light,
    trendUpBgDark: colorTokens.trendUpBg.dark,
    stable: colorTokens.stable.light,
    stableDark: colorTokens.stable.dark,
    stableBg: colorTokens.stableBg.light,
    stableBgDark: colorTokens.stableBg.dark,
    error: colorTokens.error.light,
    errorDark: colorTokens.error.dark,
    errorBg: colorTokens.errorBg.light,
    errorBgDark: colorTokens.errorBg.dark,
    success: colorTokens.success.light,
    successDark: colorTokens.success.dark,
    backgroundDark: colorTokens.backgroundDark.light,
  },
  space: spaceTokens,
  size: spaceTokens,
  radius: radiusTokens,
  zIndex: {
    0: 0,
    1: 100,
    2: 200,
    3: 300,
  },
});

const light = createTheme({
  backgroundPrimary: lightTheme.backgroundPrimary,
  surface: lightTheme.surface,
  surfaceElevated: lightTheme.surfaceElevated,
  border: lightTheme.border,
  primaryTeal: lightTheme.primaryTeal,
  primaryTealLight: lightTheme.primaryTealLight,
  primaryTealText: lightTheme.primaryTealText,
  textPrimary: lightTheme.textPrimary,
  textSecondary: lightTheme.textSecondary,
  textTertiary: lightTheme.textTertiary,
  biomarkerDeviation: lightTheme.biomarkerDeviation,
  biomarkerDeviationBg: lightTheme.biomarkerDeviationBg,
  trendDown: lightTheme.trendDown,
  trendDownBg: lightTheme.trendDownBg,
  trendUp: lightTheme.trendUp,
  trendUpBg: lightTheme.trendUpBg,
  stable: lightTheme.stable,
  stableBg: lightTheme.stableBg,
  error: lightTheme.error,
  errorBg: lightTheme.errorBg,
  success: lightTheme.success,
  backgroundDark: lightTheme.backgroundDark,
});

const dark = createTheme({
  backgroundPrimary: darkTheme.backgroundPrimary,
  surface: darkTheme.surface,
  surfaceElevated: darkTheme.surfaceElevated,
  border: darkTheme.border,
  primaryTeal: darkTheme.primaryTeal,
  primaryTealLight: darkTheme.primaryTealLight,
  primaryTealText: darkTheme.primaryTealText,
  textPrimary: darkTheme.textPrimary,
  textSecondary: darkTheme.textSecondary,
  textTertiary: darkTheme.textTertiary,
  biomarkerDeviation: darkTheme.biomarkerDeviation,
  biomarkerDeviationBg: darkTheme.biomarkerDeviationBg,
  trendDown: darkTheme.trendDown,
  trendDownBg: darkTheme.trendDownBg,
  trendUp: darkTheme.trendUp,
  trendUpBg: darkTheme.trendUpBg,
  stable: darkTheme.stable,
  stableBg: darkTheme.stableBg,
  error: darkTheme.error,
  errorBg: darkTheme.errorBg,
  success: darkTheme.success,
  backgroundDark: darkTheme.backgroundDark,
});

export type AppConfig = typeof appConfig;

const appConfig = createTamagui({
  fonts: {
    body: dmSansFont,
    heading: dmSansFont,
    mono: dmMonoFont,
    letter: loraFont,
  },
  tokens,
  themes: { light, dark },
  media: {
    xs: { maxWidth: 660 },
    sm: { maxWidth: 800 },
    md: { maxWidth: 1020 },
    lg: { maxWidth: 1280 },
    xl: { maxWidth: 1650 },
  },
  animations: createAnimations({
    quick: "ease-in 150ms",
    medium: "ease-in-out 300ms",
    slow: "ease-in-out 450ms",
    bouncy: "cubic-bezier(0.175, 0.885, 0.32, 1.275) 300ms",
  }),
  defaultFont: "body",
});

declare module "tamagui" {
  interface TamaguiCustomConfig extends AppConfig {}
}

export default appConfig;
