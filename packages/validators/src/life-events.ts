import { z } from "zod/v4";

import { todayInSaoPauloIso } from "./collected-at";

/**
 * Story 7.1 — life-event validators and pt-BR copy.
 *
 * Life events are patient-authored timeline markers that contextualize
 * biomarker trends ("comecei nova rotina de treino", "viagem para o
 * Japão", etc.). They are STRICTLY `privacy_flag = 'patient_only'` for
 * Story 7.1 — Epic 7's privacy backbone (FR47) requires explicit
 * opt-in before any doctor surface can read them. No doctor RLS
 * policy ships in this story (doctor-zero-rows invariant).
 *
 * PII discipline: the free-text `description` is the most sensitive
 * field this story touches — never logged, never echoed in audit
 * metadata. The `life_event.created` audit row carries
 * `{eventDate, category}` only.
 *
 * Schema twin: `packages/db/src/schema/life_events.ts`.
 */

/** AC1 — free-text description, 1..140 chars after trim. */
export const LIFE_EVENT_DESCRIPTION_MIN = 1;
export const LIFE_EVENT_DESCRIPTION_MAX = 140;

/**
 * AC1 — optional category tag (single select). Kept narrow so the
 * pt-BR mobile UI can render a fixed chip list without translating
 * arbitrary user-entered strings.
 *
 * Mirrors `life_event_category_enum` in the Drizzle schema.
 */
export const LIFE_EVENT_CATEGORIES = [
  "health",
  "lifestyle",
  "travel",
  "stress",
  "medication",
  "other",
] as const;
export type LifeEventCategory = (typeof LIFE_EVENT_CATEGORIES)[number];

/**
 * AC2 — privacy flag. Story 7.1 ships `'patient_only'` only; the enum
 * is forward-looking so Story 7.x (or a future explicit-consent
 * sharing surface) can add `'shared_with_doctor'` without a schema
 * migration.
 */
export const LIFE_EVENT_PRIVACY_FLAGS = ["patient_only"] as const;
export type LifeEventPrivacyFlag = (typeof LIFE_EVENT_PRIVACY_FLAGS)[number];

/** pt-BR labels for the category chips. */
export const LIFE_EVENT_CATEGORY_LABELS_PT_BR: Record<
  LifeEventCategory,
  string
> = {
  health: "Saúde",
  lifestyle: "Estilo de vida",
  travel: "Viagem",
  stress: "Estresse",
  medication: "Medicação",
  other: "Outro",
};

const isoDateRegex = /^\d{4}-\d{2}-\d{2}$/;

/**
 * AC1 / AC6 — `createLifeEvent` mutation input.
 *
 * `eventDate` is a `yyyy-mm-dd` calendar date (no time component;
 * Postgres `DATE`). The retroactive-only refine rejects future dates
 * relative to São Paulo "today" — patients can mark past life
 * events but cannot pre-date events into the future. Computed at
 * Zod-refine time (NOT module load) so a long-lived server process
 * doesn't freeze "today" at boot.
 */
/**
 * Calendar-validity check — defense against malformed ISO strings that
 * pass the regex but aren't real dates (e.g. `2024-02-30`, `2024-13-01`).
 * Without this guard the resolver would forward the value to Postgres'
 * `DATE` parser and surface a generic 500-class error instead of the
 * friendly pt-BR `LIFE_EVENT_EVENT_DATE_INVALID` validation message.
 * Mirrors the defense-in-depth pattern used by `BiaSubmissionSchema`'s
 * `collectedAt` refine.
 */
function isRealIsoDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const y = Number(match[1]);
  const m = Number(match[2]);
  const d = Number(match[3]);
  if (y < 1900 || y > 2100) return false;
  if (m < 1 || m > 12) return false;
  if (d < 1 || d > 31) return false;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return (
    dt.getUTCFullYear() === y &&
    dt.getUTCMonth() === m - 1 &&
    dt.getUTCDate() === d
  );
}

export const createLifeEventInputSchema = z.object({
  eventDate: z
    .string()
    .regex(isoDateRegex, "LIFE_EVENT_EVENT_DATE_INVALID")
    .refine(isRealIsoDate, { message: "LIFE_EVENT_EVENT_DATE_INVALID" })
    .refine((value) => value <= todayInSaoPauloIso(), {
      message: "LIFE_EVENT_EVENT_DATE_FUTURE",
    }),
  description: z
    .string()
    .trim()
    .min(LIFE_EVENT_DESCRIPTION_MIN, "LIFE_EVENT_DESCRIPTION_REQUIRED")
    .max(LIFE_EVENT_DESCRIPTION_MAX, "LIFE_EVENT_DESCRIPTION_TOO_LONG"),
  category: z.enum(LIFE_EVENT_CATEGORIES).nullable().optional(),
});
export type CreateLifeEventInput = z.infer<typeof createLifeEventInputSchema>;

export const createLifeEventOutputSchema = z.object({
  id: z.string().uuid(),
  eventDate: z.string().regex(isoDateRegex),
  description: z.string(),
  category: z.enum(LIFE_EVENT_CATEGORIES).nullable(),
  privacyFlag: z.enum(LIFE_EVENT_PRIVACY_FLAGS),
});
export type CreateLifeEventOutput = z.infer<typeof createLifeEventOutputSchema>;

/**
 * AC3 — `listInWindow` query: the Fingerprint chart asks for life
 * events whose `event_date` falls inside the visible time window
 * (the chart caller derives the window from its observation history).
 */
export const listLifeEventsInWindowInputSchema = z
  .object({
    fromDate: z.string().regex(isoDateRegex, "LIFE_EVENT_FROM_DATE_INVALID"),
    toDate: z.string().regex(isoDateRegex, "LIFE_EVENT_TO_DATE_INVALID"),
  })
  .refine((val) => val.fromDate <= val.toDate, {
    message: "LIFE_EVENT_WINDOW_INVERTED",
  });
export type ListLifeEventsInWindowInput = z.infer<
  typeof listLifeEventsInWindowInputSchema
>;

export const lifeEventViewSchema = z.object({
  id: z.string().uuid(),
  eventDate: z.string().regex(isoDateRegex),
  description: z.string(),
  category: z.enum(LIFE_EVENT_CATEGORIES).nullable(),
  privacyFlag: z.enum(LIFE_EVENT_PRIVACY_FLAGS),
});
export type LifeEventView = z.infer<typeof lifeEventViewSchema>;

export const listLifeEventsInWindowOutputSchema = z.object({
  events: z.array(lifeEventViewSchema),
});
export type ListLifeEventsInWindowOutput = z.infer<
  typeof listLifeEventsInWindowOutputSchema
>;

// ---------------------------------------------------------------------------
// pt-BR UI copy — centralised so the mobile sheet, web, and any future
// surface share one source of truth.
// ---------------------------------------------------------------------------

export const LIFE_EVENT_CTA_PT_BR = "Adicionar evento de vida";
export const LIFE_EVENT_SHEET_TITLE_PT_BR = "Adicionar evento de vida";
export const LIFE_EVENT_DESCRIPTION_LABEL_PT_BR = "O que aconteceu?";
export const LIFE_EVENT_DESCRIPTION_PLACEHOLDER_PT_BR =
  "Ex.: comecei nova rotina de treino";
export const LIFE_EVENT_DATE_LABEL_PT_BR = "Quando aconteceu?";
export const LIFE_EVENT_CATEGORY_LABEL_PT_BR = "Categoria (opcional)";
export const LIFE_EVENT_PRIVACY_HINT_PT_BR =
  "Este evento fica visível apenas para você. Não é compartilhado com nenhum médico.";
export const LIFE_EVENT_SAVE_PT_BR = "Salvar";
export const LIFE_EVENT_CANCEL_PT_BR = "Cancelar";
export const LIFE_EVENT_SAVED_TOAST_PT_BR =
  "Evento salvo na sua linha do tempo.";
export const LIFE_EVENT_SAVE_ERROR_PT_BR =
  "Não foi possível salvar o evento. Tente novamente.";

export const LIFE_EVENT_VALIDATION_MESSAGES_PT_BR: Record<string, string> = {
  LIFE_EVENT_DESCRIPTION_REQUIRED: "Conte brevemente o que aconteceu.",
  LIFE_EVENT_DESCRIPTION_TOO_LONG: `Use no máximo ${LIFE_EVENT_DESCRIPTION_MAX} caracteres.`,
  LIFE_EVENT_EVENT_DATE_INVALID: "Selecione uma data válida.",
  LIFE_EVENT_EVENT_DATE_FUTURE: "A data não pode ser no futuro.",
  LIFE_EVENT_WINDOW_INVERTED: "Intervalo de datas inválido.",
};
