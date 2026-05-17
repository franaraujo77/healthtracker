# Environment Variables Reference

All variables should be defined in `.env` at the repo root (copied from `.env.example`) before running any app or service.

## Web App (`apps/web`)

Validated at startup by `apps/web/src/env.ts` using the T3 Env / Zod schema.

| Variable                        | Scope  | Required | Default                 | Description                                                                                                                                                                                                                    | Introduced |
| ------------------------------- | ------ | -------- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------- |
| `DATABASE_URL`                  | server | no\*     | —                       | Session-mode pooler URL for Postgres. **Must be session mode, not transaction-mode PgBouncer** — required for `SET LOCAL` scoping used by the RLS transaction wrapper. Get from Supabase > Settings > Database > Session mode. | Story 0.1  |
| `CORS_ORIGIN`                   | server | no       | `http://localhost:3000` | Allowed CORS origin for tRPC requests. Set to the deployed web URL in production.                                                                                                                                              | Story 0.1  |
| `SENTRY_DSN`                    | server | no       | —                       | Sentry server-side DSN. Required to enable server error reporting.                                                                                                                                                             | Story 0.7  |
| `SENTRY_AUTH_TOKEN`             | server | no       | —                       | Sentry auth token used by the Sentry webpack plugin to upload source maps at build time.                                                                                                                                       | Story 0.7  |
| `SENTRY_ORG`                    | server | no       | —                       | Sentry organisation slug (used with `SENTRY_AUTH_TOKEN` for source map upload).                                                                                                                                                | Story 0.7  |
| `SENTRY_PROJECT`                | server | no       | —                       | Sentry project slug (used with `SENTRY_AUTH_TOKEN` for source map upload).                                                                                                                                                     | Story 0.7  |
| `NEXT_PUBLIC_SUPABASE_URL`      | client | **yes**  | —                       | Supabase project URL. Exposed to the browser via `NEXT_PUBLIC_` prefix.                                                                                                                                                        | Story 0.3  |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | client | **yes**  | —                       | Supabase anon (public) key. Safe to expose client-side; enforced by RLS.                                                                                                                                                       | Story 0.3  |
| `NEXT_PUBLIC_SENTRY_DSN`        | client | no       | —                       | Sentry client-side DSN. Required to enable browser error reporting.                                                                                                                                                            | Story 0.7  |
| `NODE_ENV`                      | shared | no       | `development`           | Runtime environment (`development` / `production` / `test`). Set automatically by Next.js and test runners.                                                                                                                    | Story 0.1  |

\*`DATABASE_URL` is marked optional in the env schema (deferred validation, Story 0.1 W9) but is required at runtime for any database operation. Omitting it in production will cause startup failures.

## Expo App (`apps/expo`)

Validated at startup by `apps/expo/src/env.ts`. All client vars require the `EXPO_PUBLIC_` prefix to be bundled by Metro.

| Variable                        | Scope  | Required | Default | Description                                                                                         | Introduced |
| ------------------------------- | ------ | -------- | ------- | --------------------------------------------------------------------------------------------------- | ---------- |
| `EXPO_PUBLIC_SUPABASE_URL`      | client | **yes**  | —       | Supabase project URL. Must use `EXPO_PUBLIC_` prefix — Metro strips other env vars from the bundle. | Story 0.3  |
| `EXPO_PUBLIC_SUPABASE_ANON_KEY` | client | **yes**  | —       | Supabase anon key. Safe to expose client-side; enforced by RLS.                                     | Story 0.3  |
| `EXPO_PUBLIC_SENTRY_DSN`        | client | no       | —       | Sentry DSN for Expo/React Native error reporting.                                                   | Story 0.7  |

## Extraction Worker (`services/extraction/`)

| Variable              | Scope  | Required              | Default | Description                                                                                                                                                                                                                                                                 | Introduced |
| --------------------- | ------ | --------------------- | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| `WORKER_DATABASE_URL` | server | **yes** (worker only) | —       | Direct (non-pooled) Postgres connection URL for pg-boss. **Must NOT use PgBouncer or any connection pooler** — pg-boss uses advisory locks and `LISTEN/NOTIFY` which are incompatible with pooled connections. Get from Supabase > Settings > Database > Direct connection. | Story 0.5  |

## Auth Package (`packages/auth`)

| Variable                    | Scope  | Required | Default | Description                                                                                                                              | Introduced |
| --------------------------- | ------ | -------- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| `SUPABASE_SERVICE_ROLE_KEY` | server | **yes**  | —       | Supabase service role key for admin operations (bypasses RLS). Never expose client-side. Used only in `packages/auth/` server utilities. | Story 0.3  |

---

## Notes

### Why session-mode pooler for `DATABASE_URL`

The RLS transaction wrapper issues `SET LOCAL role` and `SET LOCAL request.jwt.claims` to configure the Postgres session before running queries. `SET LOCAL` only persists for the duration of the current transaction. Transaction-mode PgBouncer returns connections to the pool between statements, which means a `SET LOCAL` issued in one statement may not apply to the next — breaking RLS enforcement. Session-mode pooler keeps the connection open for the lifetime of the server process, preserving `SET LOCAL` scoping correctly.

### Why `WORKER_DATABASE_URL` must be a direct connection

pg-boss relies on Postgres advisory locks (`pg_advisory_lock`) and `LISTEN/NOTIFY` for job coordination. PgBouncer in transaction mode does not support session-level advisory locks (the lock is released when the connection is returned to the pool) and does not persist `LISTEN` registrations across borrowed connections. A direct connection (or session-mode pooler) is required. Use the "Direct connection" string from Supabase, not the pooler string.

### `DATABASE_URL` optional schema vs. runtime requirement

`DATABASE_URL` is declared optional in the T3 Env schema (a deferred workaround from Story 0.1, tracked as W9) to allow the Next.js build to complete without a live database connection (e.g., in CI preview builds). At runtime, any tRPC procedure or server component that touches the database will fail immediately if `DATABASE_URL` is absent. It must be set in all deployed environments.
