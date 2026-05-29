import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@supabase/supabase-js";

/**
 * Story 5.5 — service-role Supabase client for the `services/llm`
 * worker. Used by the `generate-export` consumer to upload artifacts
 * to the private `exports` bucket. RLS is bypassed; we trust the
 * worker because the patient-id path prefix is server-constructed
 * inside the consumer (mirrors the Story 1.5 `lab-uploads` precedent).
 *
 * Env vars: `NEXT_PUBLIC_SUPABASE_URL` (also accept the bare
 * `SUPABASE_URL` for non-Vercel hosts) + `SUPABASE_SERVICE_ROLE_KEY`.
 * The same vars the API server reads (`packages/api/src/storage.ts`).
 *
 * Lazy: instantiated on first call so vitest unit tests that stub
 * the consumer's `supabase` dep don't trip the env check at import.
 */
export const EXPORTS_BUCKET = "exports";

let cached: SupabaseClient | null = null;

export function getSupabaseClient(): SupabaseClient {
  if (cached) return cached;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url) {
    throw new Error(
      "[llm-service] NEXT_PUBLIC_SUPABASE_URL / SUPABASE_URL is required " +
        "for the `exports` Storage uploads.",
    );
  }
  if (!key) {
    throw new Error(
      "[llm-service] SUPABASE_SERVICE_ROLE_KEY is required for the " +
        "`exports` Storage uploads (Story 5.5).",
    );
  }
  cached = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return cached;
}
