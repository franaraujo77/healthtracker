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
