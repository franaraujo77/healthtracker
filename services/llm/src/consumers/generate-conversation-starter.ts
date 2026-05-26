import type { PgBoss } from "pg-boss";
import type postgres from "postgres";
import Anthropic from "@anthropic-ai/sdk";

import type { JobPayload } from "@healthtracker/types";

import type {
  ConversationStarterPayload,
  LLMAdapter,
} from "../adapters/anthropic.js";

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
        await processOne(deps, shareTokenId);
      }
    },
  );
}

async function processOne(
  deps: { sql: postgres.Sql; llm: LLMAdapter },
  shareTokenId: string,
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

  let payload: ConversationStarterPayload;
  try {
    payload = await deps.llm.generateConversationStarter({
      shareTokenId,
      patientId: token.patient_id,
      visibleBiomarkers: visibleRows.map((r) => ({
        category: r.biomarker_category,
      })),
    });
  } catch (err) {
    // Narrow catch — Anthropic / network errors mark the row `failed`
    // and emit the failure audit. Everything else (TypeError etc.)
    // rethrows so pg-boss retries surface the bug.
    const isAnthropicError =
      err instanceof Anthropic.APIError ||
      err instanceof Anthropic.APIConnectionError;
    const isEconnReset =
      err instanceof Error &&
      err instanceof TypeError === false &&
      err instanceof ReferenceError === false &&
      err instanceof SyntaxError === false &&
      /ECONNRESET|ECONN|ETIMEDOUT|fetch failed/i.test(err.message);
    if (!isAnthropicError && !isEconnReset) throw err;

    console.error(
      `[conversation_starter.generate] shareTokenId=${shareTokenId}: adapter failure`,
      err,
    );
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
