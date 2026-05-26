import { z } from "zod/v4";

/**
 * Story 5.1 — input schemas for `sharingRouter` procedures + a small
 * suite of pt-BR copy constants and a11y helpers consumed by the
 * `ShareBiomarkerToggle` component and the Compartilhar route stack
 * on both Expo and Web. All pt-BR strings live here per repo
 * convention (Epic 2 retro — copy review is grep-able).
 */

// ---------------------------------------------------------------------------
// Audit kinds (AC12)
// ---------------------------------------------------------------------------

/**
 * Sharing audit event names. Use these constants everywhere — never
 * inline-string the event name. Mirrors the `LETTER_AUDIT_*` pattern
 * from Story 4.1.
 *
 * NOTE: `audit_log(resource_id, event)` has no partial unique index
 * covering these events — legitimate multiple `sharing.configured`
 * rows per share_token (one per toggle batch). See AC12.
 */
export const SHARING_AUDIT_PENDING_INVITE_CREATED =
  "pending_invite.created" as const;
export const SHARING_AUDIT_TOKEN_CREATED = "share_token.created" as const;
export const SHARING_AUDIT_CONFIGURED = "sharing.configured" as const;

// ---------------------------------------------------------------------------
// Zod input schemas (T5.1)
// ---------------------------------------------------------------------------

export const createPendingInviteInputSchema = z.object({
  displayName: z.string().trim().min(1).max(80),
  identifier: z.string().trim().min(3).max(254),
});
export type CreatePendingInviteInput = z.infer<
  typeof createPendingInviteInputSchema
>;

export const createShareTokenInputSchema = z.object({
  inviteId: z.uuid(),
});
export type CreateShareTokenInput = z.infer<typeof createShareTokenInputSchema>;

export const configureBiomarkersInputSchema = z.object({
  shareTokenId: z.uuid(),
  scope: z
    .array(
      z.object({
        biomarkerCategory: z.string().trim().min(1).max(120),
        visible: z.boolean(),
      }),
    )
    .min(1)
    .max(64),
});
export type ConfigureBiomarkersInput = z.infer<
  typeof configureBiomarkersInputSchema
>;

export const getDraftConfigInputSchema = z.object({
  shareTokenId: z.uuid(),
});
export type GetDraftConfigInput = z.infer<typeof getDraftConfigInputSchema>;

// ---------------------------------------------------------------------------
// pt-BR copy + a11y (T5.2)
// ---------------------------------------------------------------------------

export const SHARE_TOKEN_INVALID_PT_BR =
  "Este compartilhamento não está mais disponível.";

export const SHARE_PREMIUM_REQUIRED_PT_BR =
  "Compartilhamento com médicos está disponível no plano Premium. Toque para saber mais.";

export const NO_DATA_YET_PT_BR = "Sem dados ainda";

export function BIOMARKER_HIDDEN_PT_BR_FN(
  biomarker: string,
  doctorName: string,
): string {
  return `${biomarker} oculta do Dr. ${doctorName}`;
}

export function BIOMARKER_VISIBLE_PT_BR_FN(
  biomarker: string,
  doctorName: string,
): string {
  return `${biomarker} visível ao Dr. ${doctorName}`;
}

export function SHARE_TOGGLE_A11Y_LABEL_PT_BR_FN(
  biomarkerLabel: string,
  visible: boolean,
  doctorName: string,
): string {
  return `${biomarkerLabel}: atualmente ${visible ? "visível" : "oculto"} do Dr. ${doctorName}`;
}

export const BIOMARKER_TOGGLE_FAILED_PT_BR =
  "Não foi possível salvar. Tente novamente.";

export const DOCTOR_DISPLAY_NAME_LABEL_PT_BR =
  "Como você quer chamar este profissional?";
export const DOCTOR_IDENTIFIER_LABEL_PT_BR = "Email ou CRM do médico";

/** AC8 — hard-coded default expiry window. Story 5.2 reads this. */
export const SHARE_DEFAULT_DURATION_DAYS = 7;

// ---------------------------------------------------------------------------
// Route helpers (Compartilhar tab)
// ---------------------------------------------------------------------------

export const COMPARTILHAR_ROUTE = "/compartilhar";
export const COMPARTILHAR_NOVO_IDENTIFICACAO_ROUTE =
  "/compartilhar/novo/identificacao";
export const COMPARTILHAR_NOVO_DURACAO_ROUTE = "/compartilhar/novo/duracao";

export function compartilharBiomarcadoresRoute(shareTokenId: string): string {
  return `/compartilhar/${shareTokenId}/biomarcadores`;
}

export function compartilharConcluidoRoute(shareTokenId: string): string {
  return `/compartilhar/${shareTokenId}/concluido`;
}

// ---------------------------------------------------------------------------
// Compartilhar landing + ceremony copy
// ---------------------------------------------------------------------------

export const COMPARTILHAR_TAB_LABEL_PT_BR = "Compartilhar";
export const COMPARTILHAR_TITLE_PT_BR = "Compartilhar";
export const COMPARTILHAR_NEW_CTA_PT_BR = "Novo compartilhamento";
export const COMPARTILHAR_EMPTY_HEADLINE_PT_BR =
  "Você ainda não compartilhou seus exames";
export const COMPARTILHAR_LOADING_PT_BR = "Carregando…";
export const COMPARTILHAR_ERROR_PT_BR =
  "Não foi possível carregar agora. Tente novamente.";

export const COMPARTILHAR_NOVO_IDENTIFICACAO_TITLE_PT_BR =
  "Para quem você quer compartilhar?";
export const COMPARTILHAR_NOVO_CONTINUE_CTA_PT_BR = "Continuar";
export const COMPARTILHAR_NOVO_DURACAO_PROGRESS_PT_BR =
  "Criando compartilhamento de 7 dias…";
export const COMPARTILHAR_BIOMARCADORES_TITLE_PT_BR =
  "O que o médico poderá ver?";
export const COMPARTILHAR_BIOMARCADORES_DONE_CTA_PT_BR = "Concluir";
export const COMPARTILHAR_CONCLUIDO_PT_BR = "Pronto.";
