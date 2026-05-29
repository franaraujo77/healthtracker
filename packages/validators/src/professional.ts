import { z } from "zod/v4";

/**
 * Story 6.3 — Doctor activates a professional account from the
 * Conversation Starter view.
 *
 * Closed enum mirrors the Postgres `professional_category_enum`
 * pgEnum defined in `packages/db/src/schema/professionals.ts`. Any
 * new category requires (a) Drizzle enum value addition, (b) this
 * Zod enum, and (c) the pt-BR label below — all three together or
 * none (AC7).
 */
export const PROFESSIONAL_CATEGORY_VALUES = [
  "endocrinologista",
  "cardiologista",
  "medicina_esportiva",
  "nutrologo",
  "nutricionista",
  "clinico_geral",
  "outro",
] as const;

export const professionalCategorySchema = z.enum(PROFESSIONAL_CATEGORY_VALUES);
export type ProfessionalCategory = z.infer<typeof professionalCategorySchema>;

/**
 * pt-BR labels for the activation modal's `<Select>` and any future
 * doctor-facing surface. Lives next to the schema so a copy review
 * is grep-able.
 */
export const PROFESSIONAL_CATEGORY_LABEL_PT_BR: Record<
  ProfessionalCategory,
  string
> = {
  endocrinologista: "Endocrinologista",
  cardiologista: "Cardiologista",
  medicina_esportiva: "Medicina esportiva",
  nutrologo: "Nutrólogo(a)",
  nutricionista: "Nutricionista",
  clinico_geral: "Clínico geral",
  outro: "Outro",
};

/**
 * AC3 — input contract for `sharingRouter.activateProfessionalAccount`.
 * `tokenHmac` is required even though `doctorProcedure` already pins
 * the GUC (defense-in-depth — mirrors `getConversationStarter`).
 */
export const activateProfessionalAccountInputSchema = z.object({
  shareTokenId: z.uuid(),
  tokenHmac: z.string().min(1).max(128),
  displayName: z.string().trim().min(1).max(80),
  category: professionalCategorySchema,
});
export type ActivateProfessionalAccountInput = z.infer<
  typeof activateProfessionalAccountInputSchema
>;

export const activateProfessionalAccountOutputSchema = z.object({
  activated: z.literal(true),
  displayName: z.string(),
  category: professionalCategorySchema,
  alreadyActivated: z.boolean(),
});
export type ActivateProfessionalAccountOutput = z.infer<
  typeof activateProfessionalAccountOutputSchema
>;

/**
 * AC4 — input + output for `sharingRouter.getActivationStatus`.
 * Activation is keyed on `auth.uid()`, NOT on the share-token: a
 * doctor activated via patient A's token IS activated when viewing
 * patient B's report (Doctor Acquisition Loop closure).
 */
export const getActivationStatusInputSchema = z.object({}).strict();
export const getActivationStatusOutputSchema = z.object({
  activated: z.boolean(),
  displayName: z.string().nullable(),
  category: professionalCategorySchema.nullable(),
});
export type GetActivationStatusOutput = z.infer<
  typeof getActivationStatusOutputSchema
>;

/**
 * AC8 — audit kind constant. **NOT** in `ACCESS_LOG_EVENT_KINDS`
 * (AC6 / AC10): professional account activation is doctor-side
 * identity binding, not patient-data access. The patient does NOT
 * see this event in their Access Log.
 */
export const PROFESSIONAL_ACCOUNT_ACTIVATED_AUDIT =
  "professional_account.activated" as const;

// ---------------------------------------------------------------------------
// pt-BR copy — banner (AC1)
// ---------------------------------------------------------------------------

export const PROFESSIONAL_ACTIVATION_BANNER_HEADING_PT_BR =
  "Ative sua conta profissional";
export const PROFESSIONAL_ACTIVATION_BANNER_SUBHEADING_PT_BR =
  "Receba os próximos compartilhamentos dos seus pacientes em um só lugar.";
export const PROFESSIONAL_ACTIVATION_BANNER_CTA_PT_BR = "Ativar conta";
export const PROFESSIONAL_ACTIVATION_BANNER_DISMISS_A11Y_PT_BR = "Fechar";

// ---------------------------------------------------------------------------
// pt-BR copy — modal (AC2)
// ---------------------------------------------------------------------------

export const PROFESSIONAL_ACTIVATION_MODAL_HEADING_PT_BR =
  "Ative sua conta profissional";
export const PROFESSIONAL_ACTIVATION_EMAIL_LABEL_PT_BR = "E-mail (verificado)";
export const PROFESSIONAL_ACTIVATION_DISPLAY_NAME_LABEL_PT_BR =
  "Como você quer aparecer para seus pacientes";
export const PROFESSIONAL_ACTIVATION_CATEGORY_LABEL_PT_BR = "Especialidade";
export const PROFESSIONAL_ACTIVATION_CATEGORY_PLACEHOLDER_PT_BR = "Selecione…";
export const PROFESSIONAL_ACTIVATION_CATEGORY_REQUIRED_PT_BR =
  "Selecione uma categoria";
export const PROFESSIONAL_ACTIVATION_DISPLAY_NAME_REQUIRED_PT_BR =
  "Informe um nome.";
export const PROFESSIONAL_ACTIVATION_CTA_PT_BR = "Ativar conta";
export const PROFESSIONAL_ACTIVATION_CTA_LOADING_PT_BR = "Ativando…";
export const PROFESSIONAL_ACTIVATION_GENERIC_ERROR_PT_BR =
  "Não foi possível ativar agora. Tente novamente.";
export const PROFESSIONAL_ACTIVATION_CONFLICT_PT_BR =
  "Este link já foi vinculado a outro profissional.";
export const PROFESSIONAL_ACTIVATION_SUCCESS_PT_BR =
  "Conta ativada. Em breve você poderá convidar pacientes.";

/**
 * AC3 — the resolver throws `TRPCError({ code: "CONFLICT", message: this })`
 * when a different doctor's `auth.uid()` already claimed the invite.
 * Client matches on this exact string to swap the generic-error UI for
 * the conflict-specific pt-BR copy.
 */
export const INVITE_ALREADY_CLAIMED_BY_DIFFERENT_DOCTOR =
  "INVITE_ALREADY_CLAIMED_BY_DIFFERENT_DOCTOR" as const;
