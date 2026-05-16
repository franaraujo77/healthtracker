// Expo inlines EXPO_PUBLIC_* vars at build time via Metro bundler
declare const process: { env: Record<string, string | undefined> };

const get = (key: string): string => {
  const val = process.env[key];
  if (!val) throw new Error(`Missing env var: ${key}`);
  return val;
};

export const env = {
  EXPO_PUBLIC_SUPABASE_URL: get("EXPO_PUBLIC_SUPABASE_URL"),
  EXPO_PUBLIC_SUPABASE_ANON_KEY: get("EXPO_PUBLIC_SUPABASE_ANON_KEY"),
  NODE_ENV: (process.env.NODE_ENV ?? "development") as
    | "development"
    | "production"
    | "test",
} as const;
