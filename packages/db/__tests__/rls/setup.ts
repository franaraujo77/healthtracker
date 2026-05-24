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
