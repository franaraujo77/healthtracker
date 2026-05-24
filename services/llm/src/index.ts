import Fastify from "fastify";
import { PgBoss } from "pg-boss";

import type { LLMAdapter } from "./adapters/anthropic.js";
import {
  createAnthropicAdapter,
  createStubLLMAdapter,
} from "./adapters/anthropic.js";
import { registerGenerateLetterConsumer } from "./consumers/generate-letter.js";
import { sql } from "./db.js";
import { registerLetterStreamRoute } from "./routes/letter-stream.js";

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const PORT = Number(process.env.PORT ?? "3001");
const WORKER_DATABASE_URL = process.env.WORKER_DATABASE_URL;
if (!WORKER_DATABASE_URL) throw new Error("WORKER_DATABASE_URL is required");

// Story 4.1 NFR-S6 launch blocker — production deploy is gated on
// the Anthropic DPA being signed. Until then (dev / staging) the
// stub adapter keeps the SSE plumbing exercisable end-to-end.
const llm: LLMAdapter = ANTHROPIC_API_KEY
  ? createAnthropicAdapter({ apiKey: ANTHROPIC_API_KEY })
  : (() => {
      console.warn(
        "[llm-service] ANTHROPIC_API_KEY not set — using stub adapter. " +
          "Letters will stream a placeholder body. Set the env var for real Sonnet calls.",
      );
      return createStubLLMAdapter();
    })();

const boss = new PgBoss({ connectionString: WORKER_DATABASE_URL, max: 3 });
boss.on("error", (err: unknown) => {
  console.error("[pg-boss] error", err);
});
await boss.start();
console.log("[pg-boss] boss started (llm-service)");

await boss.createQueue("letter.generate", {
  retryLimit: 3,
  retryDelay: 30,
  retryBackoff: true,
});

await registerGenerateLetterConsumer(boss, { sql, llm });

const app = Fastify({ logger: false });
app.get("/healthz", () => ({ ok: true }));
registerLetterStreamRoute(app, { sql });

await app.listen({ host: "0.0.0.0", port: PORT });
console.log(`[llm-service] listening on :${PORT}`);

const SIGTERM_TIMEOUT_MS = 30_000;
process.on("SIGTERM", () => {
  const timeout = setTimeout(() => {
    console.error("[llm-service] graceful shutdown timed out — forcing exit");
    process.exit(1);
  }, SIGTERM_TIMEOUT_MS);
  timeout.unref();
  Promise.all([app.close(), boss.stop()]).then(
    () => {
      clearTimeout(timeout);
      process.exit(0);
    },
    (err: unknown) => {
      clearTimeout(timeout);
      console.error("[llm-service] error during stop", err);
      process.exit(1);
    },
  );
});
