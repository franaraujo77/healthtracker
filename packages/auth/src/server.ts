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
