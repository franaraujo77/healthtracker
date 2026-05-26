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

/**
 * Story 5.2 — Conversation Starter pre-gen lifecycle audit kinds.
 * `queued` fires inside the same tx as `share_token.created`;
 * `generated` / `failed` fire from the `services/llm` worker after
 * pg-boss processes the `conversation_starter.generate` job.
 */
export const SHARING_AUDIT_CONVERSATION_STARTER_QUEUED =
  "conversation_starter.queued" as const;
export const SHARING_AUDIT_CONVERSATION_STARTER_GENERATED =
  "conversation_starter.generated" as const;
export const SHARING_AUDIT_CONVERSATION_STARTER_FAILED =
  "conversation_starter.failed" as const;

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

/**
 * Story 5.2 — duration enum. `"no_expiry"` is the "Sem prazo" branch;
 * server maps to NULL `expires_at`. The picker screen owns the default
 * selection of `"7d"` — there is intentionally NO server-side default
 * on this field (a caller that "forgot" to pick should surface as a
 * Zod validation error rather than be silently coerced).
 */
export const shareDurationSchema = z.enum(["24h", "7d", "30d", "no_expiry"]);
export type ShareDuration = z.infer<typeof shareDurationSchema>;

export const createShareTokenInputSchema = z.object({
  inviteId: z.uuid(),
  duration: shareDurationSchema,
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
    .max(64)
    // Per-batch dedup: ON CONFLICT can't resolve duplicates within the
    // same INSERT statement (Postgres raises 23505 on the second row in
    // the values list). Reject duplicates at the boundary so the
    // resolver doesn't have to last-write-wins post-hoc.
    .refine(
      (rows) =>
        new Set(rows.map((r) => r.biomarkerCategory)).size === rows.length,
      { message: "Duplicate biomarkerCategory in scope" },
    ),
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

// Neutral copy (Review 2026-05-26 decision A): drop the "Dr." prefix
// (patient may already have typed "Dra. Renata") and use the
// gender-neutral past-participle "compartilhada" (concords with
// "informação" — implicit subject). Avoids the masculine/feminine
// agreement trap on biomarker names ("Colesterol oculta" was wrong).
export function BIOMARKER_HIDDEN_PT_BR_FN(
  biomarker: string,
  displayName: string,
): string {
  return `${biomarker} não compartilhada com ${displayName}`;
}

export function BIOMARKER_VISIBLE_PT_BR_FN(
  biomarker: string,
  displayName: string,
): string {
  return `${biomarker} compartilhada com ${displayName}`;
}

export function SHARE_TOGGLE_A11Y_LABEL_PT_BR_FN(
  biomarkerLabel: string,
  visible: boolean,
  displayName: string,
): string {
  return `${biomarkerLabel}: atualmente ${visible ? "compartilhada" : "não compartilhada"} com ${displayName}`;
}

export const BIOMARKER_TOGGLE_FAILED_PT_BR =
  "Não foi possível salvar. Tente novamente.";

export const DOCTOR_DISPLAY_NAME_LABEL_PT_BR =
  "Como você quer chamar este profissional?";
export const DOCTOR_IDENTIFIER_LABEL_PT_BR = "Email ou CRM do médico";

// ---------------------------------------------------------------------------
// Story 5.2 — duration picker + summary + share-sheet copy
// ---------------------------------------------------------------------------

/**
 * AC1 — visual order is load-bearing (24h / 7d / 30d / no_expiry).
 * `"7d"` is the pre-selected default but that lives in the picker
 * screen's local state, NOT here.
 */
export const DURATION_OPTIONS: readonly {
  value: ShareDuration;
  labelPtBr: string;
}[] = [
  { value: "24h", labelPtBr: "24 horas" },
  { value: "7d", labelPtBr: "7 dias" },
  { value: "30d", labelPtBr: "30 dias" },
  { value: "no_expiry", labelPtBr: "Sem prazo" },
] as const;

export function DURATION_LABEL_PT_BR_FN(d: ShareDuration): string {
  switch (d) {
    case "24h":
      return "24 horas";
    case "7d":
      return "7 dias";
    case "30d":
      return "30 dias";
    case "no_expiry":
      return "sem prazo";
  }
}

/** AC2 — verbatim copy for the no_expiry confirmation modal. */
export const NO_EXPIRY_CONFIRM_BODY_PT_BR =
  "Confirmar acesso sem prazo — o médico poderá ver seus dados até você revogar manualmente.";
export const NO_EXPIRY_CONFIRM_BUTTON_PT_BR = "Confirmar";
export const NO_EXPIRY_CONFIRM_CANCEL_PT_BR = "Voltar";

/** AC7 — summary sentence for the resumo screen. */
export function SHARE_SUMMARY_PT_BR_FN(
  doctorName: string,
  visibleCategories: string[],
  duration: ShareDuration,
): string {
  const list =
    visibleCategories.length > 0
      ? visibleCategories.join(", ")
      : "nenhum biomarcador";
  return `${doctorName} verá: ${list} — ${DURATION_LABEL_PT_BR_FN(duration)}.`;
}

export const SHARE_SUBMIT_BUTTON_PT_BR = "Enviar";
export const CONTINUE_BUTTON_PT_BR = "Continuar";

/** AC7 — clipboard fallback Toast when `navigator.share` is unavailable. */
export const SHARE_URL_COPIED_PT_BR = "Link copiado.";
/** AC7 — Toast when the share-sheet call fails outright. */
export const SHARE_URL_ERROR_PT_BR =
  "Não foi possível abrir o compartilhamento. Tente novamente.";

/** Resumo screen title. */
export const COMPARTILHAR_RESUMO_TITLE_PT_BR = "Tudo pronto";

/** Duration-picker screen title. */
export const COMPARTILHAR_NOVO_DURACAO_TITLE_PT_BR =
  "Por quanto tempo o médico poderá ver?";

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

/**
 * Story 5.2 — replaces `compartilharConcluidoRoute`. The plain-language
 * summary screen with the Tier-2 "Enviar" share-sheet trigger.
 */
export function compartilharResumoRoute(shareTokenId: string): string {
  return `/compartilhar/${shareTokenId}/resumo`;
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
// Story 5.2 — removed `COMPARTILHAR_NOVO_DURACAO_PROGRESS_PT_BR` (the
// duracao screen no longer auto-fires) and `COMPARTILHAR_CONCLUIDO_PT_BR`
// (the resumo screen subsumes the old concluido stub).
export const COMPARTILHAR_BIOMARCADORES_TITLE_PT_BR =
  "O que o médico poderá ver?";
export const COMPARTILHAR_BIOMARCADORES_DONE_CTA_PT_BR = "Concluir";
export const COMPARTILHAR_BACK_PT_BR = "← Voltar";
