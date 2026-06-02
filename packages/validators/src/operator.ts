import { z } from "zod/v4";

/**
 * Story 8.1 — route constants, pt-BR copy, and the input schema for the
 * operator anonymised review-queue surface (`/operador/*`). Every
 * visible literal lives here (greppable-copy discipline); pages/
 * components import these constants — never hard-code pt-BR strings.
 */

/** The operator review-queue list route. */
export const OPERATOR_REVIEW_QUEUE_ROUTE = "/operador/fila";

/** The operator review-queue detail route for one upload. */
export const operatorQueueItemRoute = (uploadId: string): string =>
  `/operador/fila/${uploadId}`;

/** `getQueueItem` input — `.strict()` so unknown keys reject. */
export const getOperatorQueueItemInputSchema = z
  .object({ uploadId: z.uuid() })
  .strict();

export type GetOperatorQueueItemInput = z.infer<
  typeof getOperatorQueueItemInputSchema
>;

// --- List view copy ---
export const OPERATOR_QUEUE_HEADING_PT_BR = "Fila de revisão manual";
export const OPERATOR_QUEUE_SUBHEADING_PT_BR =
  "Resultados que precisam de revisão manual — apenas dados anonimizados.";
/** AC4 — exact empty-state string. */
export const OPERATOR_QUEUE_EMPTY_PT_BR =
  "Fila vazia — todos os resultados foram revisados";
export const OPERATOR_QUEUE_PATIENT_LABEL_PT_BR = "ID do paciente";
export const OPERATOR_QUEUE_LAB_LABEL_PT_BR = "Laboratório";
export const OPERATOR_QUEUE_COLLECTED_LABEL_PT_BR = "Data de coleta";
/** AC7 fallback when `lab_name` is NULL (rows written before Story 8.1). */
export const LABORATORY_UNIDENTIFIED_PT_BR = "Laboratório não identificado";
export const operatorQueueFlaggedFieldsLabelPtBr = (n: number): string =>
  `${n} ${n === 1 ? "campo" : "campos"} para revisar`;

// --- Detail view copy ---
export const OPERATOR_DETAIL_HEADING_PT_BR = "Campos sinalizados";
export const OPERATOR_DETAIL_VALUE_LABEL_PT_BR = "Valor extraído";
export const OPERATOR_DETAIL_RAW_LABEL_PT_BR = "Texto bruto (OCR)";
export const OPERATOR_DETAIL_CONFIDENCE_LABEL_PT_BR = "Confiança";
export const OPERATOR_DETAIL_EMPTY_PT_BR =
  "Nenhum campo pendente para este envio.";
export const OPERATOR_BACK_TO_QUEUE_PT_BR = "← Voltar para a fila";

// --- Access-denied card (non-allowlisted authenticated user) ---
export const OPERATOR_ACCESS_DENIED_HEADING_PT_BR =
  "Acesso restrito a operadores";
export const OPERATOR_ACCESS_DENIED_BODY_PT_BR =
  "Sua conta não tem permissão para acessar a fila de revisão.";

/** Render a [0,1] confidence score as a whole-percent string (e.g. "71%"). */
export const formatConfidencePct = (score: number): string =>
  `${Math.round(score * 100)}%`;

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Render the unparsed `collected_at_text` for the operator UI. The value
 * is free-form source text (Story 2.4 carried it through unparsed), so
 * it may already be pt-BR (e.g. "12/03/2024") or ISO. Only reformat when
 * it is an ISO date; otherwise show it as-is. NULL → "—".
 */
export const formatOperatorCollectedAt = (
  collectedAtText: string | null,
): string => {
  if (!collectedAtText) return "—";
  if (!ISO_DATE_RE.test(collectedAtText)) return collectedAtText;
  const [year, month, day] = collectedAtText.split("-");
  return `${day}/${month}/${year}`;
};
