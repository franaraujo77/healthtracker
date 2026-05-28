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
  // Story 5.5 — patient-actor surface for record exports (AC10).
  // The system-actor `export.generated` / `export.failed` events are
  // intentionally NOT in this allowlist; they are operational telemetry,
  // not patient-visible actions.
  "record.exported",
  // Story 5.6 AC10 — patient-actor surface for the deletion-requested
  // ceremony. `account.deletion_completed` / `account.deletion_failed`
  // are system-actor and intentionally NOT in this allowlist (the
  // patient cannot read the Access Log after the worker completes
  // anyway — the auth user is gone).
  "account.deletion_requested",
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
/**
 * Story 5.4 review-fix Patch #7 — split the server vs client variants.
 * The server resolver MUST NEVER return `"revoked-pending"`; that is a
 * transient client-side overlay injected by the Acessos screen via the
 * `revokingTokenIds: Set<string>` override. The output Zod schema uses
 * the server enum so a buggy/malicious response carrying
 * `"revoked-pending"` is Zod-rejected at the tRPC boundary; the
 * `AccessLogItem` prop type uses the client enum.
 */
export const SERVER_ACCESS_LOG_TOKEN_STATUSES = [
  "ativo",
  "expirado",
  "revogado",
  "sem prazo",
] as const;
export type ServerAccessLogTokenStatus =
  (typeof SERVER_ACCESS_LOG_TOKEN_STATUSES)[number];

export const ACCESS_LOG_TOKEN_STATUSES = [
  ...SERVER_ACCESS_LOG_TOKEN_STATUSES,
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
  tokenStatus: z.enum(SERVER_ACCESS_LOG_TOKEN_STATUSES).nullable(),
  metadata: z.record(z.string(), z.unknown()),
});
export type AccessLogItemRow = z.infer<typeof accessLogItemRowSchema>;

/**
 * Story 5.4 review-fix Patch #7 — client-side row variant. The
 * server emits `ServerAccessLogTokenStatus`; the Acessos screen
 * overlays `"revoked-pending"` for rows currently inside the 5s
 * undo window. UI components consume this wider type.
 */
export type ClientAccessLogItemRow = Omit<AccessLogItemRow, "tokenStatus"> & {
  tokenStatus: AccessLogTokenStatus | null;
};

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
  /**
   * Story 5.5 — `record.exported` rows carry the format in
   * `audit_log.metadata.format` ("json" | "pdf"). The Access Log
   * row renderer threads it here.
   */
  exportFormat?: string;
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
    case "record.exported": {
      // Story 5.5 AC10 — patient-self event; `displayName` is the
      // resolver's "Você" fallback (no doctor on the resource). The
      // export format lives in `metadata.format`, surfaced via the
      // optional `exportFormat` field on `AccessLogEventCopyArgs`.
      const fmt = args.exportFormat ?? "";
      return fmt.length > 0
        ? `Você exportou seu registro completo (${fmt.toUpperCase()}).`
        : "Você exportou seu registro completo.";
    }
    case "account.deletion_requested":
      // Story 5.6 AC10 — patient-self event. In practice the patient
      // immediately signs out on `requestDeletion` success and never
      // reaches the Access Log again; this label exists for the
      // theoretical pre-deletion-completion read.
      return "Você solicitou exclusão de conta.";
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
 * Story 5.4 review-fix Patch #1 — toast surface when the
 * server-side `revokeShareToken` mutation fails (network / 5xx /
 * unknown). The 404 path (re-revoke after the row was already
 * revoked elsewhere) is silenced — the refetch surfaces the correct
 * `revogado` state.
 */
export const REVOKE_FAILED_PT_BR = "Não foi possível revogar. Tente novamente.";

/**
 * Inline hint rendered next to the "Revogando…" badge while the
 * 5s timer runs, so the patient knows where to find the undo.
 */
export const ACCESS_LOG_REVOKING_HINT_PT_BR = "(Desfazer no toast)";

// ---------------------------------------------------------------------------
// Story 5.5 — Patient-initiated record export (LGPD Art. 18)
// ---------------------------------------------------------------------------

/**
 * Export format enum + status enum. Mirror the pgEnum + CHECK
 * constraints in `packages/db/src/schema/sharing.ts`.
 */
export const EXPORT_FORMATS = ["json", "pdf"] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number];

export const EXPORT_STATUSES = [
  "queued",
  "generating",
  "ready",
  "failed",
] as const;
export type ExportStatus = (typeof EXPORT_STATUSES)[number];

/** Audit event constants (AC10). */
export const SHARING_AUDIT_EXPORT_QUEUED = "export.queued" as const;
export const SHARING_AUDIT_EXPORT_GENERATED = "export.generated" as const;
export const SHARING_AUDIT_EXPORT_FAILED = "export.failed" as const;
/** Patient-actor surface — extends `ACCESS_LOG_EVENT_KINDS`. */
export const SHARING_AUDIT_RECORD_EXPORTED = "record.exported" as const;

/** AC6 input — only the format. */
export const requestExportInputSchema = z.object({
  format: z.enum(EXPORT_FORMATS),
});
export type RequestExportInput = z.infer<typeof requestExportInputSchema>;

export const requestExportOutputSchema = z.object({
  exportId: z.uuid(),
});
export type RequestExportOutput = z.infer<typeof requestExportOutputSchema>;

export const getExportInputSchema = z.object({
  exportId: z.uuid(),
});
export type GetExportInput = z.infer<typeof getExportInputSchema>;

/**
 * AC7 output — `downloadUrl` is a freshly-minted Supabase Storage
 * signed URL (1h TTL) when `status === "ready"` and not past the
 * 24h `expires_at`; null otherwise. Clients MUST NOT cache the URL
 * — every "Baixar" tap re-runs the query.
 */
export const getExportOutputSchema = z.object({
  status: z.enum(EXPORT_STATUSES),
  format: z.enum(EXPORT_FORMATS),
  requestedAt: z.iso.datetime(),
  completedAt: z.iso.datetime().nullable(),
  expiresAt: z.iso.datetime(),
  downloadUrl: z.url().nullable(),
  /**
   * Story 5.5 review-fix Patch #1 — when `status === 'ready'` but the
   * 24h storage TTL has elapsed, `downloadUrl` is null AND `expired`
   * is true. The UI distinguishes this from queued/generating by
   * rendering `EXPORT_EXPIRED_PT_BR` + a "Tentar novamente" CTA.
   */
  expired: z.boolean(),
});
export type GetExportOutput = z.infer<typeof getExportOutputSchema>;

/**
 * AC1 — the patient-facing format-selector options. Order is
 * visually load-bearing (JSON first; the spec pre-selects JSON).
 */
export const EXPORT_FORMAT_OPTIONS: readonly {
  value: ExportFormat;
  label: string;
  hint: string;
}[] = [
  {
    value: "json",
    label: "JSON",
    hint: "Para análise em outras ferramentas.",
  },
  {
    value: "pdf",
    label: "PDF",
    hint: "Documento formatado para impressão ou compartilhamento.",
  },
] as const;

export const EXPORT_FORMAT_HINT_JSON_PT_BR =
  "Para análise em outras ferramentas.";
export const EXPORT_FORMAT_HINT_PDF_PT_BR =
  "Documento formatado para impressão ou compartilhamento.";

/** AC2 — progress / terminal / button copy. */
export const EXPORT_FAILED_PT_BR =
  "Não foi possível gerar o registro. Tente novamente.";
export const EXPORT_PROGRESS_PT_BR = "Gerando seu registro… (até 60 segundos)";
export const EXPORT_READY_PT_BR = "Pronto";
export const EXPORT_DOWNLOAD_BUTTON_PT_BR = "Baixar";
export const EXPORT_RETRY_BUTTON_PT_BR = "Tentar novamente";
export const EXPORT_SUBMIT_BUTTON_PT_BR = "Exportar";
export const EXPORT_FORMAT_GROUP_A11Y_PT_BR = "Formato do registro";
/**
 * Story 5.5 review-fix Patch #1 — surfaced when `status === 'ready'`
 * but the 24h storage TTL has elapsed (signed-URL mint would silently
 * no-op). Paired with a Tier-2 "Tentar novamente" CTA.
 */
export const EXPORT_EXPIRED_PT_BR =
  "Este link expirou. Toque em 'Exportar' novamente.";
/**
 * Story 5.5 review-fix Decision C — surfaced when client-side polling
 * has elapsed `EXPORT_POLL_TIMEOUT_MS` without reaching ready/failed.
 * Polling stops; the patient can re-tap "Exportar" (no server cancel —
 * the worker may still finish in the background).
 */
export const EXPORT_STUCK_PT_BR = "Geração demorando mais que o esperado.";
export const EXPORT_STUCK_BUTTON_PT_BR = "Tentar novamente";

export function EXPORT_SUBMIT_A11Y_PT_BR_FN(format: ExportFormat): string {
  return `Exportar registro como ${format.toUpperCase()}`;
}

/** Screen title + helper copy. */
export const EXPORT_SCREEN_TITLE_PT_BR = "Exportar registro";
export const EXPORT_SCREEN_BODY_PT_BR =
  "Baixe uma cópia completa do seu registro de saúde.";

/** AC11 — signed-URL TTL. */
export const EXPORT_DOWNLOAD_TTL_SECONDS = 3600;
/** AC2 — polling interval for `getExport`. */
export const EXPORT_POLL_INTERVAL_MS = 2000;
/**
 * Story 5.5 review-fix Decision C — client-side ceiling. After this
 * elapsed wall-clock window the screen stops polling and renders
 * `EXPORT_STUCK_PT_BR` + a retry CTA. No server cancel.
 */
export const EXPORT_POLL_TIMEOUT_MS = 5 * 60_000;
/** Storage file lifetime — client display only; server is authoritative. */
export const EXPORT_FILE_LIFETIME_MS = 24 * 60 * 60 * 1000;
/** AC3 — top-level `schemaVersion` for the JSON export. */
export const EXPORT_JSON_SCHEMA_VERSION = "1.0.0";

/** Routes (AC1). */
export const EXPORT_ROUTE = "/configuracoes/dados/exportar";

/** Filename helper for the download trigger (T5.5). */
export function exportFilename(format: ExportFormat, date: Date): string {
  const yyyy = date.getUTCFullYear();
  const mm = String(date.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(date.getUTCDate()).padStart(2, "0");
  return `healthtracker-export-${yyyy}-${mm}-${dd}.${format}`;
}
