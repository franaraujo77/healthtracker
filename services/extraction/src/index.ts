import { createClient } from "@supabase/supabase-js";
import { PgBoss } from "pg-boss";

import type { JobPayload } from "@healthtracker/types";

import type { TextractAdapter } from "./textract/adapter.js";
import { registerDocumentConsumer } from "./consumers/document.js";
import {
  createDefaultExpoPushClient,
  registerNotificationsConsumer,
} from "./consumers/notifications.js";
import { registerSmokeTestConsumer } from "./consumers/smoke-test.js";
import { sql } from "./db.js";
import { markUploadFailed } from "./state-machine/upload-transitions.js";
import { awsTextractAdapter } from "./textract/aws-adapter.js";
import { assertAwsTextractConfig } from "./textract/aws-config.js";
import { mockTextractAdapterFromFixtures } from "./textract/mock-adapter.js";

// Story 2.3 — adapter selection by env var. Default `mock` in
// dev/test/CI; `aws` in prod will throw NOT_IMPLEMENTED until the
// follow-up story ships the real SDK integration.
//
// R1-P97 — case-insensitive + explicit reject for unknown values
// (`EXTRACTION_ADAPTER=AWS` would otherwise silently fall through
// to mock).
const EXTRACTION_ADAPTER = (
  process.env.EXTRACTION_ADAPTER ?? "mock"
).toLowerCase();
if (EXTRACTION_ADAPTER !== "mock" && EXTRACTION_ADAPTER !== "aws") {
  throw new Error(
    `EXTRACTION_ADAPTER must be 'mock' or 'aws' (case-insensitive); got '${process.env.EXTRACTION_ADAPTER ?? ""}'`,
  );
}
// R1-P96 — warn loudly when worker boots with the mock adapter and
// no fixtures. Every job will dead-letter silently otherwise.
// Production (`EXTRACTION_ADAPTER=aws`) throws on first call, which
// is the right fail-loud behavior; dev with mock is the silent-fail
// case this warning addresses.
const mockFixtures: Parameters<typeof mockTextractAdapterFromFixtures>[0] = [];
if (EXTRACTION_ADAPTER === "mock") {
  // R2-P120 — accurate boot warning. The mock adapter rejects
  // unknown storage paths → handler throws → pg-boss retries to
  // the queue's retry limit → dead-letter handler fires
  // `markUploadFailed`. The upload eventually reaches `failed` but
  // it's a multi-hop path, not a direct dead-letter on the upload.
  console.warn(
    "[extraction-worker] BOOT: EXTRACTION_ADAPTER=mock with 0 fixtures. " +
      "Every extraction.document job will fail with NO_FIXTURE; pg-boss " +
      "will retry to the queue's retry limit, then the extraction.dead_letter " +
      "handler will mark each upload as failed via markUploadFailed. Register " +
      "fixtures or set EXTRACTION_ADAPTER=aws if you mean to use real Textract.",
  );
}
// Story 9.2 — fail-loud AWS config gate. When `aws` is selected, validate
// the region pin (sa-east-1) + credential presence at BOOT (NFR-S6/NFR-S8),
// so a misconfigured deploy crashes here instead of dead-lettering every
// upload at first dispatch. Mirrors the Supabase gate below. Mock is untouched.
if (EXTRACTION_ADAPTER === "aws") {
  assertAwsTextractConfig();
}
const textractAdapter: TextractAdapter =
  EXTRACTION_ADAPTER === "aws"
    ? awsTextractAdapter
    : mockTextractAdapterFromFixtures(mockFixtures);

// Story 2.3 — Supabase Storage service-role download seam. The worker
// has its own connection to Supabase (separate from the API) for
// downloading uploaded documents. NEXT_PUBLIC_SUPABASE_URL +
// SUPABASE_SERVICE_ROLE_KEY are the same env vars the API reads.
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error(
    "Story 2.3 — NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY required for storage download",
  );
}
const storageClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

async function downloadStorageObject(
  storagePath: string,
): Promise<{ bytes: Uint8Array }> {
  const result = await storageClient.storage
    .from("lab-uploads")
    .download(storagePath);
  if (result.error) {
    throw new Error(
      `[extraction.document] storage download failed for ${storagePath}: ${result.error.message}`,
    );
  }
  // R1-P107 — defensive null check on `data`. TS narrows the
  // discriminated union as non-null here, but the Supabase SDK has
  // historically returned `{data: null, error: null}` in some
  // edge cases; defense-in-depth.
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  if (!result.data) {
    throw new Error(
      `[extraction.document] storage download returned no data for ${storagePath}`,
    );
  }
  const arrayBuffer = await result.data.arrayBuffer();
  // R1-P98 + R2-P116 — `mimeType` is sourced from the job payload
  // (validated at upload time by Story 2.2 confirmImport); the
  // storage-derived `data.type` was dropped because Supabase
  // returns empty string for unknown MIMEs. The return type now
  // matches actual consumer usage (`{ bytes }` only).
  return { bytes: new Uint8Array(arrayBuffer) };
}

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

// Story 2.5 — `notification.send` queue. Higher retry count
// (5) absorbs Expo Push API transient outages. No dead-letter
// routing yet — failed notifications are a soft loss (user can
// always pull-to-refresh Histórico) so we don't mark the upload
// as failed on push delivery failure.
await boss.createQueue("notification.send", {
  retryLimit: 5,
  retryDelay: 30,
  retryBackoff: true,
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
        await markUploadFailed(sql, correlationId);
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
await registerDocumentConsumer(boss, {
  sql,
  textractAdapter,
  downloadStorageObject,
});

// Story 2.5 — notification dispatch consumer. The Expo Push API
// is anonymous-friendly for `ExponentPushToken[...]` recipients;
// the access token (env) lifts rate limits.
const EXPO_PUSH_ACCESS_TOKEN = process.env.EXPO_PUSH_ACCESS_TOKEN;
await registerNotificationsConsumer(boss, {
  sql,
  expoPushClient: createDefaultExpoPushClient({
    accessToken: EXPO_PUSH_ACCESS_TOKEN,
  }),
});

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
