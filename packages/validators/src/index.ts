import { z } from "zod/v4";

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

/** Routes the onboarding flow and post-consent flow target. */
export const ONBOARDING_CONSENT_ROUTE = "/onboarding/consent";
export const INICIO_ROUTE = "/inicio";

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
export const INICIO_CTA_PT_BR = "Enviar resultado";

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
