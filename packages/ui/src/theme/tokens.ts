export const colorTokens = {
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

  // Story 5.1 — ShareBiomarkerToggle row backgrounds (UX spec lines
  // 948–965). `shareToggleOn` mirrors `primaryTealLight` for the
  // muted-teal "shared" surface; `shareToggleOff` is a warm neutral
  // for the "hidden" state (NEVER red — UX-DR13);
  // `shareToggleDisabledText` is a low-contrast grey for the
  // disabled "Sem dados ainda" row.
  shareToggleOn: { light: "#E0F2F1", dark: "#134E4A" },
  shareToggleOff: { light: "#F3EFE7", dark: "#3C3836" },
  shareToggleDisabledText: { light: "#9E9E9E", dark: "#78716C" },
} as const;

export const fontSizeTokens = {
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
} as const;

export const fontFamilyTokens = {
  uiFont: "DM Sans",
  letterFont: "Lora",
  monoFont: "DM Mono",
} as const;

export const spaceTokens = {
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
} as const;

export const radiusTokens = {
  card: 12,
  cardLg: 16,
  button: 999,
  chip: 8,
  input: 10,
} as const;
