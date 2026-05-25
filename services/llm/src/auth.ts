import { createClient } from "@supabase/supabase-js";

/**
 * Story 4.1 — Supabase JWT verification for the SSE endpoint.
 *
 * `supabase.auth.getUser(jwt)` round-trips to Supabase's verify
 * endpoint. That adds one HTTPS hop to the SSE-open path; the
 * NFR-P2 budget is "first token < 3 s from connection open", which
 * leaves comfortable headroom for the verify call (typical <100 ms).
 *
 * Returns the verified Supabase user id on success; `null` on
 * unauthenticated / invalid-token / verification error. The SSE
 * route maps `null` to a `404` (not `401`/`403`) so the existence
 * of the resource is not leaked.
 */

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  throw new Error(
    "services/llm: NEXT_PUBLIC_SUPABASE_URL + NEXT_PUBLIC_SUPABASE_ANON_KEY required for JWT verification",
  );
}

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

export async function verifyJwt(
  authHeader: string | undefined,
): Promise<string | null> {
  if (!authHeader) return null;
  const match = /^Bearer\s+(.+)$/i.exec(authHeader);
  if (!match) return null;
  const jwt = match[1];
  if (!jwt) return null;
  try {
    const { data, error } = await supabase.auth.getUser(jwt);
    if (error) return null;
    return data.user.id;
  } catch (err) {
    // Narrow — network / TypeError only; treat anything else as bad token.
    if (err instanceof TypeError) return null;
    if (err instanceof Error && /fetch|network|ECONN/i.test(err.message)) {
      return null;
    }
    throw err;
  }
}
