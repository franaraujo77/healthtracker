import { z } from "zod/v4";

/**
 * Story 7.2 — emotional check-in validators and pt-BR copy.
 *
 * Pre-results emotional check-in: a patient with a newly-published
 * draw records how they're feeling BEFORE the results screen renders
 * the first time. Five closed-enum states + a Pular escape. Story 7.3
 * will add a symmetric `type='post'` check-in against the same table.
 *
 * **Privacy backbone (AC5, AC7).** `privacy_flag = 'patient_only'`
 * unconditionally; the audit kind `'emotional_checkin.recorded'` is
 * deliberately NOT in `ACCESS_LOG_EVENT_KINDS` (Acessos tab surfaces
 * only doctor-access events; personal context never belongs there).
 *
 * Schema twin: `packages/db/src/schema/emotional_checkins.ts`.
 */

/** AC9 — closed 5-state enum (source of truth; pgEnum mirror). */
export const EMOTIONAL_CHECKIN_STATES = [
  "hopeful",
  "worried",
  "curious",
  "exhausted",
  "unsure",
] as const;
export type EmotionalCheckinState = (typeof EMOTIONAL_CHECKIN_STATES)[number];

/**
 * AC9 — `type` discriminator. Story 7.2 writes `'pre'` only; Story 7.3
 * will write `'post'`. The Zod input schema literal-rejects anything
 * other than `'pre'` at the boundary today.
 */
export const EMOTIONAL_CHECKIN_TYPES = ["pre", "post"] as const;
export type EmotionalCheckinType = (typeof EMOTIONAL_CHECKIN_TYPES)[number];

/**
 * AC10 — separate privacy enum (deferred unification with
 * `life_event_privacy_flag_enum` until Story 7.6's batched migration).
 */
export const EMOTIONAL_CHECKIN_PRIVACY_FLAGS = ["patient_only"] as const;
export type EmotionalCheckinPrivacyFlag =
  (typeof EMOTIONAL_CHECKIN_PRIVACY_FLAGS)[number];

/** AC2 — pt-BR labels for the 5 buttons (stable order matches enum). */
export const EMOTIONAL_CHECKIN_STATE_LABELS_PT_BR: Record<
  EmotionalCheckinState,
  string
> = {
  hopeful: "Esperançoso",
  worried: "Preocupado",
  curious: "Curioso",
  exhausted: "Exausto",
  unsure: "Não sei",
};

/**
 * AC1 / AC5 / AC6 — `recordPreResults` mutation input. Story 7.2 is
 * the only writer of `type='pre'`; `post` is forward-compat for
 * Story 7.3 and rejects at the Zod boundary here.
 */
export const recordEmotionalCheckInInputSchema = z
  .object({
    uploadId: z.string().uuid(),
    state: z.enum(EMOTIONAL_CHECKIN_STATES),
    type: z.literal("pre"),
  })
  .strict();
export type RecordEmotionalCheckInInput = z.infer<
  typeof recordEmotionalCheckInInputSchema
>;

export const emotionalCheckInViewSchema = z.object({
  id: z.string().uuid(),
  uploadId: z.string().uuid(),
  state: z.enum(EMOTIONAL_CHECKIN_STATES),
  type: z.enum(EMOTIONAL_CHECKIN_TYPES),
  privacyFlag: z.enum(EMOTIONAL_CHECKIN_PRIVACY_FLAGS),
  createdAt: z.string(),
});
export type EmotionalCheckInView = z.infer<typeof emotionalCheckInViewSchema>;

// ---------------------------------------------------------------------------
// pt-BR UI copy — every visible string lives here.
// ---------------------------------------------------------------------------

export const EMOTIONAL_CHECKIN_SHEET_TITLE_PT_BR =
  "Antes de ver seus resultados, como você está?";

export const EMOTIONAL_CHECKIN_ACKNOWLEDGMENT_PT_BR =
  "Obrigado por compartilhar como você está.";

export const EMOTIONAL_CHECKIN_SKIP_PT_BR = "Pular";

export const EMOTIONAL_CHECKIN_SHEET_A11Y_LABEL_PT_BR =
  "Registre como você está se sentindo antes de ver os resultados";

export const EMOTIONAL_CHECKIN_SAVE_ERROR_PT_BR =
  "Não conseguimos salvar — tente novamente.";

/**
 * Acknowledgment toast duration in milliseconds (AC3). Picked to match
 * UX-DR § "Modal bottom sheet transition timings" (long enough to read
 * one short pt-BR sentence; short enough to not feel like a block).
 */
export const EMOTIONAL_CHECKIN_ACKNOWLEDGMENT_MS = 1500;
