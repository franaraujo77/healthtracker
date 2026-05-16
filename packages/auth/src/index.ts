// Supabase Auth — re-exports for convenience
// Full auth configuration (magic link, email providers) happens in Story 0.3
export { createBrowserClient, createServerClient } from "@supabase/ssr";
export { createClient } from "@supabase/supabase-js";
export type { Session, User, SupabaseClient } from "@supabase/supabase-js";
