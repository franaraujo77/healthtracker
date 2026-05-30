import "server-only";

import type { SetAllCookies } from "@supabase/ssr";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";

import { authEnv } from "../env";

const env = authEnv();

export const createSupabaseServerClient = async () => {
  const cookieStore = await cookies();
  return createServerClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (cookiesToSet: Parameters<SetAllCookies>[0]) => {
          try {
            for (const { name, value, options } of cookiesToSet) {
              cookieStore.set(name, value, options);
            }
          } catch {
            // setAll called from Server Component — cookies cannot be set
            // This is safe to ignore in middleware which handles session refresh
          }
        },
      },
    },
  );
};

export const getSession = async () => {
  const supabase = await createSupabaseServerClient();
  // getUser() re-validates the JWT server-side; getSession() alone trusts the cookie
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();
  if (error ?? !user) return null;
  const {
    data: { session },
  } = await supabase.auth.getSession();
  return session;
};

/**
 * RSC helper for authenticated `apps/web` pages that need to build a
 * tRPC caller. Re-validates the JWT via `getUser()` (the only reliable
 * way to know the cookie still belongs to a live user); then prefers
 * the real `getSession()` row but falls back to a verified-user
 * synthetic shape if Supabase has stale-session edge cases.
 *
 * Returns `null` when the user is not authenticated — callers must
 * `redirect()` in that branch.
 *
 * R1-followup MEDIUM-4 (Story 6.5): consolidates the previously
 * duplicated synthetic-session fallback (lived in
 * `m/[token]/view/page.tsx` and `profissional/configuracoes/limiares/page.tsx`)
 * into a single helper. The synthetic fallback exists because
 * tRPC procedure middlewares today only read `session.user`; an
 * absent `access_token` is acceptable. Story 6.6 may harden the
 * Supabase client itself and remove the need for the fallback.
 */
export const getVerifiedSessionForCaller = async () => {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const {
    data: { session },
  } = await supabase.auth.getSession();
  return (
    session ??
    ({
      access_token: "",
      refresh_token: "",
      expires_in: 0,
      token_type: "bearer",
      user,
    } as unknown as NonNullable<typeof session>)
  );
};
