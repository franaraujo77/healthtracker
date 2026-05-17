# Story 0.7: Configure Sentry Error Tracking with PII Scrubbing

Status: done

## Story

As a developer,
I want Sentry configured across Expo and Next.js with a `beforeSend` hook that strips all PII before transmission,
so that crash reporting works without sending biomarker values, patient identifiers, or LOINC codes to Sentry's servers.

## Acceptance Criteria

1. **Given** Sentry is initialized in `apps/expo` and `apps/web`,
   **When** an unhandled exception is thrown with a payload containing `patient_id`, `loinc_code`, or a biomarker value,
   **Then** the `beforeSend` hook removes those fields before the event is transmitted, verifiable in a Sentry test event.

2. **Given** the `beforeSend` hook is configured,
   **When** it is inspected,
   **Then** the scrub list covers: `patient_id`, `loinc_code`, `value_numeric`, `unit_ucum`, email, phone, and full name fields.

3. **Given** the scrubbing is deployed,
   **When** a production error event arrives in Sentry,
   **Then** no raw biomarker values or personal identifiers appear in the event payload, breadcrumbs, or extra context.

4. **Given** Sentry is used for crash reporting,
   **When** a third-party analytics SDK is evaluated,
   **Then** no SDK that receives raw health data or patient identifiers is added to either app.

## Tasks / Subtasks

- [x] Task 1: Create `packages/config` package with shared Sentry PII scrubbing hook (AC: #1, #2, #3)
  - [x] Create `packages/config/package.json` — `name: "@healthtracker/config"`, exports `"."` pointing to `"./src/sentry.ts"`, scripts: `test: vitest run`, `typecheck: tsc --noEmit`
  - [x] Create `packages/config/tsconfig.json` extending `../../tooling/typescript/base.json` (match pattern used by `packages/ui`)
  - [x] Create `packages/config/src/sentry.ts` — export `sentryBeforeSend(event, hint?)` that deep-scrubs PII keys from `extra`, `user`, `contexts`, breadcrumb data, and request body (see Dev Notes for full implementation)
  - [x] Create `packages/config/src/sentry.test.ts` — Vitest unit tests covering every scrub path: `patient_id` in extra, `loinc_code` in breadcrumb data, `value_numeric`/`unit_ucum` in extra, `user.email`, `user.name`, request body redaction, and pass-through for non-PII events (see Dev Notes for test skeletons)
  - [x] Create `packages/config/vitest.config.ts` following the same pattern as `packages/db/vitest.config.ts` (globals: true, passWithNoTests: true)
  - [x] Add `"@healthtracker/config": "workspace:*"` to the package's own `package.json`; `packages/*` glob in `pnpm-workspace.yaml` already covers it — no `pnpm-workspace.yaml` changes needed
  - [x] Run `pnpm install` to register the new package
  - [x] Run `pnpm --filter @healthtracker/config test` — all unit tests pass

- [x] Task 2: Install and configure Sentry in `apps/web` (Next.js 15) (AC: #1, #2, #3)
  - [x] Add `@sentry/nextjs: ^10.53.1` to the pnpm catalog in `pnpm-workspace.yaml`
  - [x] Add `@sentry/nextjs: "catalog:"` to `apps/web/package.json` dependencies; add `@healthtracker/config: "workspace:*"` to `apps/web/package.json` dependencies
  - [x] Run `pnpm install`
  - [x] Create `apps/web/sentry.client.config.ts` — `Sentry.init` with `NEXT_PUBLIC_SENTRY_DSN`, `tracesSampleRate: 0.1`, `beforeSend: sentryBeforeSend` from `@healthtracker/config`; NO session replay integration (health data risk)
  - [x] Create `apps/web/sentry.server.config.ts` — `Sentry.init` with `SENTRY_DSN` (server-only, no NEXT_PUBLIC prefix), `tracesSampleRate: 0.1`, same `beforeSend`
  - [x] Create `apps/web/sentry.edge.config.ts` — `Sentry.init` with `NEXT_PUBLIC_SENTRY_DSN`, `tracesSampleRate: 0.1`, same `beforeSend`
  - [x] Create `apps/web/src/instrumentation.ts` — implement `register()` conditionally importing server/edge config by `process.env.NEXT_RUNTIME`; export `onRequestError = Sentry.captureRequestError` (required for Next.js 15 server error capture)
  - [x] Wrap `apps/web/next.config.js` export with `withSentryConfig` from `@sentry/nextjs`; add `@healthtracker/config` to `transpilePackages` array; set `sourcemaps: { disable: !process.env.SENTRY_AUTH_TOKEN }` so source map upload is skipped when token is absent (see Dev Notes for full config)
  - [x] Add `NEXT_PUBLIC_SENTRY_DSN` (client, `z.string().optional()`) and `SENTRY_DSN` (server, `z.string().optional()`) to `apps/web/src/env.ts`; add `NEXT_PUBLIC_SENTRY_DSN` to `experimental__runtimeEnv`

- [x] Task 3: Install and configure Sentry in `apps/expo` (React Native / Expo SDK 54) (AC: #1, #2, #3)
  - [x] Add `@sentry/react-native: ^8.11.1` to the pnpm catalog in `pnpm-workspace.yaml`
  - [x] Add `@sentry/react-native: "catalog:"` to `apps/expo/package.json` dependencies; add `@healthtracker/config: "workspace:*"` to `apps/expo/package.json` dependencies
  - [x] Run `pnpm install`
  - [x] Wrap the existing config in `apps/expo/metro.config.js` with `withSentryConfig` from `@sentry/react-native/metro` as the outermost call (after `unstable_enablePackageExports` assignment — see Dev Notes to ensure it is not reset)
  - [x] Add `Sentry.init(...)` at module scope in `apps/expo/src/app/_layout.tsx` (before the component function) with `EXPO_PUBLIC_SENTRY_DSN`, `tracesSampleRate: 0.1`, `enableNativeCrashHandling: true`, `debug: __DEV__`, `beforeSend: sentryBeforeSend` from `@healthtracker/config`; NO session replay
  - [x] Change `export default RootLayout` → `export default Sentry.wrap(RootLayout)` in `apps/expo/src/app/_layout.tsx`
  - [x] Add `EXPO_PUBLIC_SENTRY_DSN` to `apps/expo/src/env.ts` using the optional (no-throw) pattern — return `undefined` when absent so Sentry silently no-ops in local dev

- [x] Task 4: Update environment configuration (AC: #1, #2)
  - [x] Add Sentry DSN placeholders to `.env.example`:
    ```
    # Sentry — get DSN from Sentry dashboard > Settings > Projects > Client Keys
    NEXT_PUBLIC_SENTRY_DSN=""
    SENTRY_DSN=""
    SENTRY_AUTH_TOKEN=""
    SENTRY_ORG=""
    SENTRY_PROJECT=""
    EXPO_PUBLIC_SENTRY_DSN=""
    ```
  - [x] Add `SENTRY_AUTH_TOKEN`, `SENTRY_ORG`, `SENTRY_PROJECT` as optional secret references in `.github/workflows/ci.yml` (document as `# Optional: enables Sentry source map upload` comments; do not fail CI if absent)

- [x] Task 5: Verify build and tests (AC: #1, #2, #3, #4)
  - [x] Run `pnpm --filter @healthtracker/config test` — all unit tests pass
  - [x] Run `pnpm typecheck` — no TypeScript errors in new files
  - [x] Run `pnpm lint` — no lint errors
  - [x] Run `SKIP_ENV_VALIDATION=1 pnpm turbo build` — all packages build successfully
  - [x] Verify `apps/expo/metro.config.js` still starts: run `pnpm dev` in `apps/expo` and confirm no Metro resolver errors (Sentry Metro wrapper must not undo `unstable_enablePackageExports: true`)

## Dev Notes

### Architecture Requirements

- **AR13** (launch blocker): Sentry `beforeSend` must strip `patient_id`, `loinc_code`, `value_numeric`, `unit_ucum`, email, phone, and full name before any event is transmitted. Never deploy with raw biomarker values reachable by Sentry. [Source: planning-artifacts/epics.md#L148]
- **NFR-S5**: No third-party analytics/crash/telemetry SDK may receive raw biomarker values or patient identifiers. Specifically, session replay must NOT be enabled. [Source: planning-artifacts/epics.md#L101]
- **Canonical location**: `packages/config/src/sentry.ts` per architecture cross-cutting concerns table. [Source: planning-artifacts/architecture.md#L1279]
- **Sentry external integration**: Sentry is PII-scrubbed; EU/US region. DPA is implicitly satisfied by the `beforeSend` scrubbing layer. [Source: planning-artifacts/architecture.md#L1304]

### `packages/config` — new package, does not exist yet

This story creates `packages/config` as a new package. The architecture lists it as owning ESLint, TypeScript, Prettier, and Sentry configs — but ESLint/TypeScript/Prettier configs already live in `tooling/` and must NOT be moved (out of scope). Create only the Sentry module for now.

```
packages/config/
├── package.json          ← name: "@healthtracker/config", private: true
├── tsconfig.json
├── vitest.config.ts
└── src/
    ├── sentry.ts
    └── sentry.test.ts
```

`package.json`:

```json
{
  "name": "@healthtracker/config",
  "version": "0.1.0",
  "private": true,
  "exports": {
    ".": "./src/sentry.ts"
  },
  "scripts": {
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  },
  "devDependencies": {
    "@healthtracker/tsconfig": "workspace:*",
    "typescript": "catalog:",
    "vitest": "catalog:"
  }
}
```

No runtime dependencies — the `beforeSend` function uses duck-typed interfaces, not imported Sentry types, to avoid coupling `packages/config` to a specific Sentry SDK version.

### `sentryBeforeSend` implementation

```typescript
// packages/config/src/sentry.ts

const PII_KEYS = new Set([
  "patient_id",
  "loinc_code",
  "value_numeric",
  "unit_ucum",
  "email",
  "phone",
  "full_name",
  "name",
]);

interface SentryEvent {
  user?: Record<string, unknown>;
  extra?: Record<string, unknown>;
  contexts?: Record<string, Record<string, unknown>>;
  breadcrumbs?: { values?: Array<{ data?: Record<string, unknown> }> };
  request?: { data?: unknown; headers?: Record<string, string> };
  tags?: Record<string, string>;
}

function scrubObject(obj: Record<string, unknown>): Record<string, unknown> {
  const result = { ...obj };
  for (const key of PII_KEYS) {
    if (key in result) delete result[key];
  }
  return result;
}

export function sentryBeforeSend(event: SentryEvent): SentryEvent | null {
  if (event.user) {
    event.user = scrubObject(event.user as Record<string, unknown>);
  }
  if (event.extra) {
    event.extra = scrubObject(event.extra);
  }
  if (event.contexts) {
    for (const ctxKey of Object.keys(event.contexts)) {
      const ctx = event.contexts[ctxKey];
      if (ctx && typeof ctx === "object") {
        event.contexts[ctxKey] = scrubObject(ctx as Record<string, unknown>);
      }
    }
  }
  if (event.breadcrumbs?.values) {
    event.breadcrumbs.values = event.breadcrumbs.values.map((crumb) => ({
      ...crumb,
      data: crumb.data ? scrubObject(crumb.data) : crumb.data,
    }));
  }
  // Redact entire request body — may contain biomarker values posted via form/API
  if (event.request?.data !== undefined) {
    event.request.data = "[Scrubbed]";
  }
  return event;
}
```

The function signature is compatible with Sentry's `beforeSend` config option which accepts `(event: Event, hint: EventHint) => Event | null`. The `hint` parameter is omitted here — TypeScript accepts fewer parameters than declared in a callback type.

### Unit test skeleton for `packages/config/src/sentry.test.ts`

```typescript
import { describe, expect, it } from "vitest";

import { sentryBeforeSend } from "./sentry";

describe("sentryBeforeSend", () => {
  it("scrubs patient_id from extra", () => {
    const event = { extra: { patient_id: "uuid-123", error_code: "E001" } };
    const result = sentryBeforeSend(event as any);
    expect(result?.extra).not.toHaveProperty("patient_id");
    expect(result?.extra).toHaveProperty("error_code", "E001");
  });

  it("scrubs loinc_code from breadcrumb data", () => {
    const event = {
      breadcrumbs: {
        values: [{ data: { loinc_code: "2345-7", label: "fetch" } }],
      },
    };
    const result = sentryBeforeSend(event as any);
    expect(result?.breadcrumbs?.values?.[0]?.data).not.toHaveProperty(
      "loinc_code",
    );
    expect(result?.breadcrumbs?.values?.[0]?.data).toHaveProperty(
      "label",
      "fetch",
    );
  });

  it("scrubs value_numeric and unit_ucum from extra", () => {
    const event = {
      extra: {
        value_numeric: 5.2,
        unit_ucum: "mmol/L",
        biomarker_label: "glucose",
      },
    };
    const result = sentryBeforeSend(event as any);
    expect(result?.extra).not.toHaveProperty("value_numeric");
    expect(result?.extra).not.toHaveProperty("unit_ucum");
    expect(result?.extra).toHaveProperty("biomarker_label");
  });

  it("scrubs user email and name, keeps id", () => {
    const event = {
      user: { id: "u1", email: "patient@example.com", name: "João" },
    };
    const result = sentryBeforeSend(event as any);
    expect(result?.user).not.toHaveProperty("email");
    expect(result?.user).not.toHaveProperty("name");
    expect(result?.user).toHaveProperty("id", "u1");
  });

  it("redacts request body entirely", () => {
    const event = {
      request: { data: { patient_id: "uuid", value_numeric: 5.2 } },
    };
    const result = sentryBeforeSend(event as any);
    expect(result?.request?.data).toBe("[Scrubbed]");
  });

  it("passes through events with no PII unchanged", () => {
    const event = {
      tags: { env: "production" },
      extra: { request_id: "req-abc" },
    };
    const result = sentryBeforeSend(event as any);
    expect(result?.tags).toEqual({ env: "production" });
    expect(result?.extra).toEqual({ request_id: "req-abc" });
  });

  it("scrubs PII from all contexts bags", () => {
    const event = {
      contexts: {
        patient: { patient_id: "uuid-123", region: "sp" },
        runtime: { name: "node", version: "20" },
      },
    };
    const result = sentryBeforeSend(event as any);
    expect(result?.contexts?.patient).not.toHaveProperty("patient_id");
    expect(result?.contexts?.patient).toHaveProperty("region", "sp");
    expect(result?.contexts?.runtime).toHaveProperty("name", "node");
  });
});
```

### SDK versions (as of 2026-05)

| SDK                    | Version    | Notes                                                           |
| ---------------------- | ---------- | --------------------------------------------------------------- |
| `@sentry/nextjs`       | `^10.53.1` | Requires `instrumentation.ts` + `onRequestError` for Next.js 15 |
| `@sentry/react-native` | `^8.11.1`  | Expo SDK 54 / React Native 0.81.5 fully supported               |

### Next.js 15 — three config files + `instrumentation.ts`

The old `_error.tsx` error boundary pattern is deprecated. Four files are required:

**`apps/web/sentry.client.config.ts`**:

```typescript
import * as Sentry from "@sentry/nextjs";

import { sentryBeforeSend } from "@healthtracker/config";

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  tracesSampleRate: 0.1,
  beforeSend: sentryBeforeSend,
  // Session replay intentionally omitted — health data on screen could appear in replays (NFR-S5)
});
```

**`apps/web/sentry.server.config.ts`**:

```typescript
import * as Sentry from "@sentry/nextjs";

import { sentryBeforeSend } from "@healthtracker/config";

Sentry.init({
  dsn: process.env.SENTRY_DSN, // server-only, no NEXT_PUBLIC_ prefix
  tracesSampleRate: 0.1,
  beforeSend: sentryBeforeSend,
});
```

**`apps/web/sentry.edge.config.ts`**: same as client config.

**`apps/web/src/instrumentation.ts`**:

```typescript
import * as Sentry from "@sentry/nextjs";

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("../sentry.server.config");
  }
  if (process.env.NEXT_RUNTIME === "edge") {
    await import("../sentry.edge.config");
  }
}

export const onRequestError = Sentry.captureRequestError;
```

`instrumentation.ts` must live at `apps/web/src/instrumentation.ts` because this project uses the `src/` layout.

### `withSentryConfig` in `next.config.js`

```javascript
import { withSentryConfig } from "@sentry/nextjs";

const config = {
  transpilePackages: [
    "@healthtracker/api",
    "@healthtracker/auth",
    "@healthtracker/config", // ← add this
    "@healthtracker/db",
    "@healthtracker/ui",
    "@healthtracker/validators",
  ],
  // ... existing config ...
};

export default withSentryConfig(config, {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,
  tunnelRoute: "/monitoring",
  silent: !process.env.CI,
  sourcemaps: { disable: !process.env.SENTRY_AUTH_TOKEN },
});
```

`SENTRY_ORG` and `SENTRY_PROJECT` can be empty strings for now — source map upload only runs when `SENTRY_AUTH_TOKEN` is set.

### DSN env var conventions

| Context                  | Env var                  | Reason                                                         |
| ------------------------ | ------------------------ | -------------------------------------------------------------- |
| `apps/web` client bundle | `NEXT_PUBLIC_SENTRY_DSN` | Must have `NEXT_PUBLIC_` prefix to be inlined by Next.js       |
| `apps/web` server/edge   | `SENTRY_DSN`             | Server-only; no `NEXT_PUBLIC_` prefix prevents client exposure |
| `apps/expo`              | `EXPO_PUBLIC_SENTRY_DSN` | Must have `EXPO_PUBLIC_` prefix for Metro inlining             |

All DSN vars are optional — Sentry silently no-ops when `dsn` is `undefined` or an empty string.

**In `apps/web/src/env.ts`**, add to the appropriate sections:

```typescript
server: {
  // ... existing ...
  SENTRY_DSN: z.string().optional(),
},
client: {
  // ... existing ...
  NEXT_PUBLIC_SENTRY_DSN: z.string().optional(),
},
experimental__runtimeEnv: {
  // ... existing ...
  NEXT_PUBLIC_SENTRY_DSN: process.env.NEXT_PUBLIC_SENTRY_DSN,
},
```

**In `apps/expo/src/env.ts`**, add the optional pattern (no-throw when absent):

```typescript
export const env = {
  // ... existing ...
  EXPO_PUBLIC_SENTRY_DSN: process.env.EXPO_PUBLIC_SENTRY_DSN, // undefined = Sentry no-ops
} as const;
```

### Expo `metro.config.js` — preserve `unstable_enablePackageExports`

`unstable_enablePackageExports: true` was added in story 0-2 and is required for Tamagui. The Sentry Metro plugin wraps the config object — if it resets this flag, re-assign after the wrapper call:

```javascript
const { withSentryConfig } = require("@sentry/react-native/metro");

// ... existing FileStore and unstable_enablePackageExports setup ...

let finalConfig = withSentryConfig(config);

// Restore Tamagui requirement if Sentry wrapper reset it
finalConfig.resolver.unstable_enablePackageExports = true;

module.exports = finalConfig;
```

### Expo `_layout.tsx` — Sentry.init must precede first render

`Sentry.init()` must be called at **module scope** (top-level, before the component function body), not inside `useEffect`. The existing layout has `TamaguiProvider` and `QueryClientProvider` — preserve those intact:

```typescript
import * as Sentry from "@sentry/react-native";

import { sentryBeforeSend } from "@healthtracker/config";

// ... existing imports ...

Sentry.init({
  dsn: process.env.EXPO_PUBLIC_SENTRY_DSN,
  tracesSampleRate: 0.1,
  enableNativeCrashHandling: true,
  debug: __DEV__,
  beforeSend: sentryBeforeSend,
  // Session replay omitted — health data on screen risk (NFR-S5)
});

function RootLayout() {
  // ... existing component, unchanged ...
}

export default Sentry.wrap(RootLayout);
```

### Vitest workspace registration

The `vitest.workspace.ts` at the repo root (created in story 0-6) needs `packages/config` added to it so `pnpm test` from the root includes the new package's tests. Check the current `vitest.workspace.ts` and add an entry for `packages/config/vitest.config.ts`.

### Session replay is explicitly excluded

NFR-S5 prohibits any SDK that receives raw health data or patient identifiers. Session replay captures screenshots of the screen — even with scrubbing, a biomarker chart or lab result could appear in a replay frame. **Do not add `Sentry.replayIntegration()`** to either app's Sentry config.

### Previous story learnings

- Story 0-2: `@tamagui/next-plugin` excluded from `next.config.js` (incompatible with Next.js 15). Do NOT re-add it.
- Story 0-2: `"use client"` required for React components imported into Next.js App Router from workspace packages. `packages/config/src/sentry.ts` is a pure utility (no React) — no `"use client"` directive needed.
- Story 0-1 review: `apps/web/src/env.ts` uses `@t3-oss/env-nextjs` + Zod for env validation. All new web env vars must follow this pattern (declared in `server`/`client` sections + `experimental__runtimeEnv`).
- Story 0-1 review: Expo env vars use a custom `get()` helper in `apps/expo/src/env.ts` that throws when absent. For optional vars like `EXPO_PUBLIC_SENTRY_DSN`, use a no-throw pattern instead.
- Story 0-6: `vitest` is in the pnpm catalog (`vitest: catalog:`). Use `"vitest": "catalog:"` in devDependencies — do not pin a version directly.
- Story 0-6: `vitest.workspace.ts` exists at repo root and must be updated to include `packages/config`.

### Project Structure Notes

The architecture uses `apps/next` as shorthand in diagrams; the actual directory is `apps/web`. Use `apps/web` everywhere.

**New files:**

- `packages/config/package.json`
- `packages/config/tsconfig.json`
- `packages/config/vitest.config.ts`
- `packages/config/src/sentry.ts`
- `packages/config/src/sentry.test.ts`
- `apps/web/sentry.client.config.ts`
- `apps/web/sentry.server.config.ts`
- `apps/web/sentry.edge.config.ts`
- `apps/web/src/instrumentation.ts`

**Modified files:**

- `apps/web/next.config.js` — `withSentryConfig` wrapper + `@healthtracker/config` in `transpilePackages`
- `apps/web/src/env.ts` — add optional `NEXT_PUBLIC_SENTRY_DSN` (client) + `SENTRY_DSN` (server)
- `apps/expo/metro.config.js` — `withSentryConfig` wrapper (Sentry Metro plugin)
- `apps/expo/src/app/_layout.tsx` — `Sentry.init` at module scope + `Sentry.wrap` export
- `apps/expo/src/env.ts` — add optional `EXPO_PUBLIC_SENTRY_DSN`
- `.env.example` — add Sentry DSN placeholders
- `pnpm-workspace.yaml` — add `@sentry/nextjs` and `@sentry/react-native` to catalog
- `vitest.workspace.ts` — add `packages/config/vitest.config.ts`
- `.github/workflows/ci.yml` — optional Sentry secret references (doc only, no CI changes required)

### References

- [Source: planning-artifacts/epics.md#Story-0.7, L458-482] — Full story, ACs, requirements AR13, NFR-S5
- [Source: planning-artifacts/epics.md#L101] — NFR-S5 definition
- [Source: planning-artifacts/epics.md#L148] — AR13 definition
- [Source: planning-artifacts/architecture.md#L506-515] — Monitoring & Error Tracking ADR
- [Source: planning-artifacts/architecture.md#L1279] — PII scrubbing canonical location
- [Source: planning-artifacts/architecture.md#L601] — `packages/config` ownership table
- [Source: planning-artifacts/architecture.md#L1304] — Sentry in external integrations table
- [Source: implementation-artifacts/0-2-configure-tamagui-design-system-with-health-tracker-tokens.md] — Tamagui/Next.js 15 compat notes; `unstable_enablePackageExports` requirement
- [Source: implementation-artifacts/0-6-set-up-github-actions-ci-cd-pipeline.md] — Vitest catalog setup; `vitest.workspace.ts` structure
- [Source: Sentry docs research] — @sentry/nextjs v10.53.1: `instrumentation.ts` + 3-file pattern for Next.js 15
- [Source: Sentry docs research] — @sentry/react-native v8.11.1: Expo SDK 54 supported; `Sentry.wrap()` for root layout

## Dev Agent Record

### Agent Model Used

claude-sonnet-4-6

### Debug Log References

None — implementation completed without issues.

### Completion Notes List

- Created `packages/config` package with `sentryBeforeSend` PII scrubbing hook. Uses duck-typed interfaces (no Sentry SDK runtime dependency) to avoid version coupling. Split PII keys into user-specific set (`USER_PII_KEYS` includes `name`) and general set (`PII_KEYS` excludes `name`) to avoid scrubbing non-PII `name` fields in SDK contexts like `runtime.name`.
- Configured `@sentry/nextjs` in `apps/web` with 3-file pattern (client/server/edge) + `instrumentation.ts` for Next.js 15 server error capture. `NEXT_RUNTIME` env reads via `process.env` with eslint disable (framework variable, not user config). `withSentryConfig` wraps next.config.js; source maps disabled unless `SENTRY_AUTH_TOKEN` present.
- Configured `@sentry/react-native` in `apps/expo`. `withSentryConfig` Metro wrapper applied; `unstable_enablePackageExports: true` explicitly re-asserted after wrap to protect Tamagui. `Sentry.init` at module scope before first render; `Sentry.wrap(RootLayout)` as default export.
- Session replay explicitly excluded from both apps per NFR-S5 (health data on screen risk).
- Added `test:unit` script alongside `test` in `packages/config` so `turbo run test:unit` includes it.
- Added Sentry env vars to turbo.json `globalEnv` to pass lint.

### Review Findings

- [x] [Review][Decision] `name` key not scrubbed outside user context — resolved: keep `name` scrubbed only in user identity bag; `runtime.name`/`browser.name` in SDK contexts are not PII
- [x] [Review][Patch] `vitest.workspace.ts` not updated — resolved: glob `packages/*/vitest.config.ts` already covers `packages/config` (false positive)
- [x] [Review][Patch] `SENTRY_DSN` missing from `turbo.json` globalEnv — resolved: already present (false positive)
- [x] [Review][Patch] `packages/config` has no `lint` script — fixed: added `lint` script to `packages/config/package.json`
- [x] [Review][Patch] Import ordering in `_layout.tsx` — resolved: Prettier commit hook reordered imports before `Sentry.init()` (self-healing)
- [x] [Review][Patch] `event.tags` not scrubbed in `sentryBeforeSend` — fixed: added tags scrubbing in `sentryBeforeSend` [packages/config/src/sentry.ts]
- [x] [Review][Patch] `sentry.edge.config.ts` uses `NEXT_PUBLIC_SENTRY_DSN` — fixed: changed to `SENTRY_DSN` [apps/web/sentry.edge.config.ts]
- [x] [Review][Patch] Request headers not scrubbed — fixed: added `SENSITIVE_HEADERS` set and header scrubbing in `sentryBeforeSend` [packages/config/src/sentry.ts]
- [x] [Review][Patch] Nested PII not scrubbed — fixed: `scrubObject` now recurses up to depth 3 [packages/config/src/sentry.ts]
- [x] [Review][Defer] Breadcrumb `message` string not scanned for PII [packages/config/src/sentry.ts] — deferred, freeform strings require regex/NLP approach, out of scope
- [x] [Review][Defer] Exception message/value strings not scanned for PII [packages/config/src/sentry.ts] — deferred, out of scope
- [x] [Review][Defer] `sentryBeforeSend` mutates incoming event object [packages/config/src/sentry.ts] — deferred, Sentry doesn't reuse event references in practice
- [x] [Review][Defer] PII key list has no governance path — new data model fields won't be auto-detected [packages/config/src/sentry.ts] — deferred, process issue not code issue
- [x] [Review][Defer] `tracesSampleRate: 0.1` not environment-aware — traces sent from dev/staging [apps/web/sentry.*.config.ts] — deferred, acceptable for now
- [x] [Review][Defer] Metro `unstable_enablePackageExports` override fragile — future Sentry wrapper change may silently break [apps/expo/metro.config.js] — deferred, documented and current impl works

### Change Log

- 2026-05-17: Story 0-7 implementation — Sentry PII-scrubbed error tracking across web and expo apps

### File List

New files:

- `packages/config/package.json`
- `packages/config/tsconfig.json`
- `packages/config/vitest.config.ts`
- `packages/config/src/sentry.ts`
- `packages/config/src/sentry.test.ts`
- `apps/web/sentry.client.config.ts`
- `apps/web/sentry.server.config.ts`
- `apps/web/sentry.edge.config.ts`
- `apps/web/src/instrumentation.ts`

Modified files:

- `apps/web/next.config.js` — `withSentryConfig` wrapper + `@healthtracker/config` in `transpilePackages`
- `apps/web/src/env.ts` — added optional `NEXT_PUBLIC_SENTRY_DSN` (client) + `SENTRY_DSN` (server)
- `apps/web/package.json` — added `@sentry/nextjs` and `@healthtracker/config` dependencies
- `apps/expo/metro.config.js` — `withSentryConfig` wrapper + `unstable_enablePackageExports` re-assertion
- `apps/expo/src/app/_layout.tsx` — `Sentry.init` at module scope + `Sentry.wrap` export
- `apps/expo/src/env.ts` — added optional `EXPO_PUBLIC_SENTRY_DSN`
- `apps/expo/package.json` — added `@sentry/react-native` and `@healthtracker/config` dependencies
- `.env.example` — added Sentry DSN placeholders
- `pnpm-workspace.yaml` — added `@sentry/nextjs` and `@sentry/react-native` to catalog
- `turbo.json` — added Sentry env vars to `globalEnv` + `NEXT_RUNTIME`
- `.github/workflows/ci.yml` — added optional Sentry source map upload secrets to a11y build step
- `_bmad-output/implementation-artifacts/sprint-status.yaml` — story status updated to review
