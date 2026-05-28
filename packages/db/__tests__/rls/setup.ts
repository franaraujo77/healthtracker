// Requires: supabase start (Supabase CLI). Do NOT include in pnpm test.
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.SUPABASE_URL ?? "http://localhost:54321";

const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!serviceRoleKey) {
  throw new Error(
    "SUPABASE_SERVICE_ROLE_KEY is not set. Run: supabase start, then set env vars.",
  );
}

// Service role client — bypasses RLS for seeding test data.
export const serviceClient = createClient(supabaseUrl, serviceRoleKey);

// Anon client — subject to RLS, used to verify unauthenticated access is blocked.
export const anonClient = createClient(
  supabaseUrl,
  process.env.SUPABASE_ANON_KEY ?? "",
);

/**
 * Seed a `users` row so that patient-scoped FK references (Story 5.6
 * added `onDelete: 'cascade'` FKs from patient-scoped tables to users(id))
 * don't fail with foreign-key violations during RLS test setup. Returns
 * the seeded id (the caller passes it in, so the return is purely a
 * convenience for chaining).
 */
export async function seedUser(id: string): Promise<string> {
  const { error } = await serviceClient.from("users").insert({ id });
  if (error && !error.message.includes("duplicate")) {
    throw new Error(`users seed failed: ${error.message}`);
  }
  return id;
}

/**
 * Delete previously-seeded users rows. Cascade FKs (Story 5.6) reap any
 * patient-scoped rows that referenced these users, so callers do NOT
 * need to manually delete those rows first.
 */
export async function cleanupSeededUsers(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  await serviceClient.from("users").delete().in("id", ids);
}
