/**
 * Story 5.4 T1.4 / T6.3 — integration coverage for
 * `sharingRouter.revokeShareToken`.
 *
 * Authored as `it.todo()` placeholders so CI picks the file up once
 * the testcontainer harness is shared across the db + api packages
 * (same posture as `configure-biomarkers.integration.test.ts`).
 * `*.integration.test.ts` is excluded from `test:unit` via the
 * filter in `packages/api/vitest.config.ts`.
 *
 * Assertions to cover when the harness lands:
 *   - happy path: UPDATE sets revoked_at + one share_token.revoked
 *     audit row with metadata.revokedAt ISO-equal to share_tokens.revoked_at;
 *   - cross-patient: foreign patient's shareTokenId yields NOT_FOUND;
 *   - re-revoke: a second call on an already-revoked row yields
 *     NOT_FOUND (the `revoked_at IS NULL` guard short-circuits); no
 *     duplicate audit row;
 *   - concurrent revokes: two parallel calls serialize via FOR UPDATE
 *     — only the first writes the UPDATE + audit; the second 404s.
 */
import { describe, expect, it } from "vitest";

import {
  revokeShareTokenInputSchema,
  SHARING_AUDIT_TOKEN_REVOKED,
} from "@healthtracker/validators";

describe("revokeShareToken — integration (Story 5.4 T1.4)", () => {
  it("audit kind constant equals 'share_token.revoked'", () => {
    expect(SHARING_AUDIT_TOKEN_REVOKED).toBe("share_token.revoked");
  });

  it("zod schema is the single boundary contract", () => {
    expect(
      revokeShareTokenInputSchema.safeParse({
        shareTokenId: "00000000-0000-4000-8000-000000000000",
      }).success,
    ).toBe(true);
  });

  it.todo(
    "happy path: UPDATE sets revoked_at + writes one share_token.revoked audit",
  );
  it.todo("cross-patient: foreign patient's shareTokenId yields NOT_FOUND");
  it.todo(
    "re-revoke: already-revoked row yields NOT_FOUND; no duplicate audit row",
  );
  it.todo(
    "concurrent revokes serialize via FOR UPDATE — only the first commits",
  );
});
