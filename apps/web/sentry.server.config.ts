import * as Sentry from "@sentry/nextjs";

import { sentryBeforeSend } from "@healthtracker/config";

Sentry.init({
  dsn: process.env.SENTRY_DSN, // server-only, no NEXT_PUBLIC_ prefix
  tracesSampleRate: 0.1,
  // Cast required: sentryBeforeSend uses duck-typed interfaces to avoid SDK version coupling
  beforeSend: sentryBeforeSend as Parameters<
    typeof Sentry.init
  >[0]["beforeSend"],
});
