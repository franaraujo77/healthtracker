var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __name = (target, value) =>
  __defProp(target, "name", { value, configurable: true });
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if ((from && typeof from === "object") || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, {
          get: () => from[key],
          enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable,
        });
  }
  return to;
};
var __toCommonJS = (mod) =>
  __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// ../../packages/ui/tamagui.config.ts
var tamagui_config_exports = {};
__export(tamagui_config_exports, {
  default: () => tamagui_config_default,
});
module.exports = __toCommonJS(tamagui_config_exports);

// ../../node_modules/.pnpm/tamagui@1.144.4_react-dom@19.1.4_react@19.1.4__react-native@0.81.5_@babel+core@7.28.5_@_111da0d243deaf63075797362031ea8b/node_modules/tamagui/dist/esm/createTamagui.mjs
var import_core = require("@tamagui/core");
var createTamagui =
  process.env.NODE_ENV !== "development"
    ? import_core.createTamagui
    : (conf) => {
        const sizeTokenKeys = ["$true"],
          hasKeys = /* @__PURE__ */ __name(
            (expectedKeys, obj) =>
              expectedKeys.every((k) => typeof obj[k] < "u"),
            "hasKeys",
          ),
          tamaguiConfig = (0, import_core.createTamagui)(conf);
        for (const name of ["size", "space"]) {
          const tokenSet = tamaguiConfig.tokensParsed[name];
          if (!tokenSet)
            throw new Error(
              `Expected tokens for "${name}" in ${Object.keys(tamaguiConfig.tokensParsed).join(", ")}`,
            );
          if (!hasKeys(sizeTokenKeys, tokenSet))
            throw new Error(`
createTamagui() missing expected tokens.${name}:

Received: ${Object.keys(tokenSet).join(", ")}

Expected: ${sizeTokenKeys.join(", ")}

Tamagui expects a "true" key that is the same value as your default size. This is so 
it can size things up or down from the defaults without assuming which keys you use.

Please define a "true" or "$true" key on your size and space tokens like so (example):

size: {
  sm: 2,
  md: 10,
  true: 10, // this means "md" is your default size
  lg: 20,
}

`);
        }
        const expected = Object.keys(tamaguiConfig.tokensParsed.size);
        for (const name of ["radius", "zIndex"]) {
          const tokenSet = tamaguiConfig.tokensParsed[name],
            received = Object.keys(tokenSet);
          if (!received.some((rk) => expected.includes(rk)))
            throw new Error(`
createTamagui() invalid tokens.${name}:

Received: ${received.join(", ")}

Expected a subset of: ${expected.join(", ")}

`);
        }
        return tamaguiConfig;
      };

// ../../node_modules/.pnpm/tamagui@1.144.4_react-dom@19.1.4_react@19.1.4__react-native@0.81.5_@babel+core@7.28.5_@_111da0d243deaf63075797362031ea8b/node_modules/tamagui/dist/esm/index.mjs
var import_core2 = require("@tamagui/core");

// ../../packages/ui/src/theme/tokens.ts
var colorTokens = {
  // Backgrounds
  backgroundPrimary: { light: "#F9F7F4", dark: "#1C1917" },
  surface: { light: "#FEFCF9", dark: "#292524" },
  surfaceElevated: { light: "#FFFFFF", dark: "#3C3836" },
  border: { light: "#E8E3DB", dark: "#44403C" },
  // Primary — deep teal
  primaryTeal: { light: "#0D6E6E", dark: "#14B8A6" },
  primaryTealLight: { light: "#E0F2F1", dark: "#134E4A" },
  primaryTealText: { light: "#FFFFFF", dark: "#FFFFFF" },
  // Text
  textPrimary: { light: "#1A1A1A", dark: "#F5F0EB" },
  textSecondary: { light: "#6B6B6B", dark: "#A8A29E" },
  textTertiary: { light: "#9E9E9E", dark: "#78716C" },
  // Biomarker deviation (amber — NEVER used for system errors)
  biomarkerDeviation: { light: "#D97706", dark: "#FBBF24" },
  biomarkerDeviationBg: { light: "#FEF9EE", dark: "#292118" },
  // Trend signals
  trendDown: { light: "#6B7280", dark: "#9CA3AF" },
  trendDownBg: { light: "#F3F4F6", dark: "#1F2937" },
  trendUp: { light: "#059669", dark: "#34D399" },
  trendUpBg: { light: "#F0FDF9", dark: "#022C22" },
  stable: { light: "#8B5CF6", dark: "#A78BFA" },
  stableBg: { light: "#F5F3FF", dark: "#1E1B4B" },
  // System errors ONLY — never for biomarker values
  error: { light: "#DC2626", dark: "#F87171" },
  errorBg: { light: "#FEF2F2", dark: "#450A0A" },
  success: { light: "#16A34A", dark: "#4ADE80" },
  backgroundDark: { light: "#1C1917", dark: "#1C1917" },
};
var fontSizeTokens = {
  display: 32,
  h1: 28,
  h2: 22,
  h3: 18,
  h4: 16,
  bodyLarge: 16,
  body: 14,
  bodySmall: 13,
  caption: 12,
  label: 11,
  biomarkerValue: 28,
  biomarkerValueSmall: 18,
  unit: 12,
  letterBody: 17,
};
var spaceTokens = {
  1: 4,
  2: 8,
  3: 12,
  4: 16,
  5: 20,
  6: 24,
  8: 32,
  10: 40,
  12: 48,
  16: 64,
};
var radiusTokens = {
  card: 12,
  cardLg: 16,
  button: 999,
  chip: 8,
  input: 10,
};

// ../../packages/ui/src/theme/themes.ts
var pick = /* @__PURE__ */ __name(
  (key, mode) => colorTokens[key][mode],
  "pick",
);
var lightTheme = {
  backgroundPrimary: pick("backgroundPrimary", "light"),
  surface: pick("surface", "light"),
  surfaceElevated: pick("surfaceElevated", "light"),
  border: pick("border", "light"),
  primaryTeal: pick("primaryTeal", "light"),
  primaryTealLight: pick("primaryTealLight", "light"),
  primaryTealText: pick("primaryTealText", "light"),
  textPrimary: pick("textPrimary", "light"),
  textSecondary: pick("textSecondary", "light"),
  textTertiary: pick("textTertiary", "light"),
  biomarkerDeviation: pick("biomarkerDeviation", "light"),
  biomarkerDeviationBg: pick("biomarkerDeviationBg", "light"),
  trendDown: pick("trendDown", "light"),
  trendDownBg: pick("trendDownBg", "light"),
  trendUp: pick("trendUp", "light"),
  trendUpBg: pick("trendUpBg", "light"),
  stable: pick("stable", "light"),
  stableBg: pick("stableBg", "light"),
  error: pick("error", "light"),
  errorBg: pick("errorBg", "light"),
  success: pick("success", "light"),
  backgroundDark: pick("backgroundDark", "light"),
};
var darkTheme = {
  backgroundPrimary: pick("backgroundPrimary", "dark"),
  surface: pick("surface", "dark"),
  surfaceElevated: pick("surfaceElevated", "dark"),
  border: pick("border", "dark"),
  primaryTeal: pick("primaryTeal", "dark"),
  primaryTealLight: pick("primaryTealLight", "dark"),
  primaryTealText: pick("primaryTealText", "dark"),
  textPrimary: pick("textPrimary", "dark"),
  textSecondary: pick("textSecondary", "dark"),
  textTertiary: pick("textTertiary", "dark"),
  biomarkerDeviation: pick("biomarkerDeviation", "dark"),
  biomarkerDeviationBg: pick("biomarkerDeviationBg", "dark"),
  trendDown: pick("trendDown", "dark"),
  trendDownBg: pick("trendDownBg", "dark"),
  trendUp: pick("trendUp", "dark"),
  trendUpBg: pick("trendUpBg", "dark"),
  stable: pick("stable", "dark"),
  stableBg: pick("stableBg", "dark"),
  error: pick("error", "dark"),
  errorBg: pick("errorBg", "dark"),
  success: pick("success", "dark"),
  backgroundDark: pick("backgroundDark", "dark"),
};

// ../../packages/ui/tamagui.config.ts
var dmSansFont = (0, import_core2.createFont)({
  family: "DM Sans, system-ui, sans-serif",
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
var loraFont = (0, import_core2.createFont)({
  family: "Lora, Georgia, serif",
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
var dmMonoFont = (0, import_core2.createFont)({
  family: "DM Mono, monospace",
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
var tokens = (0, import_core2.createTokens)({
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
var light = (0, import_core2.createTheme)({
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
var dark = (0, import_core2.createTheme)({
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
var appConfig = createTamagui({
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
  defaultFont: "body",
  shouldAddPrefersColorThemes: true,
  themeClassNameOnRoot: true,
});
var tamagui_config_default = appConfig;
