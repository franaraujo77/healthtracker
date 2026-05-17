import * as Sentry from "@sentry/nextjs";

import { sentryBeforeSend } from "@healthtracker/config";

Sentry.init({
  dsn: process.env.SENTRY_DSN, // server-only DSN — edge runs server-side, no NEXT_PUBLIC_ needed
  tracesSampleRate: 0.1,
  // Cast required: sentryBeforeSend uses duck-typed interfaces to avoid SDK version coupling
  beforeSend: sentryBeforeSend as Parameters<
    typeof Sentry.init
  >[0]["beforeSend"],
  // Session replay intentionally omitted — health data on screen could appear in replays (NFR-S5)
});
