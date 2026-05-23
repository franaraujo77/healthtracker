import { z } from "zod/v4";

export { formatBrazilianDecimal, parseBrazilianDecimal } from "./decimal";
export { parseCollectedAt } from "./collected-at";

/**
 * Story 2.4 — pt-BR copy + route constants for the upload detail
 * review surface. The UI uses `formatBrazilianDecimal` to render
 * numeric pre-fills with decimal-comma (UX-DR12).
 */
export const UPLOAD_DETAIL_ROUTE = (uploadId: string) =>
  `/inicio/uploads/${uploadId}`;

export const UPLOAD_DETAIL_REVIEW_HEADER_PT_BR = "Confirme este valor";
export const UPLOAD_DETAIL_CONFIRM_CTA_PT_BR = "Confirmar";
export const UPLOAD_DETAIL_SAVE_CTA_PT_BR = "Salvar";
export const UPLOAD_DETAIL_WAITING_TEAM_PT_BR = "Aguardando revisão da equipe";
export const UPLOAD_DETAIL_ALL_DONE_PT_BR = "Tudo certo, resultados publicados";
export const UPLOAD_DETAIL_LOADING_PT_BR = "Carregando…";
export const UPLOAD_DETAIL_ERROR_PT_BR =
  "Não conseguimos abrir este upload. Tente novamente em instantes.";
export const UPLOAD_DETAIL_VALUE_INVALID_PT_BR =
  "Use um número válido — por exemplo, 14,2.";
export const UPLOAD_DETAIL_SAVE_ERROR_PT_BR =
  "Não conseguimos salvar — tente novamente.";
export const UPLOAD_DETAIL_TITLE_PT_BR = "Resultado do upload";
export const UPLOAD_DETAIL_VALUE_LABEL_PT_BR = "Valor";
export const UPLOAD_DETAIL_EXTRACTED_VALUE_PT_BR = "Valor extraído";

export const UPLOAD_STATUS_LABELS_PT_BR: Record<
  | "queued"
  | "processing"
  | "pending_review"
  | "complete"
  | "failed"
  | "offline_queued",
  string
> = {
  queued: "Na fila",
  processing: "Processando",
  pending_review: "Aguardando confirmação",
  complete: "Publicado",
  failed: "Falhou",
  // Story 2.6 — virtual status; rows in this state are local-only
  // (haven't been submitted to the server yet) and will drain as
  // soon as connectivity is restored.
  offline_queued: "Aguardando conexão",
};

export const HISTORICO_OFFLINE_QUEUED_HINT_PT_BR =
  "Vamos enviar assim que sua conexão voltar.";

// =============================================================================
// Story 2.7 — Manual BIA (bioimpedance) entry
// =============================================================================

export const BIA_DEVICE_NAMES = ["InBody", "Tanita", "Outro"] as const;
export type BiaDeviceName = (typeof BIA_DEVICE_NAMES)[number];

/**
 * Story 2.7 — input schema for `observations.submitBia`. The form
 * collects 3 numeric biomarkers + a collection date (ISO yyyy-mm-dd,
 * formatted client-side from a dd/mm/yyyy input) + a device name
 * (with optional custom label when 'Outro') + optional `deviceModel`.
 * `overwrite` is set by the duplicate-modal Substituir CTA on
 * re-submit; default `false`.
 */
export const BiaSubmissionSchema = z
  .object({
    visceralFatAreaCm2: z.number().positive().max(500),
    skeletalMuscleMassKg: z.number().positive().max(200),
    bodyFatPercentage: z.number().min(0).max(100),
    collectedAt: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "BIA_COLLECTED_AT_INVALID")
      // R1-P200 — the regex accepts "2024-02-30" / "2024-13-45". Round-
      // trip through UTC to catch invalid month/day combinations
      // (server-side defense-in-depth — the client already does this).
      .refine(
        (s) => {
          // R2-P216 — explicit narrowing of the regex-matched parts.
          // `noUncheckedIndexedAccess` makes `split` results typed
          // `string | undefined`; without the early-return the
          // `Number(undefined) === NaN` path was correct only by
          // accident (NaN compares false everywhere).
          const parts = s.split("-");
          const yStr = parts[0];
          const mStr = parts[1];
          const dStr = parts[2];
          if (yStr === undefined || mStr === undefined || dStr === undefined) {
            return false;
          }
          const y = Number(yStr);
          const m = Number(mStr);
          const d = Number(dStr);
          if (y < 1900 || y > 2100) return false;
          if (m < 1 || m > 12) return false;
          if (d < 1 || d > 31) return false;
          const dt = new Date(Date.UTC(y, m - 1, d));
          return (
            dt.getUTCFullYear() === y &&
            dt.getUTCMonth() === m - 1 &&
            dt.getUTCDate() === d
          );
        },
        { message: "BIA_COLLECTED_AT_NOT_A_REAL_DATE" },
      ),
    deviceName: z.enum(BIA_DEVICE_NAMES),
    // R1-P203 — `.trim().min(1)` so non-form clients can't slip
    // empty/whitespace strings past defense-in-depth.
    deviceCustomName: z.string().trim().min(1).max(80).optional(),
    deviceModel: z.string().trim().min(1).max(80).optional(),
    overwrite: z.boolean().optional(),
  })
  .refine(
    (d) =>
      d.deviceName !== "Outro" ||
      (d.deviceCustomName !== undefined &&
        d.deviceCustomName.trim().length > 0),
    {
      message: "BIA_DEVICE_CUSTOM_NAME_REQUIRED",
      path: ["deviceCustomName"],
    },
  );
export type BiaSubmissionInput = z.infer<typeof BiaSubmissionSchema>;

export const MANUAL_BIA_ROUTE = "/inicio/medicao/bia";

export const BIA_FORM_TITLE_PT_BR = "Bioimpedância";
export const BIA_FIELD_VISCERAL_FAT_PT_BR = "Área de gordura visceral (cm²)";
export const BIA_FIELD_SKELETAL_MUSCLE_PT_BR =
  "Massa muscular esquelética (kg)";
export const BIA_FIELD_BODY_FAT_PT_BR = "Percentual de gordura corporal (%)";
export const BIA_FIELD_COLLECTED_AT_PT_BR = "Data da medição (dd/mm/aaaa)";
export const BIA_FIELD_DEVICE_NAME_PT_BR = "Aparelho";
export const BIA_FIELD_DEVICE_CUSTOM_NAME_PT_BR = "Nome do aparelho";
export const BIA_FIELD_DEVICE_MODEL_PT_BR = "Modelo (opcional)";
export const BIA_FIELD_REQUIRED_PT_BR = "Este campo é obrigatório.";
export const BIA_FIELD_NUMBER_INVALID_PT_BR =
  "Use um número válido — por exemplo, 14,2.";
export const BIA_FIELD_DATE_INVALID_PT_BR =
  "Use uma data válida no formato dd/mm/aaaa.";
export const BIA_SUBMIT_CTA_PT_BR = "Salvar";
export const BIA_SUBMIT_SUCCESS_PT_BR = "Medição salva.";
export const BIA_SUBMIT_ERROR_PT_BR =
  "Não conseguimos salvar — tente novamente.";

export const BIA_DUPLICATE_MODAL_TITLE_PT_BR =
  "Já existe uma medição com este dispositivo para esta data. Deseja substituir?";
export const BIA_DUPLICATE_MODAL_CONFIRM_PT_BR = "Substituir";
export const BIA_DUPLICATE_MODAL_CANCEL_PT_BR = "Cancelar";

export const INICIO_ADD_MEASUREMENT_CTA_PT_BR =
  "Adicionar medição (Bioimpedância)";

// Story 2.5 — Histórico tab + push-notification copy.
export const HISTORICO_ROUTE = "/inicio/historico";
export const HISTORICO_TITLE_PT_BR = "Histórico";
export const HISTORICO_TAB_LABEL_PT_BR = "Histórico";
export const HISTORICO_EMPTY_HEADLINE_PT_BR =
  "Você ainda não enviou nenhum exame";
export const HISTORICO_EMPTY_CTA_PT_BR = "Enviar primeiro exame";
export const HISTORICO_LOAD_MORE_PT_BR = "Carregar mais";
export const HISTORICO_LOADING_PT_BR = "Carregando…";
export const HISTORICO_ERROR_PT_BR =
  "Não conseguimos carregar seu histórico. Tente novamente em instantes.";
export const HISTORICO_RECOVERY_RESEND_PT_BR = "Enviar novamente";
export const HISTORICO_RECOVERY_PHOTO_PT_BR = "Enviar uma foto";
export const HISTORICO_RECOVERY_SKIP_PT_BR = "Pular este resultado";

// R1-P153 — failed-card recovery CTAs route here with a pre-selected
// source so the import flow opens the right picker (file vs camera).
// Story 1.5 / 2.2's `ImportFlow` accepts a `source` query param.
export function postOnboardingImportRoute(
  source: "file" | "photo" = "file",
): string {
  return `/inicio?source=${source === "photo" ? "post_onboarding_photo" : "post_onboarding"}`;
}

export const FAILURE_REASON_LABELS_PT_BR: Record<string, string> = {
  retries_exhausted: "Tentamos várias vezes mas algo deu errado.",
  no_publishable_fields: "Os valores extraídos não puderam ser publicados.",
  storage_unavailable: "O arquivo não está acessível no momento.",
  no_readable_text: "Não conseguimos ler nenhum valor neste arquivo.",
};

const FAILURE_REASON_DEFAULT_PT_BR =
  "Tentamos várias vezes mas algo deu errado.";

export function failureReasonLabel(reason: string | null): string {
  if (!reason) return "Algo deu errado durante o processamento.";
  return FAILURE_REASON_LABELS_PT_BR[reason] ?? FAILURE_REASON_DEFAULT_PT_BR;
}

/**
 * Patient registration input (Story 1.1).
 *
 * Password rule per AC1: minimum 8 characters, at least one digit.
 *
 * Email normalization is done at the form layer (`normalizeEmail`) and
 * applied right before `supabase.auth.signUp` — not chained into the
 * schema. Chaining `.trim().toLowerCase()` onto `z.email()` would run the
 * email validator first and reject whitespace-padded input before the trim
 * could rescue it; and form libraries that pass raw field state to submit
 * handlers (e.g. TanStack Form) would still ship un-normalized values to
 * Supabase, defeating the purpose. Doing it explicitly at the boundary is
 * simpler and platform-uniform.
 *
 * Validation messages are pt-BR, soft-toned per UX-DR20, and surfaced as
 * amber inline hints — never as red errors.
 */
export const RegisterSchema = z.object({
  email: z.email("Isso não parece um e-mail — quer tentar de novo?"),
  password: z
    .string()
    .min(8, "Use pelo menos 8 caracteres.")
    .regex(/\d/, "Inclua pelo menos um número."),
});

export type RegisterInput = z.infer<typeof RegisterSchema>;

/**
 * Canonical email normalization applied at the registration boundary so the
 * web and Expo clients can never create distinct Supabase accounts for
 * inputs that only differ in case or surrounding whitespace.
 */
export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

/**
 * Persistent helper text for the password field — shown below the input
 * regardless of validation state so the rule is visible while typing.
 */
export const PASSWORD_HELPER_TEXT_PT_BR =
  "Pelo menos 8 caracteres, com um número.";

/**
 * Brazilian-Portuguese duplicate-email message mandated by Story 1.1 AC2.
 */
export const DUPLICATE_EMAIL_MESSAGE_PT_BR =
  "Já existe uma conta com esse e-mail. Tente entrar.";

/**
 * Generic pt-BR error message for failures we don't want to surface verbatim.
 */
export const GENERIC_REGISTRATION_ERROR_MESSAGE_PT_BR =
  "Algo deu errado. Tente novamente.";

/**
 * Structural shape of a Supabase Auth error. Kept intentionally narrow so it
 * accepts both `AuthError` and any near-equivalent.
 */
export interface SignUpErrorLike {
  status?: number;
  code?: string;
  message?: string;
}

/**
 * Known Supabase Auth error codes that indicate an email is already taken.
 * The set is widened conservatively as Supabase ships new codes. We do NOT
 * substring-match `error.message` — wording is localized and has changed
 * between SDK versions, which would silently break duplicate-email routing.
 */
const DUPLICATE_EMAIL_CODES = new Set([
  "user_already_exists",
  "email_exists",
  "email_address_already_registered",
]);

export function isDuplicateEmailError(error: SignUpErrorLike): boolean {
  return (
    typeof error.code === "string" && DUPLICATE_EMAIL_CODES.has(error.code)
  );
}

// =============================================================================
// Story 1.2 — LGPD consent at onboarding
// =============================================================================

/**
 * Full vocabulary of `consent_type_enum` values (mirrors the pgEnum in
 * `packages/db/src/schema/consent.ts`). Story 1.2 writes the first three;
 * the rest are reserved for Epic 4 (Letter) and Epic 5 (sharing) so we
 * don't need a separate enum migration later.
 */
export const CONSENT_DATA_TYPES = [
  "blood_test_results",
  "bioimpedance",
  "ai_narrative",
  "health_data_processing",
  "ai_extraction",
  "doctor_sharing",
  "llm_letter_generation",
] as const;

export type ConsentDataType = (typeof CONSENT_DATA_TYPES)[number];

/**
 * The three consent surfaces shown during onboarding (AC1).
 */
export const CONSENT_SCREEN_TYPES = [
  "blood_test_results",
  "bioimpedance",
  "ai_narrative",
] as const satisfies readonly ConsentDataType[];

export type ConsentScreenType = (typeof CONSENT_SCREEN_TYPES)[number];

/**
 * Runtime narrowing for arbitrary strings (route params, JSON payloads)
 * into the patient-facing `ConsentScreenType` union. Centralized in
 * validators because the Settings list + detail screens on both Expo
 * and Web all need it (review P31: previously duplicated 4×).
 */
export function isConsentScreenType(value: string): value is ConsentScreenType {
  return (CONSENT_SCREEN_TYPES as readonly string[]).includes(value);
}

/**
 * ISO date format. Bump on every legal-copy change. Sortable and
 * human-readable. Stored on every `consent_grants` row for FR33 audit.
 */
export const CONSENT_TEXT_VERSION = "2026-05-19";

/**
 * Patient-facing grant/decline procedures accept only the three onboarding
 * screen types. Broader `consent_type` values (`doctor_sharing`,
 * `llm_letter_generation`, etc.) belong to later epics with their own
 * surfaces — narrowing here prevents a client from pre-granting those
 * categories via the patient UI.
 */
export const ConsentGrantInputSchema = z.object({
  consentType: z.enum(CONSENT_SCREEN_TYPES),
  version: z.string().min(1),
});
export type ConsentGrantInput = z.infer<typeof ConsentGrantInputSchema>;

export const ConsentDeclineInputSchema = z.object({
  consentType: z.enum(CONSENT_SCREEN_TYPES),
  version: z.string().min(1),
});
export type ConsentDeclineInput = z.infer<typeof ConsentDeclineInputSchema>;

/**
 * Story 1.4 — input for the new `consent.revoke` procedure. Narrow to the
 * three patient-facing surfaces (broader `doctor_sharing` /
 * `llm_letter_generation` categories belong to later epics with their own
 * revocation surfaces).
 */
export const ConsentRevokeInputSchema = z.object({
  consentType: z.enum(CONSENT_SCREEN_TYPES),
});
export type ConsentRevokeInput = z.infer<typeof ConsentRevokeInputSchema>;

/**
 * Story 1.4 — `consent.list` accepts an optional `surface` flag so the
 * Settings screen can emit a `consent.read` audit event without the
 * onboarding-callback consumers (web `/auth/callback`, Expo `_layout.tsx`)
 * accidentally writing the same audit row on every cold launch.
 *
 * Default is `'callback'` so existing zero-arg callsites keep working.
 */
export const ConsentListInputSchema = z
  .object({
    surface: z.enum(["settings", "callback"]).optional(),
  })
  .default({});
export type ConsentListInput = z.infer<typeof ConsentListInputSchema>;

/** Routes the onboarding flow and post-consent flow target. */
export const ONBOARDING_CONSENT_ROUTE = "/onboarding/consent";
export const INICIO_ROUTE = "/inicio";
/**
 * Registration route. No dedicated sign-in screen exists yet (Clarification
 * #4) — the lock-screen three-fail fallback signs the user out and routes
 * here; registration surfaces "already exists" on re-submit. Update to a
 * `/login` constant when a sign-in screen ships.
 */
export const REGISTER_ROUTE = "/register";

/**
 * Story 1.4 — Settings route constants. Two per surface because the web
 * URL hierarchy uses `/configuracoes/privacidade/...` while Expo's
 * `(tabs)/configuracoes` is the tab shell (URL path is `/privacidade/...`).
 */
export const PRIVACIDADE_ROUTE = "/privacidade";
export const MEUS_CONSENTIMENTOS_ROUTE = "/privacidade/consentimentos";
export const WEB_CONFIGURACOES_ROUTE = "/configuracoes";
export const WEB_CONFIGURACOES_PRIVACIDADE_ROUTE = "/configuracoes/privacidade";
export const WEB_MEUS_CONSENTIMENTOS_ROUTE =
  "/configuracoes/privacidade/consentimentos";

/**
 * pt-BR copy for the three onboarding consent screens. Plain language,
 * 8th-grade reading level (UX-DR20). The AI narrative body names
 * Anthropic explicitly (AC4). Decline-consequence sentences follow the
 * UX spec's consequence-language pattern (UX spec line 1214).
 */
interface ConsentScreenCopy {
  title: string;
  body: string;
  primaryCta: string;
  secondaryCta: string;
  declineConsequence: string;
}

export const CONSENT_SCREEN_COPY: Record<ConsentScreenType, ConsentScreenCopy> =
  {
    blood_test_results: {
      title: "Resultados de exames de sangue",
      body: "Para acompanhar a sua história de saúde, vamos guardar os resultados dos seus exames de sangue (como ferritina, glicose e colesterol). Os valores ficam protegidos no app e só você decide com quem compartilhar.",
      primaryCta: "Concordo",
      secondaryCta: "Pular por agora",
      declineConsequence:
        "Sem este consentimento, você não poderá enviar exames de sangue — seu cadastro continua ativo.",
    },
    bioimpedance: {
      title: "Medidas de bioimpedância",
      body: "Vamos guardar as suas medidas de bioimpedância (como massa magra, gordura corporal e água) para mostrar como elas mudam ao longo do tempo. Os dados ficam protegidos e privados.",
      primaryCta: "Concordo",
      secondaryCta: "Pular por agora",
      declineConsequence:
        "Sem este consentimento, você não poderá enviar medidas de bioimpedância — seu cadastro continua ativo.",
    },
    ai_narrative: {
      title: "Geração de A Carta com IA",
      body: "Para criar A Carta — um relato pessoal dos seus resultados — enviamos seus exames de sangue e bioimpedância à Anthropic, nossa provedora de IA, que tem acordo de proteção de dados em vigor. A Anthropic não usa seus dados para treinar modelos.",
      primaryCta: "Concordo",
      secondaryCta: "Pular por agora",
      declineConsequence:
        "Sem este consentimento, A Carta e as sugestões de conversa com o médico não serão geradas — seus dados continuam protegidos no app.",
    },
  };

/** Header shown above the version identifier on each consent screen. */
export const CONSENT_VERSION_LABEL_PT_BR = "Versão do termo";

/**
 * Headline and CTA shown on the Início empty state (AC5). The headline is
 * forward-looking per UX-DR10; the CTA is the exact pt-BR text from AC5.
 */
export const INICIO_HEADLINE_PT_BR = "Sua história de saúde começa aqui";
/**
 * Story 1.5 AC3 updates this from Story 1.2's `"Enviar resultado"` to
 * the longer `"Enviar primeiro resultado"` (per the AC text). Both
 * surface on the empty-state CTA — Story 1.2's wording is preserved in
 * git history. Once a third Início state ships (post-upload), this
 * constant will likely diverge again.
 */
export const INICIO_CTA_PT_BR = "Enviar primeiro resultado";

/**
 * Generic pt-BR error shown when a consent.grant / consent.decline call
 * fails for a reason we don't want to surface verbatim. Distinct from the
 * registration error string so the two flows can diverge later.
 */
export const GENERIC_CONSENT_ERROR_MESSAGE_PT_BR =
  "Não foi possível registrar agora. Tente novamente.";

/**
 * Message shown on the registration screen when Supabase has email
 * confirmation enabled and signUp succeeded without issuing a session.
 * The patient must click the verification link before the consent flow
 * is reachable; routing to consent here would dead-end on UNAUTHORIZED.
 */
export const VERIFY_EMAIL_MESSAGE_PT_BR =
  "Enviamos um link de verificação para o seu e-mail. Clique nele para continuar.";

// =============================================================================
// Story 1.3 — Biometric authentication (mobile-only)
// =============================================================================

/**
 * Onboarding offer-screen route. Reached after the LGPD consent flow
 * (Story 1.2) completes; replaces the previous direct hop to INICIO_ROUTE
 * so the patient is asked once about biometric before landing on Início.
 */
export const BIOMETRIC_ROUTE = "/onboarding/biometric";

/**
 * Lock / unlock screen route. Lives under the `(auth)` Expo Router group
 * (architecture.md lines 986–988). The group parentheses do not appear
 * in the URL; the path the router actually sees is `/biometric`.
 */
export const BIOMETRIC_LOCK_ROUTE = "/biometric";

/**
 * pt-BR copy for the biometric offer screen (Task 3) and lock screen
 * (Task 5). Plain language, 8th-grade reading level (UX-DR20). The
 * "Usar biometria" wording matches AC2 exactly — we deliberately do NOT
 * branch to "Usar Face ID" / "Usar digital" yet (Clarification #2).
 */
export const BIOMETRIC_TITLE_PT_BR = "Proteção extra";

export const BIOMETRIC_BODY_PT_BR =
  "Use Face ID ou sua digital para destravar o app rapidamente. Os seus dados de saúde continuam protegidos — a biometria só serve para abrir o app neste aparelho.";

export const BIOMETRIC_ENABLE_CTA_PT_BR = "Usar biometria";

/**
 * Unlock-screen CTA. Same wording as the enable CTA today (Clarification
 * #2), but a dedicated constant so the two surfaces can diverge without
 * a refactor — e.g., a future "Destravar com biometria" only touches
 * this constant.
 */
export const BIOMETRIC_UNLOCK_CTA_PT_BR = "Usar biometria";

export const BIOMETRIC_SKIP_CTA_PT_BR = "Pular por agora";

export const BIOMETRIC_UNAVAILABLE_MESSAGE_PT_BR =
  "O seu dispositivo não suporta biometria — você pode ativar mais tarde nas configurações.";

/** Native prompt strings passed to `LocalAuthentication.authenticateAsync`. */
export const BIOMETRIC_ENROLL_PROMPT_PT_BR =
  "Confirme com biometria para ativar";
export const BIOMETRIC_UNLOCK_PROMPT_PT_BR =
  "Confirme com biometria para entrar";
export const BIOMETRIC_CANCEL_PT_BR = "Cancelar";

/**
 * Lock-screen body copy.
 */
export const BIOMETRIC_LOCK_TITLE_PT_BR = "Health Tracker";
export const BIOMETRIC_LOCK_BODY_PT_BR =
  "Confirme com biometria para acessar a sua conta.";

/**
 * Generic pt-BR error shown when an `authenticateAsync` call fails for a
 * reason we don't want to surface verbatim. Distinct from registration /
 * consent error strings so the three flows can diverge later.
 */
export const GENERIC_BIOMETRIC_ERROR_MESSAGE_PT_BR =
  "Não conseguimos confirmar — tente de novo.";

// =============================================================================
// Story 1.4 — Settings → Privacidade → Meus Consentimentos
// =============================================================================

/** Titles for the Settings tab + Privacidade landing + list screen. */
export const CONFIGURACOES_TITLE_PT_BR = "Configurações";
export const PRIVACIDADE_TITLE_PT_BR = "Privacidade";
export const MEUS_CONSENTIMENTOS_TITLE_PT_BR = "Meus Consentimentos";

/** Row label for the Privacidade row in the Settings index. */
export const CONFIGURACOES_PRIVACIDADE_ROW_PT_BR = "Privacidade";

/** Affordance for not-yet-functional Settings rows ("Conta", "Notificações"). */
export const CONFIGURACOES_DISABLED_HINT_PT_BR = "Em breve";

/** Revocation CTA + confirmation copy (UX consequence-language pattern). */
export const CONSENT_REVOKE_CTA_PT_BR = "Retirar consentimento";
export const CONSENT_REVOKE_CONFIRM_TITLE_PT_BR = "Retirar este consentimento?";
export const CONSENT_REVOKE_CONFIRM_PRIMARY_PT_BR = "Sim, retirar";
export const CONSENT_REVOKE_CONFIRM_SECONDARY_PT_BR = "Cancelar";
/**
 * Consequence statement appended to the per-type decline body. The body
 * already names the specific consequence ("A Carta não será gerada…");
 * this trailing line clarifies that existing data is not deleted.
 */
export const CONSENT_REVOKE_DATA_RETENTION_PT_BR =
  "Seus dados existentes não serão apagados. Para apagar, vá em Conta > Apagar minha conta.";

/** Empty-state copy for the Meus Consentimentos list. */
export const MEUS_CONSENTIMENTOS_EMPTY_HEADLINE_PT_BR =
  "Você ainda não tem consentimentos ativos";
export const MEUS_CONSENTIMENTOS_EMPTY_CTA_PT_BR = "Revisar consentimentos";

/** Error-state copy for the Meus Consentimentos list. */
export const MEUS_CONSENTIMENTOS_ERROR_PT_BR =
  "Não foi possível carregar agora. Tente novamente.";
export const MEUS_CONSENTIMENTOS_RETRY_PT_BR = "Tentar novamente";

/** Labels for the date column on each row. */
export const CONSENT_GRANTED_ON_LABEL_PT_BR = "Aceito em";

/**
 * Placeholder rendered when `formatConsentGrantedDate` is handed a value
 * it cannot parse. Non-empty so a stranded label ("Aceito em ") never
 * appears on screen (round-2 P35).
 */
export const UNKNOWN_DATE_PT_BR = "—";

/**
 * Formats a `consent_grants.granted_at` value for display in pt-BR. Uses
 * `Intl.DateTimeFormat('pt-BR', { dateStyle: 'long' })` — Hermes on SDK 54
 * ships `Intl` enabled. Falls back to the raw ISO string when the string
 * input is unparseable, or `UNKNOWN_DATE_PT_BR` when a `Date` itself is
 * Invalid (round-2 P35 — never return empty).
 */
export function formatConsentGrantedDate(date: Date | string): string {
  const parsed = typeof date === "string" ? new Date(date) : date;
  if (Number.isNaN(parsed.getTime())) {
    return typeof date === "string" && date.length > 0
      ? date
      : UNKNOWN_DATE_PT_BR;
  }
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "long" }).format(parsed);
}

// =============================================================================
// Story 1.5 — Prior lab results import during onboarding
// =============================================================================

/** Bytes — 5 MB per FR1 / NFR-P1. */
export const UPLOAD_MAX_BYTES = 5 * 1024 * 1024;

/**
 * Allowed mime types for the onboarding import + Epic 2 upload flows.
 * PDF (FR1) and image variants (FR2). Validated at the picker AND at
 * the tRPC procedure boundary.
 */
export const UPLOAD_ALLOWED_MIME_TYPES = [
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/heic",
  // Story 2.2 round-1 P81 — iOS Safari sometimes labels HEIC photos
  // as `image/heif`; legit iPhone HEIC uploads via web were rejected
  // as unsupported. Server-side: Supabase Storage echoes whatever the
  // browser sends for the PUT; the allowlist must accept it.
  "image/heif",
] as const;
export type UploadMimeType = (typeof UPLOAD_ALLOWED_MIME_TYPES)[number];

export function isUploadMimeType(value: string): value is UploadMimeType {
  return (UPLOAD_ALLOWED_MIME_TYPES as readonly string[]).includes(value);
}

/**
 * Strips path separators, control chars, and limits length so a hostile
 * `originalFilename` cannot escape the patient-prefixed storage path.
 * Server-side only — applied inside `uploads.requestImport` before the
 * signed-URL is issued.
 */
export function sanitizeFilename(name: string): string {
  // Drop control chars + path separators; collapse repeated dots.
  // eslint-disable-next-line no-control-regex
  const stripped = name.replace(/[\x00-\x1f\x7f/\\]/g, "");
  const noTraversal = stripped.replace(/\.{2,}/g, ".");
  const trimmed = noTraversal.trim();
  const fallback = trimmed.length === 0 ? "upload" : trimmed;
  return fallback.slice(0, 128);
}

/**
 * Story 2.1 — the upload `source` distinguishes onboarding imports
 * (Story 1.5 entry surface) from post-onboarding uploads (Story 2.1+
 * entry surfaces on Início). Audit / analytics use this to tell where
 * in the funnel a row came from. Story 1.5 P46 removed the DB-column
 * default to force every writer to be explicit — match that intent at
 * every layer.
 */
export const UPLOAD_SOURCES = ["onboarding_import", "post_onboarding"] as const;
export type UploadSource = (typeof UPLOAD_SOURCES)[number];

export function isUploadSource(value: string): value is UploadSource {
  return (UPLOAD_SOURCES as readonly string[]).includes(value);
}

/** Max PDF pages accepted in the upload flow (Story 2.1 AC4). */
export const UPLOAD_MAX_PDF_PAGES = 10;

/**
 * Story 2.1 P52 + P61 — `pageCount` is REQUIRED when `mimeType` is
 * `application/pdf` (so a hostile client can't bypass the cap by
 * omitting the field) and uses `.nonnegative()` (so a legal 0-page
 * PDF trips the friendly pt-BR copy via the page-count gate rather
 * than a Zod error). For non-PDF mime types, `pageCount` is ignored.
 */
const uploadPageCountRefinement = (data: {
  mimeType: string;
  pageCount?: number;
}): boolean =>
  data.mimeType !== "application/pdf" || data.pageCount !== undefined;

export const UploadImportRequestSchema = z
  .object({
    originalFilename: z.string().min(1).max(256),
    mimeType: z.enum(UPLOAD_ALLOWED_MIME_TYPES),
    sizeBytes: z.number().int().positive().max(UPLOAD_MAX_BYTES),
    source: z.enum(UPLOAD_SOURCES),
    pageCount: z.number().int().nonnegative().optional(),
    /**
     * Story 2.6 — offline-queue flow generates the `idempotency_key`
     * client-side at pick time so the same key persists across kill +
     * relaunch. The server echoes it back when provided; the existing
     * `uploads_patient_idempotency_unique` index on `(patient_id,
     * idempotency_key)` enforces dedup. When omitted (the regular
     * online flow), the server generates a UUID.
     */
    clientIdempotencyKey: z.uuid().optional(),
  })
  .refine(uploadPageCountRefinement, {
    message: "PDF uploads require pageCount",
    path: ["pageCount"],
  });
export type UploadImportRequest = z.infer<typeof UploadImportRequestSchema>;

/**
 * Story 1.5 review round-1 P38 — `storagePath` is no longer in the
 * confirm input. The server re-derives it from
 * `(patientId, idempotencyKey, sanitizeFilename(originalFilename))` so
 * a hostile client cannot point the DB row at a forged path. `mimeType`
 * + `sizeBytes` are retained for client-side validation symmetry but
 * the server re-validates them against the actually-uploaded object
 * (P39 + P42).
 */
export const UploadImportConfirmSchema = z
  .object({
    idempotencyKey: z.uuid(),
    originalFilename: z.string().min(1).max(256),
    mimeType: z.enum(UPLOAD_ALLOWED_MIME_TYPES),
    sizeBytes: z.number().int().positive().max(UPLOAD_MAX_BYTES),
    source: z.enum(UPLOAD_SOURCES),
    /** Story 2.1 — see UploadImportRequestSchema.pageCount. */
    pageCount: z.number().int().nonnegative().optional(),
  })
  .refine(uploadPageCountRefinement, {
    message: "PDF uploads require pageCount",
    path: ["pageCount"],
  });
export type UploadImportConfirm = z.infer<typeof UploadImportConfirmSchema>;

/** Onboarding import-screen route. */
export const IMPORT_ROUTE = "/onboarding/import";

/** pt-BR copy for the onboarding import screen + Início CTA hookup. */
export const IMPORT_TITLE_PT_BR = "Trazer seus exames anteriores";
export const IMPORT_BODY_PT_BR =
  "Se você já tem exames de sangue ou bioimpedância, envie-os agora para a sua história de saúde começar com mais contexto. Você pode enviar quantos quiser — ou pular e fazer isso depois.";
export const IMPORT_PICK_CTA_PT_BR = "Escolher arquivos";
export const IMPORT_CONFIRM_CTA_PT_BR = "Enviar resultados";
export const IMPORT_SKIP_CTA_PT_BR = "Fazer isso depois";

/** Error states for the import flow. */
export const UPLOAD_FILE_TOO_LARGE_PT_BR =
  "Este arquivo passa de 5 MB. Tente outro ou divida em partes menores.";
export const UPLOAD_UNSUPPORTED_MIME_PT_BR =
  "Tipo de arquivo não suportado. Envie um PDF, JPG, PNG ou HEIC.";
export const UPLOAD_EMPTY_FILE_PT_BR = "Arquivo vazio. Selecione outro.";
export const GENERIC_UPLOAD_ERROR_MESSAGE_PT_BR =
  "Não foi possível enviar este arquivo. Tente novamente.";

/** Status badge shown after a file is queued for extraction. */
export const UPLOAD_QUEUED_BADGE_PT_BR = "Enviado";

/** iOS Photo Library permission string (used in app.config.ts). */
export const PHOTO_LIBRARY_PERMISSION_PT_BR =
  "Permita o acesso à sua biblioteca de fotos para enviar resultados de exames.";

// =============================================================================
// Story 2.1 — Post-onboarding PDF upload + ExtractionPulse + upload sheet
// =============================================================================

/** Error message for PDFs that exceed the page cap (AC4). */
export const UPLOAD_PDF_TOO_MANY_PAGES_PT_BR =
  "Este PDF tem mais de 10 páginas. Envie um exame por vez.";

/**
 * Story 2.1 P54 — surfaced when the PDF can't be parsed (encrypted,
 * corrupt, or a network failure on the fetch+arrayBuffer round-trip).
 * The previous behaviour was to surface UPLOAD_PDF_TOO_MANY_PAGES even
 * for unparseable input, which blamed the patient for the wrong cause.
 */
export const UPLOAD_PDF_UNREADABLE_PT_BR =
  "Não conseguimos ler este PDF. Tente outro arquivo.";

/**
 * pt-BR labels for the upload `source` enum — used by future status
 * surfaces (Story 2.5) and any debug copy.
 */
export const UPLOAD_SOURCE_PT_BR_LABELS: Record<UploadSource, string> = {
  onboarding_import: "Importar do onboarding",
  post_onboarding: "Enviado depois do onboarding",
};

/** Upload-source bottom-sheet copy (Início post-onboarding entry). */
export const UPLOAD_SHEET_TITLE_PT_BR = "Como deseja enviar?";
export const UPLOAD_SHEET_PDF_LABEL_PT_BR = "Arquivo PDF";
/**
 * Story 2.2 — three active rows (PDF / Library / Camera). The single
 * `UPLOAD_SHEET_PHOTO_LABEL_PT_BR` that Story 2.1 shipped as a
 * disabled "Em breve" stub is removed; consumers now pick library
 * vs camera explicitly.
 */
export const UPLOAD_SHEET_PHOTO_LIBRARY_LABEL_PT_BR = "Foto da galeria";
export const UPLOAD_SHEET_PHOTO_CAMERA_LABEL_PT_BR = "Tirar foto";
export const UPLOAD_SHEET_PHOTO_LIBRARY_HINT_PT_BR =
  "Abre o seletor de fotos do dispositivo";
export const UPLOAD_SHEET_PHOTO_CAMERA_HINT_PT_BR =
  "Abre a câmera para fotografar um exame";
export const UPLOAD_SHEET_PHOTO_CAMERA_HINT_WEB_PT_BR =
  "Abre a câmera no celular, ou o seletor de arquivos no desktop";
export const UPLOAD_SHEET_CANCEL_PT_BR = "Cancelar";

/** Story 2.2 — camera permission denial copy (mirrors PHOTO_LIBRARY_PERMISSION_PT_BR). */
export const CAMERA_PERMISSION_PT_BR =
  "Permita o acesso à câmera para fotografar o seu exame.";

/** Story 2.2 — image OCR failure surface + 3 recovery options (AC4). */
export const UPLOAD_IMAGE_OCR_FAILED_PT_BR =
  "Não conseguimos ler este exame. Tente uma destas opções abaixo.";
export const UPLOAD_RECOVERY_RETAKE_PT_BR = "Tirar nova foto";
export const UPLOAD_RECOVERY_UPLOAD_PDF_PT_BR = "Enviar PDF";
export const UPLOAD_RECOVERY_MANUAL_PT_BR = "Inserir manualmente";

/**
 * Story 2.2 round-2 R2-P86 — fallback line rendered by ExtractionPulse
 * when state is `failed` and no recovery callbacks are wired. Every
 * other pt-BR string in the upload surface lives here per
 * Story 2.1 / 2.2 Task 8 invariant.
 */
export const UPLOAD_FAILED_GENERIC_RETRY_PT_BR =
  "Tente novamente em alguns instantes.";

/**
 * Story 2.2 — explicit picker source for `pickImages`. Library uses
 * `launchImageLibraryAsync`; camera uses `launchCameraAsync` and
 * requires `NSCameraUsageDescription` on iOS + the camera runtime
 * permission via `requestCameraPermissionsAsync`.
 */
export const PICK_IMAGE_SOURCES = ["library", "camera"] as const;
export type PickImageSource = (typeof PICK_IMAGE_SOURCES)[number];

/**
 * ExtractionPulse patience-pattern copy (UX-DR4, ux-design-specification.md
 * L1090–1094). Keyed off elapsed milliseconds since the upload started.
 */
export const EXTRACTION_PULSE_COPY_0_10S_PT_BR = "Lendo seu exame…";
export const EXTRACTION_PULSE_COPY_10_20S_PT_BR =
  "Este está demorando um pouco — exames complexos pedem mais cuidado";
export const EXTRACTION_PULSE_COPY_20_30S_PT_BR = "Ainda processando…";
export const EXTRACTION_PULSE_COPY_30S_PLUS_PT_BR = "Ainda processando…";
export const EXTRACTION_PULSE_REVIEW_NEEDED_PT_BR =
  "Um resultado precisa da sua confirmação";
export const EXTRACTION_PULSE_COMPLETE_PT_BR = "Pronto";
export const EXTRACTION_PULSE_MANUAL_ENTRY_CTA_PT_BR = "Inserir manualmente";

/**
 * Pure-function mapping from elapsed-ms to the patience-pattern micro-copy.
 * Lives in validators so the rendering surface (ExtractionPulse) and the
 * unit tests share one source of truth.
 *
 * Thresholds: [0, 10s) / [10s, 20s) / [20s, 30s) / [30s, ∞). After 30s
 * the copy stays the same as the 20–30s bucket; the 30s+ marker is
 * carried separately so the renderer knows when to surface the
 * "Inserir manualmente" escape hatch.
 */
export function extractionPulseCopyForElapsedMs(elapsedMs: number): string {
  if (elapsedMs < 10_000) return EXTRACTION_PULSE_COPY_0_10S_PT_BR;
  if (elapsedMs < 20_000) return EXTRACTION_PULSE_COPY_10_20S_PT_BR;
  if (elapsedMs < 30_000) return EXTRACTION_PULSE_COPY_20_30S_PT_BR;
  return EXTRACTION_PULSE_COPY_30S_PLUS_PT_BR;
}

/** Story 2.1 — true once the patience pattern's escape-hatch threshold passes. */
export function extractionPulseShouldShowManualEntry(
  elapsedMs: number,
): boolean {
  return elapsedMs >= 30_000;
}

/**
 * Counts pages in a PDF. Uses `pdf-lib` (pure JS, RN + browser safe).
 * Story 2.1 AC4: pre-transmission gate at `UPLOAD_MAX_PDF_PAGES = 10`.
 *
 * Memory: a 5 MB PDF buffer + pdf-lib's parsed object graph is well
 * under typical RN/browser heap budgets.
 */
export async function countPdfPages(
  bytes: ArrayBuffer | Uint8Array,
): Promise<number> {
  const { PDFDocument } = await import("pdf-lib");
  const doc = await PDFDocument.load(bytes, {
    updateMetadata: false,
    // Story 2.1 P60 — `ignoreEncryption` lets encrypted PDFs report a
    // page count instead of throwing `EncryptedPDFError`. The previous
    // option (`throwOnInvalidObject`) is not in pdf-lib's `LoadOptions`
    // and was silently ignored.
    ignoreEncryption: true,
  });
  return doc.getPageCount();
}
