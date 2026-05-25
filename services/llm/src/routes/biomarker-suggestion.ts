import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

import type { LLMAdapter } from "../adapters/anthropic.js";
import { verifyJwt } from "../auth.js";
import { ANVISA_SYSTEM_PROMPT } from "../prompts/anvisa-system.js";
import { buildBiomarkerSuggestionPrompt } from "../prompts/biomarker-suggestion-prompt.js";

const BIOMARKER_MODEL_ID = "claude-sonnet-4-6";
const BIOMARKER_MAX_TOKENS = 200;

/**
 * Story 4.3 — diagnostic-phrasing regex (mirrors the constant in
 * `@healthtracker/validators` — services/llm cannot import the
 * validators package, so the regex is duplicated here. The two
 * literals MUST stay in sync; a snapshot test in
 * `__tests__/biomarker-suggestion.test.ts` pins both halves.
 */
const DIAGNOSTIC_PHRASE_REGEX = /\b(você tem|isso indica|você deve)\b/iu;

const COOLDOWN_MS = 60_000;

interface RequestBody {
  biomarkerName: unknown;
  value: unknown;
  unitUcum: unknown;
  loincCode: unknown;
}

interface ParsedBody {
  biomarkerName: string;
  value: number;
  unitUcum: string;
  loincCode: string | null;
}

function parseBody(body: unknown): ParsedBody | null {
  if (typeof body !== "object" || body === null) return null;
  const b = body as RequestBody;
  if (
    typeof b.biomarkerName !== "string" ||
    b.biomarkerName.length === 0 ||
    typeof b.value !== "number" ||
    !Number.isFinite(b.value) ||
    typeof b.unitUcum !== "string" ||
    b.unitUcum.length === 0
  ) {
    return null;
  }
  const loincCode =
    typeof b.loincCode === "string" && b.loincCode.length > 0
      ? b.loincCode
      : null;
  return {
    biomarkerName: b.biomarkerName,
    value: b.value,
    unitUcum: b.unitUcum,
    loincCode,
  };
}

/**
 * Story 4.3 — `POST /api/biomarker-suggestion`.
 *
 * Auth: same Supabase JWT pattern as letter-stream. Cooldown: per
 * `(userId, loincCode)` (or `(userId, biomarkerName)` when LOINC is
 * absent), 60 s in-memory TTL — single-process scope (Railway runs
 * one persistent server). Anti-pattern: never include the LOINC code
 * or any extraction confidence in the user prompt.
 *
 * Post-filter: if the model returns a diagnostic phrase
 * (`você tem` / `isso indica` / `você deve`), the route substitutes
 * a fallback string and emits an ops-visible warning. The fallback
 * surface lives in the API layer (`BIOMARKER_SUGGESTION_FALLBACK_PT_BR`);
 * services/llm cannot import validators, so the fallback is duplicated
 * here. The two strings MUST stay in sync.
 */
const FALLBACK_PT_BR =
  "Pode valer a pena discutir esse resultado com o seu médico em sua próxima consulta.";

export function registerBiomarkerSuggestionRoute(
  app: FastifyInstance,
  deps: { llm: LLMAdapter },
): void {
  const cooldown = new Map<string, number>();
  const scheduleGc = (key: string): void => {
    setTimeout(() => cooldown.delete(key), COOLDOWN_MS).unref();
  };

  app.post(
    "/api/biomarker-suggestion",
    async (request: FastifyRequest, reply: FastifyReply) => {
      const userId = await verifyJwt(request.headers.authorization);
      if (!userId) {
        await reply.code(401).send({ error: "unauthorized" });
        return;
      }
      const parsed = parseBody(request.body);
      if (!parsed) {
        await reply.code(400).send({ error: "invalid_body" });
        return;
      }

      const key = `${userId}.${parsed.loincCode ?? parsed.biomarkerName}`;
      const lastCall = cooldown.get(key);
      if (lastCall !== undefined && Date.now() - lastCall < COOLDOWN_MS) {
        await reply.code(429).send({ code: "COOLDOWN" });
        return;
      }
      cooldown.set(key, Date.now());
      scheduleGc(key);

      try {
        const result = await deps.llm.generateBiomarkerSuggestion({
          system: ANVISA_SYSTEM_PROMPT,
          userPrompt: buildBiomarkerSuggestionPrompt({
            biomarkerName: parsed.biomarkerName,
            value: parsed.value,
            unitUcum: parsed.unitUcum,
          }),
          model: BIOMARKER_MODEL_ID,
          maxTokens: BIOMARKER_MAX_TOKENS,
        });
        const sanitised = DIAGNOSTIC_PHRASE_REGEX.test(result.body)
          ? FALLBACK_PT_BR
          : result.body;
        if (sanitised !== result.body) {
          console.warn(
            `[biomarker-suggestion] ANVISA post-filter triggered for userId=${userId} biomarker=${parsed.biomarkerName} — fallback returned`,
          );
        }
        await reply.code(200).send({
          suggestion: sanitised,
          model: result.model,
          tokensUsed: result.tokensUsed,
        });
      } catch (err) {
        console.error(
          `[biomarker-suggestion] generation failed for userId=${userId} biomarker=${parsed.biomarkerName}`,
          err,
        );
        await reply.code(502).send({ error: "llm_unavailable" });
      }
    },
  );
}
