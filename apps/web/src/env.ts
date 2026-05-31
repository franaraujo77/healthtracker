import { createEnv } from "@t3-oss/env-nextjs";
import { vercel } from "@t3-oss/env-nextjs/presets-zod";
import { z } from "zod/v4";

export const env = createEnv({
  extends: [vercel()],
  shared: {
    NODE_ENV: z
      .enum(["development", "production", "test"])
      .default("development"),
  },
  server: {
    DATABASE_URL: z.url().optional(),
    CORS_ORIGIN: z.string().default("http://localhost:3000"),
    SENTRY_DSN: z.string().optional(),
    // Story 1.5 + Story 5.5 — Supabase service-role key used for
    // signed-URL creation (lab uploads + record exports) and for
    // Storage admin operations (the `voice_memos` existence probe
    // from Story 7.4). The key MUST be server-only and is NEVER
    // bundled into the client. NFR-S6 boot gate: required outside
    // `development` / `test`; missing in production fails the
    // env-schema validation on first request (middleware.ts imports
    // `env`, so the assertion runs before any route handler does).
    // Mirrors the SHARE_TOKEN_HMAC_SECRET gate documented in
    // `packages/api/src/sharing.ts`.
    SUPABASE_SERVICE_ROLE_KEY: z
      .string()
      .optional()
      .refine(
        (val) => {
          const nodeEnv = process.env.NODE_ENV;
          if (nodeEnv === "development" || nodeEnv === "test") return true;
          return typeof val === "string" && val.length > 0;
        },
        {
          message:
            "SUPABASE_SERVICE_ROLE_KEY is required outside development/test (Story 1.5 / NFR-S6) — set it in the Vercel/Railway environment",
        },
      ),
  },
  client: {
    NEXT_PUBLIC_SUPABASE_URL: z.url(),
    NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
    NEXT_PUBLIC_SENTRY_DSN: z.string().optional(),
  },
  experimental__runtimeEnv: {
    NODE_ENV: process.env.NODE_ENV,
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    NEXT_PUBLIC_SENTRY_DSN: process.env.NEXT_PUBLIC_SENTRY_DSN,
  },
  skipValidation:
    !!process.env.CI ||
    !!process.env.SKIP_ENV_VALIDATION ||
    process.env.npm_lifecycle_event === "lint",
});
