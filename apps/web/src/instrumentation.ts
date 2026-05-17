import * as Sentry from "@sentry/nextjs";

export async function register() {
  // NEXT_RUNTIME is set by Next.js itself at runtime — it cannot go through ~/env validation
  // eslint-disable-next-line no-restricted-properties
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("../sentry.server.config");
  }
  // eslint-disable-next-line no-restricted-properties
  if (process.env.NEXT_RUNTIME === "edge") {
    await import("../sentry.edge.config");
  }
}

export const onRequestError = Sentry.captureRequestError;
