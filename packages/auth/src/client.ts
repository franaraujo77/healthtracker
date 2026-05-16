import { createBrowserClient } from "@supabase/ssr";

import { authEnv } from "../env";

const env = authEnv();

export const createSupabaseBrowserClient = () =>
  createBrowserClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  );
