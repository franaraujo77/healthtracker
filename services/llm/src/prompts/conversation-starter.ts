/**
 * Story 6.2 AC9 / T7.2 — system + user prompt for the Conversation
 * Starter. Output is JSON-only; the consumer Zod-validates against
 * `conversationStarterPayloadSchema`.
 *
 * ANVISA-compliant framing: no diagnoses, no medical advice; phrase
 * any suggestion as "pode valer a pena discutir" (mirrors the
 * `letter-prompt.ts` + `biomarker-suggestion-prompt.ts` discipline).
 *
 * Prompt content is product-sensitive; round-1 review should sign off
 * on the wording before any DPA-gated production rollout.
 */

export interface ConversationStarterPromptObservation {
  category: string;
  value: number;
  /** ISO `yyyy-mm-dd`. */
  collectedAt: string;
}

export interface BuildConversationStarterPromptArgs {
  visibleBiomarkers: { category: string }[];
  observationsSnapshot: ConversationStarterPromptObservation[];
}

const SYSTEM_MESSAGE = [
  "Você gera uma síntese de conversa para um médico brasileiro a partir de dados longitudinais de exames do paciente.",
  "Não dê conselhos médicos. Não diagnostique. Use enquadramento conforme ANVISA — quando sugerir, escreva 'pode valer a pena discutir'.",
  "Saída exclusivamente em JSON conforme o seguinte esquema:",
  "{",
  '  "prompts": [{ "text": string }, ...]  // 1 a 6 prompts curtos para iniciar a conversa, em pt-BR',
  '  "biomarkerCards": [{',
  '    "category": string,',
  '    "currentValue": number | null,',
  '    "previousValue": number | null,',
  '    "trendDirection": "up" | "down" | "flat" | null,',
  '    "patientBaseline": number | null',
  "  }, ...]  // um por categoria de biomarcador visível",
  "}",
  "Não emita nenhum texto fora do JSON.",
].join("\n");

export function buildConversationStarterPrompt(
  args: BuildConversationStarterPromptArgs,
): { system: string; userPrompt: string } {
  const categories = args.visibleBiomarkers
    .map((b) => `- ${b.category}`)
    .join("\n");
  const obs = args.observationsSnapshot
    .map((o) => `- ${o.category}: ${o.value} (coleta ${o.collectedAt})`)
    .join("\n");
  const userPrompt = [
    "Categorias de biomarcadores visíveis ao médico:",
    categories.length > 0 ? categories : "(nenhuma)",
    "",
    "Últimas medições (até 3 por categoria, ordem decrescente por data):",
    obs.length > 0 ? obs : "(nenhuma)",
    "",
    "Tarefa: gere 3 prompts breves para o médico iniciar a conversa com o paciente, e cards de biomarcador resumindo current/previous/tendência por categoria. JSON apenas.",
  ].join("\n");
  return { system: SYSTEM_MESSAGE, userPrompt };
}
