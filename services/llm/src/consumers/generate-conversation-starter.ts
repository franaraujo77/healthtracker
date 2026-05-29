import type { PgBoss } from "pg-boss";
import type postgres from "postgres";
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";

import type { JobPayload } from "@healthtracker/types";

import type {
  ConversationStarterObservation,
  ConversationStarterPayload,
  LLMAdapter,
} from "../adapters/anthropic.js";

/**
 * Story 6.2 — local Zod mirror of `conversationStarterPayloadSchema`
 * in `@healthtracker/validators`. `services/llm` deliberately does
 * NOT import from validators (Story 4.3 precedent in
 * `biomarker-suggestion-regex.ts` documents the convention — the
 * service is a deploy-isolated worker). The shape is dual-declared
 * here; the canonical version lives in
 * `packages/validators/src/sharing.ts`.
 */
const conversationStarterPayloadSchema = z.object({
  prompts: z
    .array(z.object({ text: z.string().min(1) }))
    .min(1)
    .max(6),
  biomarkerCards: z
    .array(
      z.object({
        category: z.string().min(1),
        currentValue: z.number().nullable(),
        previousValue: z.number().nullable(),
        trendDirection: z.enum(["up", "down", "flat"]).nullable(),
        patientBaseline: z.number().nullable(),
      }),
    )
    .max(64),
});

interface GenerateConversationStarterPayload {
  shareTokenId: string;
}

interface ShareTokenRow {
  id: string;
  patient_id: string;
}

interface VisibleBiomarkerRow {
  biomarker_category: string;
}

/**
 * Story 5.2 — `conversation_starter.generate` consumer. Mirrors the
 * structure of `generate-letter.ts`:
 *   - load the share_token row,
 *   - load the visible biomarker categories (RLS bypass via service role),
 *   - call the LLM adapter (stub in dev/CI, real Anthropic gated by
 *     `ANTHROPIC_API_KEY` + Epic 6's DPA),
 *   - UPDATE `conversation_starter_cache` to `ready` + write the
 *     `conversation_starter.generated` audit row, all in one tx.
 *
 * On failure: narrow catches (Anthropic.APIError + ECONNRESET). After
 * pg-boss exhausts retries the consumer marks the row `failed` with a
 * short reason and emits `conversation_starter.failed`. Story 6.2 will
 * render an inline message when the doctor surface sees `status='failed'`.
 *
 * **Narrow catches** — `TypeError`, `ReferenceError`, `SyntaxError`
 * and any other unrecognised shape rethrow so pg-boss retries surface
 * the bug rather than silently marking the cache row `failed`.
 */
export async function registerGenerateConversationStarterConsumer(
  boss: PgBoss,
  deps: {
    sql: postgres.Sql;
    llm: LLMAdapter;
  },
): Promise<void> {
  await boss.work<JobPayload<GenerateConversationStarterPayload>>(
    "conversation_starter.generate",
    { localConcurrency: 4, batchSize: 1 },
    async (jobs) => {
      for (const job of jobs) {
        const { shareTokenId } = job.data.payload;
        // Story 5.2 review-fix Patch #6 — pass `retrycount` so the
        // catch arm can distinguish "transient failure, let pg-boss
        // retry" from "retry budget exhausted, persist `failed`".
        // pg-boss types `retrycount` as number on the job object;
        // fall back to 0 for the very-first run.
        const rawRetrycount = (job as unknown as { retrycount?: unknown })
          .retrycount;
        const retrycount =
          typeof rawRetrycount === "number" ? rawRetrycount : 0;
        await processOne(deps, shareTokenId, retrycount);
      }
    },
  );
}

/**
 * pg-boss queue retry budget for `conversation_starter.generate`.
 * Mirrors the producer (`packages/api/src/router/sharing.ts` — the
 * `INSERT INTO pgboss.job ... retry_limit = 3` line) and the queue's
 * `createQueue(..., { retryLimit: 3 })` registration.
 */
const RETRY_LIMIT = 3;

async function processOne(
  deps: { sql: postgres.Sql; llm: LLMAdapter },
  shareTokenId: string,
  retrycount: number,
): Promise<void> {
  const tokenRows = await deps.sql<ShareTokenRow[]>`
    SELECT id, patient_id
    FROM share_tokens
    WHERE id = ${shareTokenId}::uuid
    LIMIT 1
  `;
  const token = tokenRows[0];
  if (!token) {
    console.warn(
      `[conversation_starter.generate] shareTokenId=${shareTokenId}: share_token row missing — skipping`,
    );
    return;
  }

  // Idempotency: skip if the cache row is already `ready`. A `failed`
  // row is also skipped here — operator must reset to `queued` to
  // re-trigger (Story 5.x revoke + new draw is the regen path).
  const cacheRows = await deps.sql<{ status: string }[]>`
    SELECT status FROM conversation_starter_cache
    WHERE share_token_id = ${shareTokenId}::uuid
    LIMIT 1
  `;
  const cacheRow = cacheRows[0];
  if (!cacheRow) {
    console.warn(
      `[conversation_starter.generate] shareTokenId=${shareTokenId}: cache row missing — skipping`,
    );
    return;
  }
  if (cacheRow.status === "ready" || cacheRow.status === "failed") {
    console.log(
      `[conversation_starter.generate] shareTokenId=${shareTokenId}: already ${cacheRow.status} — skipping`,
    );
    return;
  }

  const visibleRows = await deps.sql<VisibleBiomarkerRow[]>`
    SELECT biomarker_category
    FROM share_token_biomarkers
    WHERE share_token_id = ${shareTokenId}::uuid AND visible = true
    ORDER BY biomarker_category
  `;

  // Story 6.2 T7.3 — per-category top-3 observations snapshot via
  // window function. Service-role connection; RLS-bypass. The values
  // feed the LLM prompt; no values feed the rendered card unless the
  // LLM emitted them (the JSONB payload is the source of truth).
  const visibleCategories = visibleRows.map((r) => r.biomarker_category);
  let observationsSnapshot: ConversationStarterObservation[] = [];
  if (visibleCategories.length > 0) {
    const observationRows = await deps.sql<
      {
        category: string;
        value: string;
        collected_at: Date;
      }[]
    >`
      SELECT category, value, collected_at FROM (
        SELECT
          coalesce(o.loinc_code, o.biomarker_name) AS category,
          o.value_numeric::text AS value,
          o.collected_at,
          row_number() OVER (
            PARTITION BY coalesce(o.loinc_code, o.biomarker_name)
            ORDER BY o.collected_at DESC
          ) AS rn
        FROM observations o
        WHERE o.patient_id = ${token.patient_id}::uuid
          AND o.deleted_at IS NULL
          AND coalesce(o.loinc_code, o.biomarker_name) = ANY(${visibleCategories}::text[])
      ) ranked
      WHERE rn <= 3
      ORDER BY category, collected_at DESC
    `;
    observationsSnapshot = observationRows
      .map((r) => {
        const num = Number(r.value);
        if (!Number.isFinite(num)) return null;
        const iso =
          r.collected_at instanceof Date
            ? r.collected_at.toISOString().slice(0, 10)
            : String(r.collected_at).slice(0, 10);
        return { category: r.category, value: num, collectedAt: iso };
      })
      .filter((o): o is ConversationStarterObservation => o !== null);
  }

  let payload: ConversationStarterPayload;
  try {
    const raw = await deps.llm.generateConversationStarter({
      shareTokenId,
      patientId: token.patient_id,
      visibleBiomarkers: visibleRows.map((r) => ({
        category: r.biomarker_category,
      })),
      observationsSnapshot,
    });
    // Story 6.2 AC9 — Zod-validate the adapter's return. The real
    // Anthropic adapter forwards `JSON.parse(text)` un-validated;
    // validation failure throws an Anthropic.APIError-shaped error
    // so the catch arm below classifies it as `LLM_API_ERROR` and
    // marks the cache `failed` after retry exhaustion. The stub
    // adapter passes through unchanged.
    try {
      payload = conversationStarterPayloadSchema.parse(raw);
    } catch (zodErr) {
      throw new Anthropic.APIError(
        500,
        {
          error: {
            type: "invalid_response",
            message: `Zod validation failed: ${
              zodErr instanceof Error ? zodErr.message : "unknown"
            }`,
          },
        },
        "Zod validation failed",
        {},
      );
    }
  } catch (err) {
    // Story 5.2 review-fix Patch #5 — drop the TypeError/Reference/
    // Syntax short-circuits. Node 20+ undici surfaces fetch failures
    // as a bare `TypeError: fetch failed`, which the previous guard
    // mis-classified as a programmer error and rethrew. Match on the
    // message regex instead; programmer errors that don't match the
    // network-shape regex still rethrow (intended — pg-boss retries
    // will surface the bug rather than silently mark `failed`).
    const isAnthropicError =
      err instanceof Anthropic.APIError ||
      err instanceof Anthropic.APIConnectionError;
    const isNetworkError =
      err instanceof Error &&
      /ECONNRESET|ECONN|ETIMEDOUT|fetch failed|network/i.test(err.message);
    if (!isAnthropicError && !isNetworkError) throw err;

    console.error(
      `[conversation_starter.generate] shareTokenId=${shareTokenId}: adapter failure (retrycount=${retrycount})`,
      err,
    );

    // Story 5.2 review-fix Patch #6 — only persist `failed` + emit
    // audit on the LAST attempt (retry budget exhausted). Earlier
    // attempts rethrow so pg-boss actually retries; the previous
    // implementation marked `failed` on first error, then every
    // retry saw `status='failed'` in the idempotency skip-guard and
    // no-op'd — burning the retry budget without ever re-running.
    if (retrycount + 1 < RETRY_LIMIT) {
      throw err;
    }

    await deps.sql.begin(async (tx) => {
      await tx`
        UPDATE conversation_starter_cache
        SET status = 'failed',
            failure_reason = ${isAnthropicError ? "LLM_API_ERROR" : "LLM_NETWORK_ERROR"}
        WHERE share_token_id = ${shareTokenId}::uuid
      `;
      await tx`
        INSERT INTO audit_log
          (actor_id, actor_type, event, resource_id, resource_type, metadata)
        VALUES (
          ${token.patient_id}::uuid,
          'system',
          'conversation_starter.failed',
          ${shareTokenId}::uuid,
          'share_token',
          ${JSON.stringify({ reason: isAnthropicError ? "LLM_API_ERROR" : "LLM_NETWORK_ERROR" })}::jsonb
        )
      `;
    });
    return;
  }

  // Story 6.2 Q5 — DPA hard-gate. In production, refuse to set the
  // cache `ready` when the bound adapter is the stub. The stub returns
  // canned content regardless of which biomarkers the patient shared,
  // which would be a product-visible regression disguised as graceful
  // degradation (a "Conversation Starter" that says "Como evoluiu sua
  // hemoglobina nos últimos 6 meses?" regardless of input).
  // Discriminated `kind` field (NOT a runtime string sniff) per spec.
  if (deps.llm.kind === "stub" && process.env.NODE_ENV === "production") {
    console.warn(
      `[conversation_starter.generate] shareTokenId=${shareTokenId}: stub adapter in production — refusing to mark ready (DPA gate)`,
    );
    await deps.sql.begin(async (tx) => {
      await tx`
        UPDATE conversation_starter_cache
        SET status = 'failed',
            failure_reason = 'LLM_API_ERROR'
        WHERE share_token_id = ${shareTokenId}::uuid
      `;
      await tx`
        INSERT INTO audit_log
          (actor_id, actor_type, event, resource_id, resource_type, metadata)
        VALUES (
          ${token.patient_id}::uuid,
          'system',
          'conversation_starter.failed',
          ${shareTokenId}::uuid,
          'share_token',
          ${JSON.stringify({ reason: "STUB_ADAPTER_IN_PRODUCTION" })}::jsonb
        )
      `;
    });
    return;
  }

  await deps.sql.begin(async (tx) => {
    await tx`
      UPDATE conversation_starter_cache
      SET status = 'ready',
          payload = ${JSON.stringify(payload)}::jsonb,
          generated_at = now()
      WHERE share_token_id = ${shareTokenId}::uuid
    `;
    await tx`
      INSERT INTO audit_log
        (actor_id, actor_type, event, resource_id, resource_type, metadata)
      VALUES (
        ${token.patient_id}::uuid,
        'system',
        'conversation_starter.generated',
        ${shareTokenId}::uuid,
        'share_token',
        ${JSON.stringify({
          promptCount: payload.prompts.length,
          biomarkerCardCount: payload.biomarkerCards.length,
        })}::jsonb
      )
    `;
  });
}
