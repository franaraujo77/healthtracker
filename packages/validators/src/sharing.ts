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

/**
 * Story 5.4 — patient-actor revoke audit. The doctor-side
 * `share_token.rejected` audit (fired when a doctor presents a
 * revoked token) is Epic 6's territory.
 */
export const SHARING_AUDIT_TOKEN_REVOKED = "share_token.revoked" as const;

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
// Story 5.4 — revokeShareToken I/O (T1.2)
// ---------------------------------------------------------------------------

export const revokeShareTokenInputSchema = z.object({
  shareTokenId: z.uuid(),
});
export type RevokeShareTokenInput = z.infer<typeof revokeShareTokenInputSchema>;

export const revokeShareTokenOutputSchema = z.object({
  shareTokenId: z.uuid(),
  revokedAt: z.iso.datetime(),
});
export type RevokeShareTokenOutput = z.infer<
  typeof revokeShareTokenOutputSchema
>;

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

/**
 * Story 5.2 review-fix Patch #7 — toast surface when
 * `createShareToken` fails. Distinct from
 * `BIOMARKER_TOGGLE_FAILED_PT_BR` (which is the per-biomarker
 * toggle's copy — wrong shape for the create-token error path).
 */
export const SHARE_TOKEN_CREATE_FAILED_PT_BR =
  "Não foi possível criar o compartilhamento. Tente novamente.";

/**
 * Story 5.2 review-fix Patch #15 — `accessibilityLabel` on the
 * `radiogroup`-wrapped DurationOption list so VoiceOver / TalkBack
 * announce the group context ("Duração do compartilhamento — X of 4").
 */
export const DURATION_GROUP_A11Y_LABEL_PT_BR = "Duração do compartilhamento";

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

// ---------------------------------------------------------------------------
// Story 5.3 — Access Log (Acessos tab)
// ---------------------------------------------------------------------------

/**
 * AC11 — allowlist of `audit_log.event` strings the Access Log
 * surfaces. Same constant used by the resolver's `IN (...)` filter
 * and by the `AccessLogItem` component's discriminator switch.
 * Adding a new kind = update both ends.
 */
export const ACCESS_LOG_EVENT_KINDS = [
  "pending_invite.created",
  "share_token.created",
  "sharing.configured",
  "conversation_starter.queued",
  "conversation_starter.generated",
  "conversation_starter.failed",
  "share_token.revoked",
  "share_token.read",
] as const;
export type AccessLogEventKind = (typeof ACCESS_LOG_EVENT_KINDS)[number];

export function isAccessLogEventKind(
  value: string,
): value is AccessLogEventKind {
  return (ACCESS_LOG_EVENT_KINDS as readonly string[]).includes(value);
}

/**
 * AC4 — `tokenStatus` is the discrete enum the resolver composes from
 * `expires_at` + `revoked_at` + `now()`. Consumers never see the raw
 * timestamp fields so they can't write conflicting predicates.
 */
export const ACCESS_LOG_TOKEN_STATUSES = [
  "ativo",
  "expirado",
  "revogado",
  "sem prazo",
  // Story 5.4 — transient client-side state during the 5s
  // deferred-server-write undo window. Never returned by the
  // resolver; injected by the Acessos screen via the
  // `revokingTokenIds: Set<string>` override.
  "revoked-pending",
] as const;
export type AccessLogTokenStatus = (typeof ACCESS_LOG_TOKEN_STATUSES)[number];

/** AC4 — input schema for `sharingRouter.listAccessLog`. */
export const listAccessLogInputSchema = z.object({
  // Cursor encoding: `{iso-timestamp}|{audit_log.id uuid}` for stable
  // pagination under same-millisecond inserts (AC12). The resolver
  // decodes; clients treat it as opaque.
  cursor: z.string().optional(),
  pageSize: z.number().int().min(1).max(50).default(20),
});
export type ListAccessLogInput = z.input<typeof listAccessLogInputSchema>;

/**
 * AC4 — output row schema. The resolver projects this shape; the UI
 * imports the type. `event` is the discriminated kind. `metadata` is
 * the raw audit_log payload, narrowed at the component layer for
 * `sharing.configured` (carries `biomarkerCategories`).
 */
export const accessLogItemRowSchema = z.object({
  id: z.uuid(),
  event: z.enum(ACCESS_LOG_EVENT_KINDS),
  createdAt: z.date(),
  displayName: z.string().nullable(),
  shareTokenId: z.uuid().nullable(),
  tokenStatus: z.enum(ACCESS_LOG_TOKEN_STATUSES).nullable(),
  metadata: z.record(z.string(), z.unknown()),
});
export type AccessLogItemRow = z.infer<typeof accessLogItemRowSchema>;

export const listAccessLogOutputSchema = z.object({
  items: z.array(accessLogItemRowSchema),
  nextCursor: z.string().nullable(),
  upgradeRequired: z.boolean(),
});
export type ListAccessLogOutput = z.infer<typeof listAccessLogOutputSchema>;

// ---- pt-BR copy (T6.1) ----

export const ACCESS_LOG_TAB_LABEL_PT_BR = "Acessos";
export const ACCESS_LOG_TITLE_PT_BR = "Acessos";

export const ACCESS_LOG_EMPTY_PT_BR = "Nenhum acesso registrado ainda.";

export const ACCESS_LOG_LOADING_PT_BR = "Carregando…";
export const ACCESS_LOG_ERROR_PT_BR =
  "Não foi possível carregar agora. Tente novamente.";

export const ACCESS_LOG_PREMIUM_REQUIRED_PT_BR =
  "O Acesso completo está disponível no plano Premium. Toque para saber mais.";

export const ACCESS_LOG_LIST_A11Y_LABEL_PT_BR =
  "Lista de acessos ao seu histórico";

export const ACCESS_LOG_LOAD_MORE_PT_BR = "Carregar mais";
export const ACCESS_LOG_REFRESH_PT_BR = "Atualizar";

export const ACCESS_LOG_SELF_DISPLAY_NAME_PT_BR = "Você";

export function ACCESS_LOG_EXPAND_A11Y_LABEL_PT_BR_FN(
  displayName: string,
): string {
  return `Ver detalhes do acesso de ${displayName}`;
}

export function ACCESS_LOG_TOKEN_STATUS_PT_BR_FN(
  status: AccessLogTokenStatus,
): string {
  switch (status) {
    case "ativo":
      return "Ativo";
    case "expirado":
      return "Expirado";
    case "revogado":
      return "Revogado";
    case "sem prazo":
      return "Sem prazo";
    case "revoked-pending":
      return "Revogando…";
  }
}

/**
 * AC2 — pt-BR copy for each event kind. The resolver hands the
 * renderer the kind + the resolved `displayName` (with `"Você"`
 * fallback for patient-self events) and any metadata fields the
 * specific kind needs (`durationLabel`, `biomarkerChangeCount`).
 */
export interface AccessLogEventCopyArgs {
  displayName: string;
  durationLabel?: string;
  biomarkerChangeCount?: number;
}

export function ACCESS_LOG_EVENT_LABEL_PT_BR_FN(
  kind: AccessLogEventKind,
  args: AccessLogEventCopyArgs,
): string {
  const { displayName, durationLabel, biomarkerChangeCount } = args;
  switch (kind) {
    case "pending_invite.created":
      return `Você adicionou ${displayName}.`;
    case "share_token.created":
      return durationLabel
        ? `Você criou um compartilhamento com ${displayName} por ${durationLabel}.`
        : `Você criou um compartilhamento com ${displayName}.`;
    case "sharing.configured": {
      const n = biomarkerChangeCount ?? 0;
      // Patch #9 (2026-05-26) — historical / no-change rows render
      // without the parenthetical (no "(0 alterações)" noise).
      if (n === 0) {
        return `Você revisou as visibilidades para ${displayName}.`;
      }
      const noun = n === 1 ? "alteração" : "alterações";
      return `Você atualizou as visibilidades para ${displayName} (${n} ${noun}).`;
    }
    case "conversation_starter.queued":
      return `Sumário pré-gerado para ${displayName}.`;
    case "conversation_starter.generated":
      return `Sumário pré-gerado para ${displayName}.`;
    case "conversation_starter.failed":
      return `Não foi possível pré-gerar o sumário para ${displayName}.`;
    case "share_token.revoked":
      return `Você revogou o acesso de ${displayName}.`;
    case "share_token.read":
      return `${displayName} visualizou seus dados.`;
  }
}

/**
 * AC2 — the conversation-starter `queued` / `generated` events are
 * suppressed entirely from the patient-facing list (preventing
 * per-share noise); they are NOT surfaced on expand either. The
 * `failed` variant stays visible. Future debug surfacing can be
 * wired behind an explicit `?showSystem=1` query param (deferred —
 * Story 5.x). Centralizing here keeps the resolver simple (it
 * returns every allowlisted row; the renderer hides the suppressed
 * kinds).
 */
export const ACCESS_LOG_SUPPRESSED_KINDS: ReadonlySet<AccessLogEventKind> =
  new Set(["conversation_starter.queued", "conversation_starter.generated"]);

// Acessos route (web parity).
export const ACCESS_LOG_ROUTE = "/acessos";

/**
 * Story 5.3 review-fix (2026-05-26) — throttle for the tab-focus
 * refetch path on both Expo (`useFocusEffect`) and web
 * (`visibilitychange`). The "pull-to-refresh" path stays unthrottled.
 *
 * Rationale: quick tab switches (Acessos → Inicio → Acessos within a
 * few seconds) used to wipe `priorPages` and rewind to page 1.
 * Threshold of 30s preserves AC10's "refresh on focus" while avoiding
 * the scroll-state loss on transient backgrounds.
 */
export const ACCESS_LOG_REFETCH_THROTTLE_MS = 30_000;

// ---------------------------------------------------------------------------
// Story 5.4 — Revoke ceremony copy (T5.1)
// ---------------------------------------------------------------------------

/**
 * 5-second deferred-server-write undo window. The screen owns the
 * timer; the timer expiry fires `sharingRouter.revokeShareToken`.
 * Tapping "Desfazer" within the window clears the timer and no
 * server mutation happens — no DB churn, no audit noise.
 */
export const REVOKE_TIMEOUT_MS = 5_000;

export const REVOKE_BUTTON_LABEL_PT_BR = "Revogar acesso";

export function REVOKE_BUTTON_A11Y_PT_BR_FN(displayName: string): string {
  return `Revogar acesso de ${displayName} ao seu histórico de saúde`;
}

export function REVOKE_CONFIRM_BODY_PT_BR_FN(displayName: string): string {
  return `Tem certeza? ${displayName} perderá acesso aos seus dados imediatamente.`;
}

export const REVOKE_CONFIRM_BUTTON_PT_BR = "Revogar";
export const REVOKE_CONFIRM_CANCEL_PT_BR = "Cancelar";

export const REVOKE_UNDO_TOAST_PT_BR = "Acesso revogado. Desfazer?";
export const REVOKE_UNDO_BUTTON_PT_BR = "Desfazer";
export const REVOKE_UNDONE_TOAST_PT_BR = "Revogação cancelada.";

/**
 * Inline hint rendered next to the "Revogando…" badge while the
 * 5s timer runs, so the patient knows where to find the undo.
 */
export const ACCESS_LOG_REVOKING_HINT_PT_BR = "(Desfazer no toast)";
