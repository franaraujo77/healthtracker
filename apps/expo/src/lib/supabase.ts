import * as SecureStore from "expo-secure-store";
import { createClient } from "@supabase/supabase-js";

import { env } from "../env";

// Adapter so Supabase auth uses SecureStore (encrypted) instead of AsyncStorage.
// Eliminates the dual-store race condition from Story 0.1 W3.
const secureStoreAdapter = {
  getItem: (key: string) => SecureStore.getItemAsync(key),
  setItem: (key: string, value: string) => SecureStore.setItemAsync(key, value),
  removeItem: (key: string) => SecureStore.deleteItemAsync(key),
};

export const supabase = createClient(
  env.EXPO_PUBLIC_SUPABASE_URL,
  env.EXPO_PUBLIC_SUPABASE_ANON_KEY,
  {
    auth: {
      storage: secureStoreAdapter,
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: false,
    },
  },
);
