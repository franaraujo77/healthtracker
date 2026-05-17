import type { SetAllCookies } from "@supabase/ssr";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";

import { env } from "~/env";

export async function middleware(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (cookiesToSet: Parameters<SetAllCookies>[0]) => {
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value);
          }
          supabaseResponse = NextResponse.next({ request });
          for (const { name, value, options } of cookiesToSet) {
            supabaseResponse.cookies.set(name, value, options);
          }
        },
      },
    },
  );

  // Must use getUser() not getSession() — validates JWT server-side and refreshes the session
  await supabase.auth.getUser();

  return supabaseResponse;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|api/trpc|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
