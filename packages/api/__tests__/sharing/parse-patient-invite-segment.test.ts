/**
 * Story 6.4 T1.5 — segment parser for `/convite/<id>.<hmac>`.
 *
 * Mirrors `parseShareTokenSegment` (Story 6.1). Strict UUID + non-empty
 * HMAC; malformed input → null so the landing RSC renders the generic
 * "convite inválido" card without a DB hit.
 */
import { describe, expect, it } from "vitest";

import { parsePatientInviteSegment } from "@healthtracker/validators";

const VALID_UUID = "11111111-1111-4111-8111-111111111111";

describe("parsePatientInviteSegment — Story 6.4 AC7", () => {
  it("parses valid segment", () => {
    const out = parsePatientInviteSegment(`${VALID_UUID}.abcXYZ_-`);
    expect(out).toEqual({ inviteId: VALID_UUID, tokenHmac: "abcXYZ_-" });
  });

  it("rejects missing dot", () => {
    expect(parsePatientInviteSegment(VALID_UUID)).toBeNull();
  });

  it("rejects empty hmac (dot at end)", () => {
    expect(parsePatientInviteSegment(`${VALID_UUID}.`)).toBeNull();
  });

  it("rejects empty inviteId (leading dot)", () => {
    expect(parsePatientInviteSegment(".abc")).toBeNull();
  });

  it("rejects empty string", () => {
    expect(parsePatientInviteSegment("")).toBeNull();
  });

  it("rejects malformed uuid", () => {
    expect(parsePatientInviteSegment("not-a-uuid.abc")).toBeNull();
  });

  it("splits on FIRST dot (extra dots in hmac stay in tokenHmac)", () => {
    const out = parsePatientInviteSegment(`${VALID_UUID}.abc.def`);
    expect(out).toEqual({ inviteId: VALID_UUID, tokenHmac: "abc.def" });
  });
});
