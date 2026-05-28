/**
 * Story 6.1 T6.1 — schema-shape contract for
 * `sharingRouter.getPreAuthContext`.
 *
 * **R1-H2 fix-up:** the four state-branch end-to-end assertions
 * (active / expired / revoked / unknown-id / bad-HMAC / revoke
 * precedence + the AC10 "exactly one audit row per branch" invariant)
 * now live in
 * `packages/db/__tests__/integration/share-tokens-preauth.integration.test.ts`
 * — that file uses the existing testcontainer harness at
 * `packages/db/__tests__/integration/setup.ts`. The db package owns
 * the testcontainer infra; the api package cannot import it without
 * a circular dependency (api depends on db).
 *
 * What stays here:
 *   - the input-Zod-schema contract (boundary discipline);
 *   - the `SHARE_TOKEN_READ_PHASE_PRE_AUTH` constant pin (drift guard).
 *
 * Excluded from `test:unit` via the `*.integration.test.ts` filter
 * in `packages/api/vitest.config.ts`.
 */
import { describe, expect, it } from "vitest";

import {
  getPreAuthContextInputSchema,
  SHARE_TOKEN_READ_PHASE_PRE_AUTH,
} from "@healthtracker/validators";

describe("getPreAuthContext — schema-shape (Story 6.1 T6.1)", () => {
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
});
