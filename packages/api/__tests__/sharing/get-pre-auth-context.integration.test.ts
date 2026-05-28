/**
 * Story 6.1 T6.1 — integration coverage for
 * `sharingRouter.getPreAuthContext`.
 *
 * Authored as schema-shape + `it.todo()` placeholders so CI picks
 * the file up. The full testcontainer harness is shared with the db
 * package (see `configure-biomarkers.integration.test.ts` — same
 * deferred posture). When the harness lands the todos cover:
 *
 *   - active token + correct HMAC → status="active", patientFirstName
 *     derived from email, single share_token.read audit row with
 *     metadata.phase = "pre-auth" + metadata.status = "active";
 *   - expired token → status="expired", patientFirstName=null,
 *     single audit row with status="expired";
 *   - revoked token → status="revoked", patientFirstName=null,
 *     single audit row with status="revoked";
 *   - unknown shareTokenId → status="invalid", single audit row;
 *   - bad HMAC against a real row → status="invalid", single audit
 *     row (information-disclosure hygiene — never reveal which
 *     branch failed);
 *   - revoke-then-expire precedence: a token with both revoked_at
 *     set AND expires_at < now() resolves to "revoked", not "expired".
 *
 * Excluded from `test:unit` via the `*.integration.test.ts` filter
 * in `packages/api/vitest.config.ts`.
 */
import { describe, expect, it } from "vitest";

import {
  getPreAuthContextInputSchema,
  SHARE_TOKEN_READ_PHASE_PRE_AUTH,
} from "@healthtracker/validators";

describe("getPreAuthContext — integration (Story 6.1 T6.1)", () => {
  it("zod schema is the single boundary contract", () => {
    expect(
      getPreAuthContextInputSchema.safeParse({
        shareTokenId: "00000000-0000-4000-8000-000000000000",
        tokenHmac: "any-string",
      }).success,
    ).toBe(true);
    // Reject empty HMAC.
    expect(
      getPreAuthContextInputSchema.safeParse({
        shareTokenId: "00000000-0000-4000-8000-000000000000",
        tokenHmac: "",
      }).success,
    ).toBe(false);
  });

  it("audit phase constant equals 'pre-auth'", () => {
    expect(SHARE_TOKEN_READ_PHASE_PRE_AUTH).toBe("pre-auth");
  });

  it.todo("active token + matching HMAC → status=active + patientFirstName");
  it.todo("expired token → status=expired + nulled patient context");
  it.todo("revoked token → status=revoked + nulled patient context");
  it.todo("unknown shareTokenId → status=invalid + single audit row");
  it.todo("bad HMAC against a real row → status=invalid + audit row");
  it.todo("revoked-AND-expired token resolves to revoked, not expired");
  it.todo("audit row carries metadata.phase=pre-auth on every branch");
});
