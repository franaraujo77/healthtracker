/**
 * Story 6.4 T6.1 — patient-invite helper unit tests.
 *
 * Covers:
 *   - `normalizePatientIdentifier` — email lowercase, BR phone formats,
 *     malformed inputs throw.
 *   - **AC8 LOAD-BEARING REGRESSION** —
 *     `signShareToken(raw) !== signPatientInviteToken(raw)` proves the
 *     `"patient_invite:"` domain prefix isolates the two signature
 *     universes even though they share the same HMAC secret.
 *   - `verifyPatientInviteToken` round-trip + constant-time false on
 *     length mismatch.
 *   - `buildPatientInviteUrl` composes the expected `/convite/...`
 *     shape against the reused `WEB_APP_URL` boot-gate.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  normalizePatientIdentifier,
  PatientIdentifierInvalidError,
} from "@healthtracker/validators";

import {
  buildPatientInviteUrl,
  generatePatientInviteToken,
  signPatientInviteToken,
  signShareToken,
  verifyPatientInviteToken,
} from "../../src/sharing";

const ORIGINAL_SECRET = process.env.SHARE_TOKEN_HMAC_SECRET;
const ORIGINAL_WEB_URL = process.env.WEB_APP_URL;

beforeAll(() => {
  process.env.SHARE_TOKEN_HMAC_SECRET = "deterministic-test-secret";
  process.env.WEB_APP_URL = "https://example.test";
});
afterAll(() => {
  if (ORIGINAL_SECRET === undefined) delete process.env.SHARE_TOKEN_HMAC_SECRET;
  else process.env.SHARE_TOKEN_HMAC_SECRET = ORIGINAL_SECRET;
  if (ORIGINAL_WEB_URL === undefined) delete process.env.WEB_APP_URL;
  else process.env.WEB_APP_URL = ORIGINAL_WEB_URL;
});

describe("normalizePatientIdentifier — AC2", () => {
  it("lowercases + trims email", () => {
    expect(normalizePatientIdentifier("  Patient@Example.COM  ")).toEqual({
      kind: "email",
      normalized: "patient@example.com",
    });
  });

  it("accepts standard BR mobile with full formatting", () => {
    expect(normalizePatientIdentifier("(11) 91234-5678")).toEqual({
      kind: "phone",
      normalized: "+5511912345678",
    });
  });

  it("accepts bare 11-digit BR mobile", () => {
    expect(normalizePatientIdentifier("11912345678")).toEqual({
      kind: "phone",
      normalized: "+5511912345678",
    });
  });

  it("accepts E.164-prefixed BR mobile", () => {
    expect(normalizePatientIdentifier("+5511912345678")).toEqual({
      kind: "phone",
      normalized: "+5511912345678",
    });
  });

  it("normalises the same mobile across format variants to identical hash key", () => {
    const a = normalizePatientIdentifier("(11) 9 1234-5678");
    const b = normalizePatientIdentifier("11912345678");
    const c = normalizePatientIdentifier("+5511912345678");
    expect(a.normalized).toBe(b.normalized);
    expect(b.normalized).toBe(c.normalized);
  });

  it("rejects landlines (no 9-prefix on subscriber)", () => {
    // (11) 3344-5566 — 10 digits, no leading 9. Brazilian landlines
    // are deliberately out of MVP scope.
    expect(() => normalizePatientIdentifier("1133445566")).toThrow(
      PatientIdentifierInvalidError,
    );
  });

  it("rejects 11-digit number without the 9 mobile-prefix", () => {
    // 11812345678 — 11 digits but 3rd is 8, not the required 9.
    expect(() => normalizePatientIdentifier("11812345678")).toThrow(
      PatientIdentifierInvalidError,
    );
  });

  it("rejects malformed email", () => {
    expect(() => normalizePatientIdentifier("not-an-email")).toThrow(
      PatientIdentifierInvalidError,
    );
    expect(() => normalizePatientIdentifier("@example.com")).toThrow(
      PatientIdentifierInvalidError,
    );
  });

  it("rejects empty / whitespace input", () => {
    expect(() => normalizePatientIdentifier("")).toThrow(
      PatientIdentifierInvalidError,
    );
    expect(() => normalizePatientIdentifier("   ")).toThrow(
      PatientIdentifierInvalidError,
    );
  });
});

describe("HMAC domain-prefix isolation — AC8 LOAD-BEARING REGRESSION", () => {
  it("signShareToken(raw) !== signPatientInviteToken(raw)", () => {
    // The two surfaces share `SHARE_TOKEN_HMAC_SECRET`; the
    // `"patient_invite:"` prefix on the patient-invite signing input
    // is the LOAD-BEARING security guarantee that prevents a
    // share-token HMAC from being replayed as a patient-invite HMAC
    // (or vice versa). Any refactor that drops the prefix is a
    // vulnerability and MUST be re-introduced.
    const raw = "abcdef1234567890";
    const shareSig = signShareToken(raw);
    const inviteSig = signPatientInviteToken(raw);
    expect(shareSig).not.toBe(inviteSig);
    expect(shareSig.length).toBeGreaterThan(0);
    expect(inviteSig.length).toBeGreaterThan(0);
  });

  it("verifyPatientInviteToken round-trip", () => {
    const raw = "round-trip-input";
    const sig = signPatientInviteToken(raw);
    expect(verifyPatientInviteToken(raw, sig)).toBe(true);
  });

  it("verifyPatientInviteToken returns false on different raw", () => {
    const sig = signPatientInviteToken("abc");
    expect(verifyPatientInviteToken("abd", sig)).toBe(false);
  });

  it("verifyPatientInviteToken returns false on tampered signature", () => {
    const raw = "tamper-target";
    const sig = signPatientInviteToken(raw);
    const tampered = `${sig.slice(0, -1)}${sig.endsWith("A") ? "B" : "A"}`;
    expect(verifyPatientInviteToken(raw, tampered)).toBe(false);
  });

  it("verifyPatientInviteToken returns false on length mismatch", () => {
    // Length mismatch must not throw (timingSafeEqual would on unequal
    // buffers); the helper short-circuits.
    expect(verifyPatientInviteToken("x", "short")).toBe(false);
  });

  it("a share-token signature does NOT verify as a patient-invite signature", () => {
    // Cross-surface replay attempt — exactly the attack the domain
    // prefix prevents.
    const raw = "cross-surface-replay";
    const shareSig = signShareToken(raw);
    expect(verifyPatientInviteToken(raw, shareSig)).toBe(false);
  });
});

describe("generatePatientInviteToken", () => {
  it("emits raw + tokenHmac shape (no tokenHash — doctor-side lookup by inviteId)", () => {
    const out = generatePatientInviteToken();
    expect(out.raw.length).toBeGreaterThan(0);
    expect(out.tokenHmac.length).toBeGreaterThan(0);
    expect(verifyPatientInviteToken(out.raw, out.tokenHmac)).toBe(true);
    // NO `tokenHash` field — distinct from `generateShareToken`.
    expect((out as Record<string, unknown>).tokenHash).toBeUndefined();
  });

  it("emits distinct raw on consecutive calls", () => {
    const a = generatePatientInviteToken();
    const b = generatePatientInviteToken();
    expect(a.raw).not.toBe(b.raw);
    expect(a.tokenHmac).not.toBe(b.tokenHmac);
  });
});

describe("buildPatientInviteUrl — AC5", () => {
  it("composes /convite/<inviteId>.<tokenHmac>", () => {
    const url = buildPatientInviteUrl("abc-123", "hmac-xyz");
    expect(url).toBe("https://example.test/convite/abc-123.hmac-xyz");
  });
});
