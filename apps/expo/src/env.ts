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
  EXPO_PUBLIC_SENTRY_DSN: process.env.EXPO_PUBLIC_SENTRY_DSN, // undefined = Sentry no-ops
  // Story 4.1 — base URL of the persistent `services/llm` server.
  // Default points to the dev server's localhost listener; CI/staging/
  // prod must set explicitly. The SSE endpoint is direct (NOT
  // proxied through tRPC) — architecture.md §3 lines 247–253.
  EXPO_PUBLIC_LLM_SERVICE_URL:
    process.env.EXPO_PUBLIC_LLM_SERVICE_URL ?? "http://localhost:3001",
  NODE_ENV: (process.env.NODE_ENV ?? "development") as
    | "development"
    | "production"
    | "test",
} as const;
