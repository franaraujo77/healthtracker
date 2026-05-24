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
const connectionString = process.env.DATABASE_URL ?? process.env.POSTGRES_URL;
if (!connectionString) {
  throw new Error(
    "Missing DATABASE_URL (or POSTGRES_URL) — required by @healthtracker/db client",
  );
}

// Vercel serverless functions are short-lived; cap the per-instance
// connection count low so a burst of cold starts doesn't blow through
// Supabase's pooler connection limit. `prepare: false` is required when
// pointing at Supabase's transaction-mode pooler (port 6543) and is
// harmless on the session-mode pooler (port 5432) — leaving it on means
// the same client works against either pooler URL.
const client = postgres(connectionString, {
  max: 1,
  prepare: false,
});

export const db = drizzle(client, {
  schema,
  casing: "snake_case",
});
