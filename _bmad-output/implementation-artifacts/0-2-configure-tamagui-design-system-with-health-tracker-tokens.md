# Story 0.2: Configure Tamagui Design System with Health Tracker Tokens

Status: ready-for-dev

## Story

As a developer,
I want Tamagui installed and configured across the monorepo with the Health Tracker design token system,
So that every component written in later stories uses the correct semantic tokens without hardcoded hex values.

## Acceptance Criteria

1. **Given** Tamagui is installed in `packages/ui`,
   **When** `tamagui.config.ts` is inspected,
   **Then** it exports tokens including `$color.backgroundPrimary: '#F9F7F4'`, `$color.primaryTeal: '#0D6E6E'`, `$color.biomarkerDeviation: '#D97706'`, `$color.error: '#DC2626'`, `$color.backgroundDark: '#1C1917'`, and font families `DM Sans` (UI) and `Lora` (Letter).

2. **Given** `metro.config.js` in `apps/expo`,
   **When** it is inspected,
   **Then** `unstable_enablePackageExports: true` is set to support Tamagui's package exports.

3. **Given** a component uses `$color.biomarkerDeviation`,
   **When** a developer hard-codes a hex value `#D97706` anywhere in `packages/ui/src` component files,
   **Then** the CI lint step fails with a no-hardcoded-color rule violation.

4. **Given** the dark mode token set,
   **When** `packages/ui/src/theme/tokens.ts` is inspected,
   **Then** dark mode token definitions are present even if the dark mode theme is not surfaced in the MVP UI.

## Tasks / Subtasks

- [ ] Task 1: Install Tamagui packages across the monorepo (AC: #1, #2)
  - [ ] Add Tamagui catalog entries to `pnpm-workspace.yaml` (use `tamagui@^1.144.4` — stable v1.x; `latest` npm tag resolves to RC)
  - [ ] Update `packages/ui/package.json`: remove `radix-ui`, `class-variance-authority`, `tailwind-merge`, `@radix-ui/react-icons`, `sonner`; add `tamagui`, `@tamagui/core`, `@tamagui/web`
  - [ ] Update `apps/expo/package.json`: add `tamagui`, `@tamagui/core`, `@tamagui/animations-react-native`; remove `nativewind`, `react-native-css`, `postcss.config.mjs`; add `@tamagui/babel-plugin` to devDependencies
  - [ ] Update `apps/web/package.json`: add `tamagui`, `@tamagui/core`, `@tamagui/next-plugin`
  - [ ] Run `pnpm install` and confirm no errors

- [ ] Task 2: Create Health Tracker design token system (AC: #1, #4)
  - [ ] Create `packages/ui/src/theme/tokens.ts` — full colour palette (light + dark), typography scale, spacing scale (see Dev Notes for exact values from UX spec)
  - [ ] Create `packages/ui/src/theme/themes.ts` — light theme and dark theme definitions using tokens from `tokens.ts`
  - [ ] Create `packages/ui/tamagui.config.ts` — full Tamagui config exporting `createTamagui()` with the Health Tracker token set, DM Sans and Lora font families, animations, and media queries
  - [ ] Verify `tamagui.config.ts` exports tokens satisfying AC #1 (`$color.backgroundPrimary`, `$color.primaryTeal`, `$color.biomarkerDeviation`, `$color.error`, `$color.backgroundDark`, `DM Sans`, `Lora`)
  - [ ] Verify dark mode tokens satisfy AC #4 (warm dark palette `#1C1917` background)

- [ ] Task 3: Update `apps/expo/metro.config.js` (AC: #2)
  - [ ] Remove `withNativewind` wrapper
  - [ ] Add `config.resolver.unstable_enablePackageExports = true`
  - [ ] Add Tamagui Babel plugin to `apps/expo/babel.config.js` (or `.babelrc`) so Tamagui tree-shakes correctly
  - [ ] Remove `nativewind-env.d.ts` file if no longer needed
  - [ ] Verify Metro starts without errors: `pnpm dev` in `apps/expo`

- [ ] Task 4: Configure Next.js for Tamagui (AC: #1)
  - [ ] Add `@tamagui/next-plugin` to `apps/web/next.config.js` (`withTamagui(config)` wrapper)
  - [ ] Configure the plugin to point to `packages/ui/tamagui.config.ts`
  - [ ] Ensure `@healthtracker/ui` remains in `transpilePackages`
  - [ ] Verify Next.js dev server starts and default page renders

- [ ] Task 5: Migrate `packages/ui` from shadcn/ui to Tamagui primitives (AC: #1, #3)
  - [ ] Replace `packages/ui/src/button.tsx` — rewrite using `tamagui` `Button` primitive with Health Tracker token variants
  - [ ] Replace `packages/ui/src/input.tsx` — rewrite using `tamagui` `Input` primitive
  - [ ] Replace `packages/ui/src/label.tsx` — rewrite using `tamagui` `Label` primitive
  - [ ] Replace `packages/ui/src/separator.tsx` — rewrite using `tamagui` `Separator` primitive
  - [ ] Replace `packages/ui/src/field.tsx` — rewrite using Tamagui `XStack`/`YStack` and `Label`/`Input`
  - [ ] Replace `packages/ui/src/dropdown-menu.tsx` — rewrite using `tamagui` `Sheet` or `Popover` primitives
  - [ ] Replace `packages/ui/src/toast.tsx` — rewrite using `tamagui` `Toast` primitive (or remove if not needed until later stories)
  - [ ] Delete `packages/ui/src/theme.tsx` (shadcn ThemeProvider; Tamagui provides theming via its own config)
  - [ ] Update `packages/ui/src/index.ts` to export Tamagui-based components and `TamaguiProvider`
  - [ ] Create `packages/ui/src/providers/TamaguiProvider.tsx` — wraps both Expo and Next.js app roots

- [ ] Task 6: Wire TamaguiProvider into app roots (AC: #1, #2)
  - [ ] Update `apps/expo/src/app/_layout.tsx` — wrap root with `TamaguiProvider` from `@healthtracker/ui`
  - [ ] Update `apps/web/src/app/layout.tsx` — wrap root with `TamaguiProvider` from `@healthtracker/ui`
  - [ ] Remove any remaining Tailwind / NativeWind import from Expo layout (e.g., `nativewind-env.d.ts` reference, PostCSS config)

- [ ] Task 7: Add no-hardcoded-color ESLint rule to `packages/ui` (AC: #3)
  - [ ] Update `packages/ui/eslint.config.ts` — add a `no-restricted-syntax` rule scoped to `src/**/*.tsx` and `src/**/*.ts` that rejects bare hex color literals
  - [ ] Exclude `src/theme/tokens.ts` and `tamagui.config.ts` from the rule (these files are the authoritative token definitions)
  - [ ] Confirm `pnpm lint` in `packages/ui` fails on a file containing `#D97706` (write a test file, run lint, delete test file)

- [ ] Task 8: Verify full build and clean up (AC: #1, #2, #3, #4)
  - [ ] Delete `packages/ui/src/field.tsx` shadcn-style `cn` helper if replaced (keep only if still used)
  - [ ] Remove `tailwind-merge`, `class-variance-authority` from `packages/ui/package.json` if no longer imported
  - [ ] Run `SKIP_ENV_VALIDATION=1 pnpm turbo build` — must complete with zero TypeScript errors
  - [ ] Run `pnpm lint` across all packages — must pass with no-hardcoded-color rule active
  - [ ] Run `grep -r "#[0-9A-Fa-f]\{6\}" packages/ui/src --include="*.tsx" --include="*.ts" --exclude-dir=theme` — must return zero results

## Dev Notes

### Why Tamagui, Why Now

AR2 mandates Tamagui as the cross-platform design system. It replaces the shadcn/ui + Tailwind stack that ships with `create-t3-turbo` for `packages/ui`. The reason to do this in Sprint 0 (before any feature components exist) is that all feature stories (Epic 2 `ExtractionPulse`, Epic 3 `FingerprintChart`, Epic 4 `LetterReader`) depend on the token system being stable. Retrofitting tokens after components are built is exponentially more expensive.

### Current State of Files Being Modified

**`packages/ui/package.json`** — currently uses `radix-ui`, `class-variance-authority`, `tailwind-merge`, `@radix-ui/react-icons`, `sonner`. These are the shadcn/ui dependencies. All of them should be removed once the Tamagui-based equivalents are in place.

**`packages/ui/src/index.ts`** — currently exports: `button.tsx`, `dropdown-menu.tsx`, `field.tsx`, `input.tsx`, `label.tsx`, `separator.tsx`, `theme.tsx`, `toast.tsx`. After this story, it should export Tamagui-based versions of these primitives, plus `TamaguiProvider`.

**`packages/ui/src/theme.tsx`** — a shadcn ThemeProvider with localStorage-based light/dark mode toggle. This is replaced by Tamagui's built-in `useTheme()` hook and dark mode config. Delete after migration.

**`apps/expo/metro.config.js`** — currently wraps config with `withNativewind`. After this story it should add `unstable_enablePackageExports: true` on the resolver and **not** use `withNativewind` (NativeWind is not used with Tamagui).

**`apps/expo/package.json`** — currently has `nativewind`, `react-native-css`. These are NativeWind dependencies. Remove them. Add `tamagui`, `@tamagui/core`, `@tamagui/animations-react-native`.

**`apps/web/next.config.js`** — currently has no Tamagui plugin. Add `@tamagui/next-plugin` wrapper.

### Tamagui Version Decision

Use **`tamagui@^1.144.4`** (stable v1.x). The `npm` `latest` tag currently resolves to `2.0.0-rc.42` (a release candidate) — do NOT install without pinning. Install all Tamagui packages at the same `^1.144.4` version to avoid version mismatches.

Packages needed at `^1.144.4`:
- `tamagui` — the aggregated meta-package
- `@tamagui/core` — core primitives
- `@tamagui/web` — web-only optimizations (for `packages/ui` which runs on both platforms)
- `@tamagui/animations-react-native` — Expo animation driver
- `@tamagui/next-plugin` — Next.js compiler integration
- `@tamagui/babel-plugin` — Babel optimization for Expo/RN

### Token System — Full Reference

Define all tokens in `packages/ui/src/theme/tokens.ts`. The file exports named constants that `tamagui.config.ts` consumes via `createTokens()`.

**Colour Palette (required by AC #1):**

```typescript
// Light mode → dark mode mappings
export const colorTokens = {
  // Backgrounds
  backgroundPrimary: { light: '#F9F7F4', dark: '#1C1917' },    // AC #1 required
  surface:           { light: '#FEFCF9', dark: '#292524' },
  surfaceElevated:   { light: '#FFFFFF', dark: '#3C3836' },
  border:            { light: '#E8E3DB', dark: '#44403C' },

  // Primary — deep teal
  primaryTeal:       { light: '#0D6E6E', dark: '#14B8A6' },     // AC #1 required
  primaryTealLight:  { light: '#E0F2F1', dark: '#134E4A' },
  primaryTealText:   { light: '#FFFFFF', dark: '#FFFFFF' },

  // Text
  textPrimary:       { light: '#1A1A1A', dark: '#F5F0EB' },
  textSecondary:     { light: '#6B6B6B', dark: '#A8A29E' },
  textTertiary:      { light: '#9E9E9E', dark: '#78716C' },

  // Biomarker deviation (amber — NEVER used for system errors)
  biomarkerDeviation:   { light: '#D97706', dark: '#FBBF24' },  // AC #1 required
  biomarkerDeviationBg: { light: '#FEF9EE', dark: '#292118' },

  // Trend signals
  trendDown:    { light: '#6B7280', dark: '#9CA3AF' },
  trendDownBg:  { light: '#F3F4F6', dark: '#1F2937' },
  trendUp:      { light: '#059669', dark: '#34D399' },
  trendUpBg:    { light: '#F0FDF9', dark: '#022C22' },
  stable:       { light: '#8B5CF6', dark: '#A78BFA' },
  stableBg:     { light: '#F5F3FF', dark: '#1E1B4B' },

  // System errors ONLY — never for biomarker values
  error:        { light: '#DC2626', dark: '#F87171' },          // AC #1 required
  errorBg:      { light: '#FEF2F2', dark: '#450A0A' },
  success:      { light: '#16A34A', dark: '#4ADE80' },
  backgroundDark: { light: '#1C1917', dark: '#1C1917' },        // AC #1 required (dark bg token)
}
```

**Typography Scale (required by AC #1):**

```typescript
export const fontSizeTokens = {
  display:            32,
  h1:                 28,
  h2:                 22,
  h3:                 18,
  h4:                 16,
  bodyLarge:          16,
  body:               14,
  bodySmall:          13,
  caption:            12,
  label:              11,
  biomarkerValue:     28,
  biomarkerValueSmall:18,
  unit:               12,
  letterBody:         17,
}

export const fontFamilyTokens = {
  uiFont: 'DM Sans',     // AC #1 required — all UI text
  letterFont: 'Lora',    // AC #1 required — The Letter narrative only
  monoFont: 'DM Mono',   // LOINC codes, technical data
}
```

**Spacing Scale:**

```typescript
export const spaceTokens = {
  1:  4,   // icon padding, tight gaps
  2:  8,   // inline element gaps
  3:  12,  // list item vertical padding
  4:  16,  // card padding mobile, screen horizontal margin
  5:  20,  // card padding desktop
  6:  24,  // section gaps, card vertical padding
  8:  32,  // major section separation
  10: 40,  // screen top padding
  12: 48,  // FAB margin, bottom sheet handle
  16: 64,  // empty state illustration margin
}
```

**Radius Tokens:**

```typescript
export const radiusTokens = {
  card:      12,   // mobile cards
  cardLg:    16,   // desktop cards
  button:    999,  // pill shape for primary CTAs
  chip:      8,    // deviation chips
  input:     10,   // input fields
}
```

### `tamagui.config.ts` Structure

```typescript
// packages/ui/tamagui.config.ts
import { createFont, createTamagui, createTokens } from '@tamagui/core'
import { colorTokens, fontSizeTokens, spaceTokens, radiusTokens } from './src/theme/tokens'

const dmSansFont = createFont({
  family: 'DM Sans, system-ui, sans-serif',
  size: { ...fontSizeTokens },
  weight: { 4: '400', 5: '500', 6: '600', 7: '700' },
  letterSpacing: { label: 0.5 },
  lineHeight: { /* per UX spec */ },
})

const loraFont = createFont({
  family: 'Lora, Georgia, serif',
  size: { body: 17 },
  weight: { 4: '400', 5: '500', 7: '700' },
})

const tokens = createTokens({
  color: {
    backgroundPrimary: colorTokens.backgroundPrimary.light,
    primaryTeal:       colorTokens.primaryTeal.light,
    biomarkerDeviation: colorTokens.biomarkerDeviation.light,
    error:             colorTokens.error.light,
    backgroundDark:    colorTokens.backgroundDark.light,
    // ... all other tokens
  },
  space:  spaceTokens,
  size:   spaceTokens,
  radius: radiusTokens,
  zIndex: { 0: 0, 1: 100, 2: 200, 3: 300 },
})

export default createTamagui({
  fonts: { body: dmSansFont, heading: dmSansFont, mono: monoFont, letter: loraFont },
  tokens,
  themes: { light: { /* from themes.ts */ }, dark: { /* from themes.ts */ } },
  media: {
    xs:  { maxWidth: 660 },
    sm:  { maxWidth: 800 },
    md:  { maxWidth: 1020 },
    lg:  { maxWidth: 1280 },
    xl:  { maxWidth: 1650 },
  },
  animations: /* react-native-reanimated or css transitions */
})
```

### `metro.config.js` — Required Change

```javascript
// apps/expo/metro.config.js — after this story
const path = require('node:path')
const { getDefaultConfig } = require('expo/metro-config')
const { FileStore } = require('metro-cache')

const config = getDefaultConfig(__dirname)

// Required for Tamagui package exports resolution (AR2)
config.resolver.unstable_enablePackageExports = true

config.cacheStores = [
  new FileStore({ root: path.join(__dirname, 'node_modules', '.cache', 'metro') }),
]

module.exports = config
```

**Remove** the `withNativewind` wrapper entirely — NativeWind is not compatible with Tamagui's styling approach.

### Babel Config for Expo

Tamagui requires its Babel plugin in `apps/expo/babel.config.js` (create if it doesn't exist alongside `metro.config.js`):

```javascript
module.exports = function (api) {
  api.cache(true)
  return {
    presets: ['babel-preset-expo'],
    plugins: [
      [
        '@tamagui/babel-plugin',
        {
          components: ['tamagui'],
          config: '../../packages/ui/tamagui.config.ts',
          logTimings: true,
          disableExtraction: process.env.NODE_ENV === 'development',
        },
      ],
      'react-native-reanimated/plugin', // must be last
    ],
  }
}
```

### Next.js Config Update

```typescript
// apps/web/next.config.js — after this story
import { withTamagui } from '@tamagui/next-plugin'

const tamaguiConfig = withTamagui({
  config: '../../packages/ui/tamagui.config.ts',
  components: ['tamagui', '@healthtracker/ui'],
})

const config = {
  transpilePackages: [
    '@healthtracker/api',
    '@healthtracker/auth',
    '@healthtracker/db',
    '@healthtracker/ui',
    '@healthtracker/validators',
    'tamagui',
    '@tamagui/core',
    '@tamagui/web',
  ],
  typescript: { ignoreBuildErrors: true },
}

export default tamaguiConfig(config)
```

### ESLint No-Hardcoded-Color Rule

Add to `packages/ui/eslint.config.ts`:

```typescript
// Scoped to component files only — NOT to theme/tokens.ts or tamagui.config.ts
{
  files: ['src/**/*.tsx', 'src/**/*.ts'],
  ignores: ['src/theme/**'],  // token files are the only allowed source of hex values
  rules: {
    'no-restricted-syntax': [
      'error',
      {
        selector: "Literal[value=/^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6}|[0-9A-Fa-f]{8})$/]",
        message: "Use a Tamagui semantic token (e.g. '$color.primaryTeal') instead of a hardcoded hex value.",
      },
    ],
  },
},
```

### TamaguiProvider Pattern

```typescript
// packages/ui/src/providers/TamaguiProvider.tsx
import { TamaguiProvider as BaseTamaguiProvider } from 'tamagui'
import config from '../../tamagui.config'

export function TamaguiProvider({ children }: { children: React.ReactNode }) {
  return (
    <BaseTamaguiProvider config={config} defaultTheme="light">
      {children}
    </BaseTamaguiProvider>
  )
}
```

Both `apps/expo/src/app/_layout.tsx` and `apps/web/src/app/layout.tsx` should import this and wrap their content with it.

### What This Story Does NOT Do

- Building feature components (`FingerprintChart`, `BiomarkerCard`, `ExtractionPulse`, `LetterReader`) — those are in later epics
- Configuring Expo push notifications or biometric auth
- Supabase Auth session integration in the providers — Story 0.3
- pg-boss, CI pipeline, Sentry — Stories 0.5, 0.6, 0.7
- Actual screen UI for patient or doctor flows — Epic 1 onward

### Architecture Invariants to Preserve

From Story 0.1 (must not break):
- `packages/auth/src/{client,server,index}.ts` — Supabase Auth stubs; do not touch
- `packages/api/src/trpc.ts` — tRPC context with minimal Supabase session; do not touch
- `apps/web/src/env.ts` and `packages/auth/env.ts` — env validation; do not touch
- `SKIP_ENV_VALIDATION=1 pnpm turbo build` must still pass

From architecture (invariants for all future stories):
- Never use `hardcoded hex values` in component files — semantic tokens only
- Never use `red` for biomarker deviation — always amber (`$color.biomarkerDeviation`)
- Token file (`tokens.ts`) and `tamagui.config.ts` are the ONLY allowed places for hex values

### Previous Story Learnings (Story 0.1)

- `sherif` postinstall hook enforces alphabetical dependency ordering in `package.json` files — keep deps alphabetical when editing
- `SKIP_ENV_VALIDATION=1` is required for `pnpm turbo build` without a `.env` file
- `degit`/template cloning already done; do not re-initialize
- All packages use `@healthtracker/` prefix (e.g., `@healthtracker/ui`, not `@acme/ui`)
- `apps/web` (not `apps/nextjs`) — naming already done in 0-1
- The build uses `turbo.json` `globalPassThroughEnv` for `SKIP_ENV_VALIDATION` — already configured

### References

- Tamagui token system: [Source: architecture.md#Display Patterns (Tamagui + Health Data)]
- Token values: [Source: ux-design-specification.md#Visual Design Foundation]
- `unstable_enablePackageExports` requirement: [Source: architecture.md#Build Tooling]
- No-hardcoded-token enforcement: [Source: architecture.md#Tamagui Token Usage Rules]
- Sprint 0 non-negotiable #4: `metro.config.js` + `next.config.ts` Tamagui integration smoke-tested on both platforms
- AR2: Replace Tailwind/shadcn-ui with Tamagui [Source: epics.md#AR2]
- UX-DR1, UX-DR18, UX-DR19: Token definitions, dark mode tokens, amber deviation semantic separation [Source: epics.md]

## Dev Agent Record

### Agent Model Used

(to be filled by dev agent)

### Debug Log References

(to be filled by dev agent)

### Completion Notes List

(to be filled by dev agent)

### File List

(to be filled by dev agent)

### Change Log

(to be filled by dev agent)
