/**
 * Story 5.2 T8.1 — Zod coverage for the `duration` field added to
 * `createShareTokenInputSchema`. The screen-owned default ("7d")
 * is intentionally NOT a server-side default — a missing field must
 * surface as a validation error so callers that forgot the picker
 * cannot silently land on the implicit 7-day window.
 */
import { describe, expect, it } from "vitest";

import { createShareTokenInputSchema } from "@healthtracker/validators";

const VALID_INVITE_ID = "11111111-1111-4111-8111-111111111111";

describe("createShareTokenInputSchema — duration enum (Story 5.2)", () => {
  it.each(["24h", "7d", "30d", "no_expiry"] as const)(
    "accepts duration=%s",
    (duration) => {
      const result = createShareTokenInputSchema.safeParse({
        inviteId: VALID_INVITE_ID,
        duration,
      });
      expect(result.success).toBe(true);
    },
  );

  it("rejects missing duration (no server-side default)", () => {
    const result = createShareTokenInputSchema.safeParse({
      inviteId: VALID_INVITE_ID,
    });
    expect(result.success).toBe(false);
  });

  it("rejects unknown duration string", () => {
    const result = createShareTokenInputSchema.safeParse({
      inviteId: VALID_INVITE_ID,
      duration: "forever",
    });
    expect(result.success).toBe(false);
  });

  it("rejects an invalid inviteId", () => {
    const result = createShareTokenInputSchema.safeParse({
      inviteId: "not-a-uuid",
      duration: "7d",
    });
    expect(result.success).toBe(false);
  });
});
