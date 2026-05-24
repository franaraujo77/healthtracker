import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import * as schema from "./schema";

// Why postgres-js, not @vercel/postgres:
//   The @vercel/postgres driver speaks Neon's serverless HTTP protocol
//   and only accepts Neon-flavoured pooled connection strings — it
//   refuses to talk to Supabase. This project runs on Supabase. The
//   `postgres` (postgres-js) package is the same driver
//   `services/extraction/` and the integration / RLS test harnesses
//   already use, and supports Supabase's session-mode pooler which is
//   required for RLS (the `protectedProcedure` token-principal model
//   does `SET LOCAL app.current_patient_id = …` and that GUC only
//   survives within a connection-bound session, not transaction-mode
//   pooling on port 6543 — see CLAUDE.md ops note + Story 0.4).
//
// Connection-string source:
//   - DATABASE_URL is the canonical name across this repo (.env,
//     apps/web/src/env.ts, CI workflows, services/extraction).
//   - POSTGRES_URL is honoured as a fallback so a Vercel project
//     originally configured for the Neon-style env var still works
//     without a dashboard edit.
//
// Lazy connection: `@vercel/postgres`'s `sql` export was a lazy
// tagged-template — importing it never opened a connection. Mocked
// unit tests in `packages/api/__tests__` import `db` transitively via
// `trpc.ts` and never need a real DB. To preserve that contract,
// fall back to a syntactically-valid placeholder URL when no env var
// is set: postgres-js validates the URL shape at construction but
// only attempts the TCP connect on the first actual query. The
// placeholder DSN can never resolve (`_no_database_url_/_set_`), so
// any real query path that slips through without DATABASE_URL will
// fail loudly with a connect error instead of silently succeeding.
const PLACEHOLDER_URL = "postgres://_no_database_url_/_set_";
const connectionString =
  process.env.DATABASE_URL ?? process.env.POSTGRES_URL ?? PLACEHOLDER_URL;

// `max: 1` keeps each serverless instance from blowing through Supabase's
// pooler connection limit during a cold-start burst. `prepare: false` is
// required for the transaction-mode pooler (port 6543) and harmless on
// session-mode (port 5432), so the same client works against either URL.
const client = postgres(connectionString, { max: 1, prepare: false });

export const db = drizzle(client, {
  schema,
  casing: "snake_case",
});
