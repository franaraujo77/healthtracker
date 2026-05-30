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

// =============================================================================
// Story 6.4 — Doctor invites a patient to create a Health Tracker account
// =============================================================================

/**
 * AC12 — audit kind constants. Both **NOT** in `ACCESS_LOG_EVENT_KINDS`:
 * doctor-side acquisition surface, not patient-data access. The patient
 * cannot have access-logged an event from before they existed (`sent`)
 * nor an event on their own onboarding (`resolved`).
 */
export const PATIENT_INVITE_SENT_AUDIT = "patient_invite.sent" as const;
export const PATIENT_INVITE_RESOLVED_AUDIT = "patient_invite.resolved" as const;

/**
 * AC5 — `sharingRouter.createPatientInvite` input. Identifier is a free
 * string (email OR Brazilian phone) — server normalizes via
 * `normalizePatientIdentifier`. `displayName` is the doctor-supplied
 * patient label (nullable; trimmed).
 */
export const createPatientInviteInputSchema = z.object({
  identifier: z.string().trim().min(3).max(254),
  displayName: z.string().trim().min(1).max(80).nullable().default(null),
});
export type CreatePatientInviteInput = z.input<
  typeof createPatientInviteInputSchema
>;

/**
 * AC5/AC11 — output discriminator. `alreadyRegistered:true` → no row
 * written, no URL minted. `alreadyRegistered:false` → fresh or
 * idempotently-returned existing pending invite.
 */
export const createPatientInviteOutputSchema = z.object({
  inviteId: z.uuid().nullable(),
  inviteUrl: z.string().nullable(),
  alreadyRegistered: z.boolean(),
});
export type CreatePatientInviteOutput = z.infer<
  typeof createPatientInviteOutputSchema
>;

/**
 * AC7 — `accountRouter.getPatientInviteContext` input + output. Public
 * resolver (the patient has not signed up yet); HMAC verify is the
 * authorization boundary.
 */
export const getPatientInviteContextInputSchema = z.object({
  inviteId: z.uuid(),
  tokenHmac: z.string().min(1).max(256),
});
export type GetPatientInviteContextInput = z.infer<
  typeof getPatientInviteContextInputSchema
>;

export const getPatientInviteContextOutputSchema = z.object({
  valid: z.boolean(),
  doctorDisplayName: z.string().nullable(),
});
export type GetPatientInviteContextOutput = z.infer<
  typeof getPatientInviteContextOutputSchema
>;

// ---------------------------------------------------------------------------
// pt-BR copy — invite modal (AC1)
// ---------------------------------------------------------------------------

export const INVITE_PATIENT_BUTTON_PT_BR = "Convidar paciente";
export const INVITE_PATIENT_MODAL_HEADING_PT_BR = "Convidar paciente";
export const INVITE_PATIENT_MODAL_SUBHEADING_PT_BR =
  "Envie um link para que seu paciente crie a conta no Health Tracker.";
export const INVITE_PATIENT_IDENTIFIER_LABEL_PT_BR =
  "E-mail ou telefone do paciente";
export const INVITE_PATIENT_IDENTIFIER_PLACEHOLDER_PT_BR =
  "paciente@exemplo.com";
export const INVITE_PATIENT_DISPLAY_NAME_LABEL_PT_BR =
  "Nome do paciente (opcional)";
export const INVITE_PATIENT_CTA_PT_BR = "Enviar convite";
export const INVITE_PATIENT_CTA_LOADING_PT_BR = "Enviando…";
export const INVITE_PATIENT_SUCCESS_BODY_PT_BR =
  "Convite criado. Compartilhe o link abaixo com seu paciente.";
export const INVITE_PATIENT_COPY_LINK_PT_BR = "Copiar link";
export const INVITE_PATIENT_COPY_LINK_TOAST_PT_BR = "Link copiado.";
export const INVITE_PATIENT_ALREADY_REGISTERED_PT_BR =
  "Este paciente já tem uma conta no Health Tracker. Convide outro paciente.";
export const INVITE_PATIENT_GENERIC_ERROR_PT_BR =
  "Não foi possível enviar o convite agora. Tente novamente.";
export const INVITE_PATIENT_IDENTIFIER_INVALID_PT_BR =
  "Informe um e-mail ou telefone válido.";

// ---------------------------------------------------------------------------
// pt-BR copy — invite landing (AC7)
// ---------------------------------------------------------------------------

export const PATIENT_INVITE_LANDING_INVALID_HEADING_PT_BR = "Convite inválido";
export const PATIENT_INVITE_LANDING_INVALID_BODY_PT_BR =
  "Este convite expirou ou foi revogado. Peça ao seu médico um novo convite.";
export function patientInviteLandingValidHeadingPtBr(
  doctorDisplayName: string,
): string {
  return `${doctorDisplayName} convidou você a criar sua conta no Health Tracker.`;
}

/**
 * AC2 — normalizes a patient identifier into `{ kind, normalized }` or
 * throws a typed error when the string is neither an email nor a
 * Brazilian phone. Pure; no Zod / DB / network calls.
 *
 *   - Email: `.trim().toLowerCase()`, then standard RFC-ish shape via
 *     a permissive regex. Hash key = lowercased trimmed value.
 *   - Phone: Brazilian-only. Strips every non-digit. Accepts:
 *       `+5511912345678` (13 digits with leading +)
 *       `5511912345678`  (13 digits)
 *       `11912345678`    (11 digits, country code added)
 *       Or with formatting: `(11) 91234-5678`, `(11) 9 1234-5678`.
 *     Server-side normalizes to E.164: `+5511912345678`.
 *     LANDLINES and INTERNATIONAL numbers are NOT supported (MVP).
 */
export type PatientIdentifierKind = "email" | "phone";

export interface NormalizedPatientIdentifier {
  kind: PatientIdentifierKind;
  normalized: string;
}

export class PatientIdentifierInvalidError extends Error {
  override readonly name = "PatientIdentifierInvalidError";
  constructor() {
    super("PATIENT_IDENTIFIER_INVALID");
  }
}

// Permissive email regex — same shape Zod's `z.email()` accepts (one `@`
// surrounded by non-empty parts; no whitespace; dot in domain). Captured
// inline so the helper has no Zod dependency and stays test-friendly.
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizePatientIdentifier(
  identifier: string,
): NormalizedPatientIdentifier {
  if (typeof identifier !== "string") {
    throw new PatientIdentifierInvalidError();
  }
  const trimmed = identifier.trim();
  if (trimmed.length === 0) {
    throw new PatientIdentifierInvalidError();
  }
  // Email path — must contain @ before we strip-digits.
  if (trimmed.includes("@")) {
    const lowered = trimmed.toLowerCase();
    if (!EMAIL_SHAPE.test(lowered)) {
      throw new PatientIdentifierInvalidError();
    }
    return { kind: "email", normalized: lowered };
  }
  // Phone path — strip every non-digit (and preserve leading + for an
  // explicit country-code prefix). Brazilian mobiles are 11 digits
  // (DDD + 9 + 8-digit subscriber); we add `+55` when the country code
  // is absent.
  const digitsOnly = trimmed.replace(/[^\d]/g, "");
  if (digitsOnly.length === 0) {
    throw new PatientIdentifierInvalidError();
  }
  let normalized: string;
  if (digitsOnly.length === 11) {
    // (11) 91234-5678 → 11912345678 → +5511912345678. Mobile-only:
    // the 9th digit (1-indexed position 3) MUST be `9` for BR mobile.
    if (digitsOnly[2] !== "9") {
      throw new PatientIdentifierInvalidError();
    }
    normalized = `+55${digitsOnly}`;
  } else if (digitsOnly.length === 13 && digitsOnly.startsWith("55")) {
    // 5511912345678 (or `+5511912345678` after the strip).
    if (digitsOnly[4] !== "9") {
      throw new PatientIdentifierInvalidError();
    }
    normalized = `+${digitsOnly}`;
  } else {
    throw new PatientIdentifierInvalidError();
  }
  return { kind: "phone", normalized };
}

/**
 * AC7 — strict parser for the `/convite/<inviteId>.<tokenHmac>` URL
 * segment. Mirrors `parseShareTokenSegment` (Story 6.1). Splits on the
 * FIRST `.` (UUIDs cannot contain `.`; the HMAC is base64url so won't
 * either, but we still split on first to be deterministic). Returns
 * `null` for any malformed input — caller renders the "convite inválido"
 * landing without a DB hit.
 */
const UUID_SHAPE_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parsePatientInviteSegment(
  segment: string,
): { inviteId: string; tokenHmac: string } | null {
  if (typeof segment !== "string" || segment.length === 0) return null;
  const dotIdx = segment.indexOf(".");
  if (dotIdx <= 0 || dotIdx >= segment.length - 1) return null;
  const inviteId = segment.slice(0, dotIdx);
  const tokenHmac = segment.slice(dotIdx + 1);
  if (!UUID_SHAPE_REGEX.test(inviteId)) return null;
  if (tokenHmac.length === 0) return null;
  return { inviteId, tokenHmac };
}
