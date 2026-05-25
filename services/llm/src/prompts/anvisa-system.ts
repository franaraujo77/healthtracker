/**
 * Story 4.1 — ANVISA RDC 657/2022 system-prompt enforcement.
 *
 * Verbatim transcript of `_bmad-output/planning-artifacts/architecture.md`
 * §6 lines 742–756. Every LLM call that generates patient-facing
 * content MUST include this instruction.
 *
 * Anti-pattern (architecture enforcement rule 6, line 900): never
 * substring-strip the qualifiers in post-processing. ANVISA framing
 * survives at the prompt layer; if Claude returns a non-conforming
 * sample the path is regenerate, not sanitize.
 *
 * The framing example is in pt-BR (the patient surface language) so
 * Claude latches onto the target register inside the system message.
 */
export const ANVISA_SYSTEM_PROMPT = `All clinical observations are informational only. Where relevant, frame findings as: "pode valer a pena discutir com um [tipo de especialista]" (it may be worth discussing with a [specialist type]). Never state, imply, or suggest a diagnosis. Never recommend specific medications, doses, or treatments.`;
