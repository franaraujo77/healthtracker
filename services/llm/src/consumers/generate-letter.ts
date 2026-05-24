import type { PgBoss } from "pg-boss";
import type postgres from "postgres";
import Anthropic from "@anthropic-ai/sdk";

import type { JobPayload } from "@healthtracker/types";

import type { LLMAdapter } from "../adapters/anthropic.js";
import type { BiomarkerSummaryLine } from "../prompts/letter-prompt.js";
import { ANVISA_SYSTEM_PROMPT } from "../prompts/anvisa-system.js";
import { buildLetterUserPrompt } from "../prompts/letter-prompt.js";
import {
  publishDone,
  publishError,
  publishToken,
} from "../streams/letter-fanout.js";

interface GenerateLetterPayload {
  letterId: string;
}

interface LetterRow {
  id: string;
  patient_id: string;
  upload_id: string;
  status: "queued" | "generating" | "complete" | "failed";
}

interface ObservationRow {
  biomarker_name: string;
  value_numeric: string;
  unit_ucum: string;
  collected_at: string;
}

const LETTER_MAX_TOKENS = 1024;
const LETTER_MODEL_ID = "claude-sonnet-4-6";

/**
 * Story 4.1 — `letter.generate` consumer. Single-job batches so each
 * Anthropic stream gets its own Node task; pg-boss handles concurrency
 * via its own worker pool (configure `teamSize` at registration).
 *
 * On error: narrow the catch to Anthropic / network errors (Epic 2
 * retro discipline; CLAUDE.md §"Narrow catches"). Programmer errors
 * (TypeError, ReferenceError, SyntaxError) rethrow so pg-boss retries
 * surface the bug rather than silently failing the patient's Letter.
 */
export async function registerGenerateLetterConsumer(
  boss: PgBoss,
  deps: {
    sql: postgres.Sql;
    llm: LLMAdapter;
  },
): Promise<void> {
  await boss.work<JobPayload<GenerateLetterPayload>>(
    "letter.generate",
    async (jobs) => {
      for (const job of jobs) {
        const { letterId } = job.data.payload;
        await processOne(deps, letterId);
      }
    },
  );
}

async function processOne(
  deps: { sql: postgres.Sql; llm: LLMAdapter },
  letterId: string,
): Promise<void> {
  const rows = await deps.sql<LetterRow[]>`
    SELECT id, patient_id, upload_id, status
    FROM letters
    WHERE id = ${letterId}::uuid
    LIMIT 1
  `;
  const letter = rows[0];
  if (!letter) {
    console.warn(
      `[letter.generate] letterId=${letterId}: row missing — skipping`,
    );
    return;
  }
  if (letter.status === "complete" || letter.status === "failed") {
    console.log(
      `[letter.generate] letterId=${letterId}: already ${letter.status} — skipping`,
    );
    return;
  }

  // Transition queued → generating. If the row was already
  // `generating` (a prior attempt that crashed mid-stream), the
  // UPDATE is a no-op and we continue — pg-boss handles the
  // dedup at the job layer.
  await deps.sql`
    UPDATE letters
    SET status = 'generating'
    WHERE id = ${letterId}::uuid AND status = 'queued'
  `;

  const observations = await loadObservations(deps.sql, letter.patient_id);
  const drawCount = await countDraws(deps.sql, letter.patient_id);
  const userPrompt = buildLetterUserPrompt({
    drawCount,
    biomarkers: observations,
  });

  try {
    await deps.llm.streamLetter({
      system: ANVISA_SYSTEM_PROMPT,
      userPrompt,
      model: LETTER_MODEL_ID,
      maxTokens: LETTER_MAX_TOKENS,
      callbacks: {
        onToken: (token) => publishToken(letterId, token),
        onDone: (result) => {
          void (async () => {
            try {
              await deps.sql.begin(async (tx) => {
                await tx`
                UPDATE letters
                SET status = 'complete',
                    body = ${result.body},
                    model = ${result.model},
                    tokens_used = ${result.tokensUsed},
                    generated_at = now()
                WHERE id = ${letterId}::uuid
              `;
                await tx`
                INSERT INTO audit_log
                  (actor_id, actor_type, event, resource_id, resource_type, metadata)
                VALUES (
                  ${letter.patient_id}::uuid,
                  'system',
                  'letter.generated',
                  ${letterId}::uuid,
                  'letter',
                  ${JSON.stringify({
                    model: result.model,
                    tokensUsed: result.tokensUsed,
                    firstTokenMs: result.firstTokenMs,
                  })}::jsonb
                )
              `;
                // Story 4.1 — enqueue the `letter_ready` push as part
                // of the same tx so a duplicate retry of this consumer
                // cannot fire two pushes (singleton_key per letterId).
                const wrapped = {
                  jobId: crypto.randomUUID(),
                  patientId: letter.patient_id,
                  correlationId: letterId,
                  payload: {
                    uploadId: letter.upload_id,
                    kind: "letter_ready" as const,
                    letterId,
                  },
                  createdAt: new Date().toISOString(),
                };
                await tx`
                INSERT INTO pgboss.job
                  (name, data, retry_limit, retry_delay, retry_backoff, singleton_key)
                VALUES (
                  'notification.send',
                  ${JSON.stringify(wrapped)}::jsonb,
                  5, 30, true,
                  ${"letter_ready." + letterId}
                )
                ON CONFLICT DO NOTHING
              `;
              });
              publishDone(letterId);
              if (result.firstTokenMs !== null) {
                console.log(
                  `[letter.generate] letterId=${letterId} letter.firstTokenMs=${result.firstTokenMs}`,
                );
              }
            } catch (writeErr) {
              console.error(
                `[letter.generate] letterId=${letterId}: post-stream DB write failed`,
                writeErr,
              );
              publishError(letterId, "LETTER_UNAVAILABLE");
            }
          })();
        },
        onError: (err) => {
          console.error(
            `[letter.generate] letterId=${letterId}: stream error`,
            err,
          );
          publishError(letterId, "LETTER_UNAVAILABLE");
        },
      },
    });
  } catch (err) {
    // Narrow catch — only Anthropic / network errors set `failed`.
    // Programmer errors (TypeError etc.) rethrow so pg-boss retries.
    const isAnthropicError =
      err instanceof Anthropic.APIError ||
      err instanceof Anthropic.APIConnectionError;
    const isNetworkError =
      err instanceof Error &&
      err instanceof TypeError === false &&
      err instanceof ReferenceError === false &&
      err instanceof SyntaxError === false &&
      /ECONN|ENETDOWN|ETIMEDOUT|timeout|connection|fetch failed/i.test(
        err.message,
      );
    if (!isAnthropicError && !isNetworkError) throw err;
    await deps.sql`
      UPDATE letters
      SET status = 'failed',
          failure_reason = 'LETTER_UNAVAILABLE'
      WHERE id = ${letterId}::uuid
    `;
  }
}

async function loadObservations(
  sql: postgres.Sql,
  patientId: string,
): Promise<BiomarkerSummaryLine[]> {
  // Pull the most-recent value per biomarker. The query intentionally
  // keeps `loinc_code` and `confidence_score` OUT — they never enter
  // the patient-facing prompt (architecture enforcement rule 6).
  const rows = await sql<ObservationRow[]>`
    SELECT DISTINCT ON (biomarker_name)
      biomarker_name,
      value_numeric::text AS value_numeric,
      unit_ucum,
      to_char(collected_at, 'YYYY-MM-DD') AS collected_at
    FROM observations
    WHERE patient_id = ${patientId}::uuid AND deleted_at IS NULL
    ORDER BY biomarker_name, collected_at DESC
  `;
  return rows.map((r) => ({
    name: r.biomarker_name,
    value: Number(r.value_numeric),
    unit: r.unit_ucum,
    collectedAt: r.collected_at,
    trend: null,
  }));
}

async function countDraws(
  sql: postgres.Sql,
  patientId: string,
): Promise<number> {
  const rows = await sql<{ count: string }[]>`
    SELECT COUNT(DISTINCT collected_at)::text AS count
    FROM observations
    WHERE patient_id = ${patientId}::uuid AND deleted_at IS NULL
  `;
  return Number(rows[0]?.count ?? 0);
}
