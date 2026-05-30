/**
 * Story 6.4 T6.2 — Zod coverage for `createPatientInviteInputSchema`
 * and `createPatientInviteOutputSchema`, plus the
 * `getPatientInviteContext*Schema` pair.
 *
 * Boundary checks the browser modal + landing RSC depend on; reviewer
 * sees the constants line up with the form fields and the resolver's
 * discriminator.
 */
import { describe, expect, it } from "vitest";

import {
  createPatientInviteInputSchema,
  createPatientInviteOutputSchema,
  getPatientInviteContextInputSchema,
  getPatientInviteContextOutputSchema,
} from "@healthtracker/validators";

describe("createPatientInviteInputSchema — Story 6.4 AC5", () => {
  it("accepts an identifier + optional displayName", () => {
    const result = createPatientInviteInputSchema.safeParse({
      identifier: "patient@example.com",
      displayName: "João",
    });
    expect(result.success).toBe(true);
  });

  it("defaults displayName to null when omitted", () => {
    const result = createPatientInviteInputSchema.safeParse({
      identifier: "patient@example.com",
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.displayName).toBeNull();
  });

  it("trims identifier", () => {
    const result = createPatientInviteInputSchema.safeParse({
      identifier: "  patient@example.com  ",
      displayName: null,
    });
    expect(result.success).toBe(true);
    if (result.success)
      expect(result.data.identifier).toBe("patient@example.com");
  });

  it("rejects identifier shorter than 3 chars", () => {
    const result = createPatientInviteInputSchema.safeParse({
      identifier: "ab",
      displayName: null,
    });
    expect(result.success).toBe(false);
  });

  it("rejects identifier longer than 254 chars (RFC 5321)", () => {
    const result = createPatientInviteInputSchema.safeParse({
      identifier: "a".repeat(255),
      displayName: null,
    });
    expect(result.success).toBe(false);
  });

  it("rejects displayName longer than 80 chars", () => {
    const result = createPatientInviteInputSchema.safeParse({
      identifier: "patient@example.com",
      displayName: "x".repeat(81),
    });
    expect(result.success).toBe(false);
  });

  it("trims displayName", () => {
    const result = createPatientInviteInputSchema.safeParse({
      identifier: "patient@example.com",
      displayName: "  João  ",
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.displayName).toBe("João");
  });
});

describe("createPatientInviteOutputSchema — discriminator", () => {
  it("accepts the already-registered shape", () => {
    const result = createPatientInviteOutputSchema.safeParse({
      inviteId: null,
      inviteUrl: null,
      alreadyRegistered: true,
    });
    expect(result.success).toBe(true);
  });

  it("accepts the success shape", () => {
    const result = createPatientInviteOutputSchema.safeParse({
      inviteId: "11111111-1111-4111-8111-111111111111",
      inviteUrl:
        "https://example.test/convite/11111111-1111-4111-8111-111111111111.abc",
      alreadyRegistered: false,
    });
    expect(result.success).toBe(true);
  });
});

describe("getPatientInviteContextInputSchema — AC7", () => {
  it("accepts uuid + non-empty tokenHmac", () => {
    const result = getPatientInviteContextInputSchema.safeParse({
      inviteId: "11111111-1111-4111-8111-111111111111",
      tokenHmac: "abc",
    });
    expect(result.success).toBe(true);
  });

  it("rejects malformed inviteId", () => {
    const result = getPatientInviteContextInputSchema.safeParse({
      inviteId: "not-a-uuid",
      tokenHmac: "abc",
    });
    expect(result.success).toBe(false);
  });

  it("rejects empty tokenHmac", () => {
    const result = getPatientInviteContextInputSchema.safeParse({
      inviteId: "11111111-1111-4111-8111-111111111111",
      tokenHmac: "",
    });
    expect(result.success).toBe(false);
  });
});

describe("getPatientInviteContextOutputSchema", () => {
  it("accepts valid:true with non-null displayName", () => {
    const result = getPatientInviteContextOutputSchema.safeParse({
      valid: true,
      doctorDisplayName: "Dr. R",
    });
    expect(result.success).toBe(true);
  });

  it("accepts valid:false with null displayName", () => {
    const result = getPatientInviteContextOutputSchema.safeParse({
      valid: false,
      doctorDisplayName: null,
    });
    expect(result.success).toBe(true);
  });
});
