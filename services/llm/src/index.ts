import Fastify from "fastify";
import { PgBoss } from "pg-boss";

import type { LLMAdapter } from "./adapters/anthropic.js";
import { getAccountDeletionSalt } from "./account-deletion.js";
import {
  createAnthropicAdapter,
  createStubLLMAdapter,
} from "./adapters/anthropic.js";
import { registerGenerateAccountDeletionConsumer } from "./consumers/generate-account-deletion.js";
import { registerGenerateConversationStarterConsumer } from "./consumers/generate-conversation-starter.js";
import { registerGenerateExportConsumer } from "./consumers/generate-export.js";
import { registerGenerateLetterConsumer } from "./consumers/generate-letter.js";
import { sql } from "./db.js";
import { registerBiomarkerSuggestionRoute } from "./routes/biomarker-suggestion.js";
import { registerLetterStreamRoute } from "./routes/letter-stream.js";
import { getSupabaseClient } from "./supabase.js";

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
// Story 5.2 — Conversation Starter pre-gen queue. Same retry shape as
// `letter.generate`: 3 attempts with exponential backoff. After
// exhaustion the consumer's narrow-catch arm marks the cache row
// `failed` so the Story 6.2 doctor surface can render an inline
// "preparing failed" message.
await boss.createQueue("conversation_starter.generate", {
  retryLimit: 3,
  retryDelay: 30,
  retryBackoff: true,
});
// Story 5.5 — patient record-export queue. Same retry shape as the
// LLM queues; after exhaustion the consumer persists `status='failed'`
// + emits the `export.failed` audit row.
await boss.createQueue("record.export.generate", {
  retryLimit: 3,
  retryDelay: 30,
  retryBackoff: true,
});
// Story 5.6 — patient account-deletion queue. Same retry shape; the
// consumer narrow-catches PG / auth-admin / Storage errors and on
// retry-exhaustion persists `status='failed'` + emits
// `account.deletion_failed` audit (mirror of Story 5.5 R1 patch #2).
await boss.createQueue("account.delete.generate", {
  retryLimit: 3,
  retryDelay: 30,
  retryBackoff: true,
});
// Story 5.5 review-fix Patch #8 — eagerly resolve the Supabase
// service-role client at boot. A misconfigured worker should abort
// the process immediately rather than accept jobs and explode on the
// first export attempt (which then re-queues and burns the retry
// budget against a permanent env defect).
getSupabaseClient();
// Story 5.6 R1 pattern — eager resolve the account-deletion salt at
// boot. Missing `ACCOUNT_DELETION_SALT` in production aborts the
// process immediately rather than crashing on the first deletion job.
const accountDeletionSalt = getAccountDeletionSalt();

await registerGenerateLetterConsumer(boss, { sql, llm });
await registerGenerateConversationStarterConsumer(boss, { sql, llm });
await registerGenerateExportConsumer(boss, { sql });
await registerGenerateAccountDeletionConsumer(boss, {
  sql,
  salt: accountDeletionSalt,
});

const app = Fastify({ logger: false });
app.get("/healthz", () => ({ ok: true }));
registerLetterStreamRoute(app, { sql });
registerBiomarkerSuggestionRoute(app, { llm });

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
