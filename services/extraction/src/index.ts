import { PgBoss } from "pg-boss";

import type { JobPayload } from "@healthtracker/types";

import { registerSmokeTestConsumer } from "./consumers/smoke-test.js";
import { markUploadFailed } from "./state-machine/upload-transitions.js";

const WORKER_DATABASE_URL = process.env.WORKER_DATABASE_URL;
if (!WORKER_DATABASE_URL) throw new Error("WORKER_DATABASE_URL is required");

const boss = new PgBoss({ connectionString: WORKER_DATABASE_URL, max: 5 });

boss.on("error", (error: unknown) => {
  console.error("[pg-boss] error", error);
});

await boss.start();
console.log("[pg-boss] boss started");

// Dead-letter queue: retryLimit:0 so a handler throw does not re-queue indefinitely
await boss.createQueue("extraction.dead_letter", { retryLimit: 0 });

// Configure queues with retry policy and dead-letter routing
await boss.createQueue("extraction.smoke_test", {
  retryLimit: 3,
  retryDelay: 30,
  retryBackoff: true,
  deadLetter: "extraction.dead_letter",
});

// Story 1.5 — `extraction.document` queue for onboarding imports + Epic 2
// post-onboarding uploads. The API server enqueues directly via SQL into
// `pgboss.job` (see `packages/api/src/uploads.ts#enqueueExtractDocument`);
// this `createQueue` call is what gives the queue its retry policy and
// dead-letter routing. The actual document-processing consumer
// (`boss.work('extraction.document', ...)`) ships in Epic 2 / Story 2.3.
await boss.createQueue("extraction.document", {
  retryLimit: 3,
  retryDelay: 60,
  retryBackoff: true,
  deadLetter: "extraction.dead_letter",
});

// Dead-letter handler: extraction.* jobs that exhausted retries arrive here.
// Only extraction jobs trigger upload-state transitions; other future job domains
// (e.g. letter.generate) must not invoke markUploadFailed.
await boss.work<JobPayload<unknown>>("extraction.dead_letter", async (jobs) => {
  for (const job of jobs) {
    try {
      console.error(`[pg-boss] dead-letter: job ${job.id} failed`, job.data);
      const correlationId = job.data.correlationId;
      if (!correlationId) {
        console.warn(
          `[pg-boss] dead-letter: job ${job.id} has no correlationId — skipping markUploadFailed`,
        );
        continue;
      }
      // Guard: only extraction-domain jobs should mark uploads as failed
      if (typeof job.name === "string" && job.name.startsWith("extraction.")) {
        await markUploadFailed(correlationId);
      } else {
        console.warn(
          `[pg-boss] dead-letter: job ${job.id} (${job.name}) is not an extraction job — skipping markUploadFailed`,
        );
      }
    } catch (err) {
      console.error(
        `[pg-boss] dead-letter: error processing job ${job.id}`,
        err,
      );
    }
  }
});

await registerSmokeTestConsumer(boss);

const SIGTERM_TIMEOUT_MS = 30_000;

process.on("SIGTERM", () => {
  const timeout = setTimeout(() => {
    console.error("[pg-boss] graceful shutdown timed out — forcing exit");
    process.exit(1);
  }, SIGTERM_TIMEOUT_MS);
  timeout.unref();

  boss.stop().then(
    () => {
      clearTimeout(timeout);
      process.exit(0);
    },
    (err: unknown) => {
      clearTimeout(timeout);
      console.error("[pg-boss] error during stop", err);
      process.exit(1);
    },
  );
});
