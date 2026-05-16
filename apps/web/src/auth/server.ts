import "server-only";

import { cache } from "react";

import { createSupabaseServerClient } from "@healthtracker/auth/server";

export { createSupabaseServerClient };

export const getSession = cache(async () => {
  const supabase = await createSupabaseServerClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  return session;
});
