/**
 * Story 4.3 — user-message payload for the synchronous biomarker
 * suggestion path. Strict: never include the LOINC code or any
 * extraction-confidence numbers in the prompt (architecture
 * enforcement rule 6). Only the patient-facing biomarker name + the
 * value + unit reach the model.
 *
 * Tone: brief, calm, conversational pt-BR. Asks Claude for exactly
 * one question the patient could raise with their doctor — phrased
 * as a question, never as a diagnosis (paired with the ANVISA
 * system prompt at the adapter layer).
 */

export interface BuildBiomarkerSuggestionPromptArgs {
  biomarkerName: string;
  value: number;
  unitUcum: string;
}

export function buildBiomarkerSuggestionPrompt(
  args: BuildBiomarkerSuggestionPromptArgs,
): string {
  return [
    "Você está sugerindo uma única pergunta que um paciente brasileiro pode fazer ao seu médico em uma consulta.",
    "Tom: calmo, breve, em português brasileiro coloquial.",
    "Comprimento: aproximadamente 50 palavras, no máximo duas frases.",
    "Estrutura: a saída deve ser exatamente uma pergunta — termina com '?'.",
    "Nunca diagnostique; sempre enquadre como 'pode valer a pena discutir com [tipo de especialista]' ou como uma pergunta direta que o paciente faz.",
    "",
    `Biomarcador: ${args.biomarkerName}`,
    `Valor atual: ${args.value} ${args.unitUcum}`,
  ].join("\n");
}
