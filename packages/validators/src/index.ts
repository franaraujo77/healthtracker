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
