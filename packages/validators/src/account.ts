import { z } from "zod/v4";

/**
 * Story 5.6 — `accountRouter.requestDeletion` + `getDeletionStatus`
 * input schemas, audit kinds, and pt-BR copy for the Excluir conta
 * surface (LGPD Art. 18 right-to-erasure).
 *
 * Validators-as-truth (Story 5.3 R1 discipline) — every surface that
 * needs the magic-word constant / a copy string / an audit kind imports
 * from here. No inline pt-BR in components or routers.
 */

// ---------------------------------------------------------------------------
// Audit kinds (AC10)
// ---------------------------------------------------------------------------

/**
 * Patient-actor audit kind written in the same tx as the
 * `account_deletion_requests` INSERT. Retroactively pseudonymized by
 * the worker's step-1 audit_log scrub (so the row survives the
 * patient's deletion with the hash-prefixed `actor_id`).
 */
export const ACCOUNT_AUDIT_DELETION_REQUESTED =
  "account.deletion_requested" as const;

/**
 * System-actor audit kind written by the worker on successful
 * completion (after Supabase Auth admin delete). `actor_id` is the
 * pseudonym (raw patient_id was scrubbed in step 1).
 */
export const ACCOUNT_AUDIT_DELETION_COMPLETED =
  "account.deletion_completed" as const;

/**
 * System-actor audit kind written by the worker on final-attempt
 * failure (emitted BEFORE the Supabase Auth admin delete call so a
 * partial auth-side failure is still surfaced). `actor_id` is the
 * pseudonym.
 */
export const ACCOUNT_AUDIT_DELETION_FAILED = "account.deletion_failed" as const;

// ---------------------------------------------------------------------------
// Status enum + Zod schemas (AC2, AC8, AC9)
// ---------------------------------------------------------------------------

export const ACCOUNT_DELETION_STATUSES = [
  "queued",
  "processing",
  "complete",
  "failed",
] as const;
export type AccountDeletionStatus = (typeof ACCOUNT_DELETION_STATUSES)[number];

/** AC2 — empty input; the patient identity is from `ctx.session.user.id`. */
export const requestDeletionInputSchema = z.object({});
export type RequestDeletionInput = z.infer<typeof requestDeletionInputSchema>;

export const requestDeletionOutputSchema = z.object({
  requestId: z.uuid(),
});
export type RequestDeletionOutput = z.infer<typeof requestDeletionOutputSchema>;

export const getDeletionStatusInputSchema = z.object({
  requestId: z.uuid(),
});
export type GetDeletionStatusInput = z.infer<
  typeof getDeletionStatusInputSchema
>;

export const getDeletionStatusOutputSchema = z.object({
  status: z.enum(ACCOUNT_DELETION_STATUSES),
  requestedAt: z.iso.datetime(),
  completedAt: z.iso.datetime().nullable(),
  failureReason: z.string().nullable(),
});
export type GetDeletionStatusOutput = z.infer<
  typeof getDeletionStatusOutputSchema
>;

// ---------------------------------------------------------------------------
// pt-BR copy (AC1)
// ---------------------------------------------------------------------------

export const DELETE_ACCOUNT_ROUTE = "/configuracoes/conta/excluir";

export const DELETE_ACCOUNT_HEADER_PT_BR = "Excluir conta";

export const DELETE_ACCOUNT_IRREVERSIBLE_PT_BR =
  "Esta ação é irreversível. Todos os seus dados serão permanentemente apagados.";

/**
 * AC1 — summary card listing what will be deleted. Ordered roughly by
 * patient-mental-model salience (observations and uploads first;
 * audit-log pseudonymization last because it's the technical
 * compliance line). All strings are surface copy — no semantic
 * coupling to schema names.
 */
export const DELETE_ACCOUNT_SUMMARY_LINES_PT_BR: readonly string[] = [
  "Todos os seus resultados de exames",
  "Seus uploads (PDFs e fotos)",
  "Suas medidas de bioimpedância",
  "Seus consentimentos LGPD",
  "Seus compartilhamentos com médicos",
  "Suas exportações de registro",
  "Sua conta de acesso (e-mail e senha)",
  "O histórico de auditoria mantém pseudônimos no lugar do seu identificador",
] as const;

export const DELETE_ACCOUNT_INPUT_PLACEHOLDER_PT_BR =
  "Digite EXCLUIR para confirmar";

/**
 * AC1 — the magic word. The UI compares
 * `input.trim().toUpperCase() === DELETE_ACCOUNT_CONFIRM_WORD`.
 */
export const DELETE_ACCOUNT_CONFIRM_WORD = "EXCLUIR";

export const DELETE_ACCOUNT_CONTINUE_BUTTON_PT_BR = "Continuar";
export const DELETE_ACCOUNT_CANCEL_BUTTON_PT_BR = "Cancelar";

/**
 * AC1 — 30s cooldown copy. Mirrors Story 5.4 UndoToast countdown,
 * inline (not toast-anchored) because the stakes are higher and the
 * Cancelar button must be the primary affordance.
 */
export function DELETE_ACCOUNT_COUNTDOWN_PT_BR_FN(
  secondsRemaining: number,
): string {
  return `Excluindo em ${secondsRemaining} segundos… Toque em Cancelar para abortar.`;
}

export const DELETE_ACCOUNT_CANCELLED_TOAST_PT_BR = "Exclusão cancelada.";

export const DELETE_ACCOUNT_FAILED_PT_BR =
  "Não foi possível processar sua solicitação. Tente novamente.";

export const DELETE_ACCOUNT_CANCEL_A11Y_PT_BR = "Cancelar exclusão da conta";

/**
 * AC1 — 30s visible cooldown (mirrors Story 5.4's 5s window scaled up
 * because the ceremony is irreversible). Worker `setTimeout` fires the
 * mutation after this duration; a separate `setInterval(50ms)` drives
 * the progress bar (see Story 5.4 `UndoToast` pattern for the dual-
 * timer split — dropped ticks under background pressure don't extend
 * the window past this constant).
 */
export const DELETE_ACCOUNT_COUNTDOWN_MS = 30_000;
