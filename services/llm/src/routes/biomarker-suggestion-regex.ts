/**
 * Story 4.3 — diagnostic-phrasing regex (mirrors the canonical
 * `LETTER_DIAGNOSTIC_PHRASE_REGEX` in `@healthtracker/validators`).
 * `services/llm` cannot import validators from production code, so
 * the literal is duplicated here. `__tests__/diagnostic-phrase-
 * sync.test.ts` pins this copy against the validators source via a
 * dev-only import — a future drift trips the snapshot test.
 *
 * Lives in its own module (rather than inside `biomarker-suggestion.ts`)
 * so the sync test can import the regex without transitively pulling
 * in `auth.ts` and its env-var validation, which would force every
 * caller — including the test — to provide Supabase env vars at
 * import time.
 */
export const DIAGNOSTIC_PHRASE_REGEX = /\b(você tem|isso indica|você deve)\b/iu;
