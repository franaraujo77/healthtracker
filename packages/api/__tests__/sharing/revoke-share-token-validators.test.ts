/**
 * Story 5.4 T1.3 / T6.2 — Zod coverage for `revokeShareTokenInputSchema`
 * + copy-function tests for the new pt-BR strings and the extended
 * `"revoked-pending"` token-status enum.
 */
import { describe, expect, it } from "vitest";

import {
  ACCESS_LOG_TOKEN_STATUS_PT_BR_FN,
  REVOKE_BUTTON_A11Y_PT_BR_FN,
  REVOKE_CONFIRM_BODY_PT_BR_FN,
  REVOKE_TIMEOUT_MS,
  revokeShareTokenInputSchema,
  SHARING_AUDIT_TOKEN_REVOKED,
} from "@healthtracker/validators";

const VALID_TOKEN_ID = "11111111-1111-4111-8111-111111111111";

describe("revokeShareTokenInputSchema (Story 5.4 T1.3)", () => {
  it("accepts a valid uuid", () => {
    const result = revokeShareTokenInputSchema.safeParse({
      shareTokenId: VALID_TOKEN_ID,
    });
    expect(result.success).toBe(true);
  });

  it("rejects a non-uuid string", () => {
    const result = revokeShareTokenInputSchema.safeParse({
      shareTokenId: "not-a-uuid",
    });
    expect(result.success).toBe(false);
  });

  it("rejects missing shareTokenId", () => {
    const result = revokeShareTokenInputSchema.safeParse({});
    expect(result.success).toBe(false);
  });
});

describe("Story 5.4 copy + constants (T6.1)", () => {
  it("REVOKE_CONFIRM_BODY_PT_BR_FN interpolates the display name", () => {
    expect(REVOKE_CONFIRM_BODY_PT_BR_FN("Dra. Renata")).toBe(
      "Tem certeza? Dra. Renata perderá acesso aos seus dados imediatamente.",
    );
  });

  it("REVOKE_BUTTON_A11Y_PT_BR_FN composes the a11y label", () => {
    expect(REVOKE_BUTTON_A11Y_PT_BR_FN("Dra. Renata")).toBe(
      "Revogar acesso de Dra. Renata ao seu histórico de saúde",
    );
  });

  it("ACCESS_LOG_TOKEN_STATUS_PT_BR_FN handles 'revoked-pending'", () => {
    expect(ACCESS_LOG_TOKEN_STATUS_PT_BR_FN("revoked-pending")).toBe(
      "Revogando…",
    );
  });

  it("REVOKE_TIMEOUT_MS is 5000ms (AC3, AC10)", () => {
    expect(REVOKE_TIMEOUT_MS).toBe(5000);
  });

  it("SHARING_AUDIT_TOKEN_REVOKED constant is the canonical event string", () => {
    expect(SHARING_AUDIT_TOKEN_REVOKED).toBe("share_token.revoked");
  });
});
