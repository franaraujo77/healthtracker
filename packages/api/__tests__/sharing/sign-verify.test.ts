import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  generateShareToken,
  signShareToken,
  verifyShareToken,
} from "../../src/sharing";

const ORIGINAL_SECRET = process.env.SHARE_TOKEN_HMAC_SECRET;

beforeAll(() => {
  process.env.SHARE_TOKEN_HMAC_SECRET = "deterministic-test-secret";
});
afterAll(() => {
  if (ORIGINAL_SECRET === undefined) delete process.env.SHARE_TOKEN_HMAC_SECRET;
  else process.env.SHARE_TOKEN_HMAC_SECRET = ORIGINAL_SECRET;
});

describe("sharing — sign/verify round-trip", () => {
  it("verify returns true for a signature emitted by signShareToken", () => {
    const raw = "abc-123";
    const sig = signShareToken(raw);
    expect(verifyShareToken(raw, sig)).toBe(true);
  });

  it("verify returns false for a tampered signature", () => {
    const raw = "abc-123";
    const sig = signShareToken(raw);
    const tampered = `${sig.slice(0, -1)}${sig.endsWith("A") ? "B" : "A"}`;
    expect(verifyShareToken(raw, tampered)).toBe(false);
  });

  it("verify returns false for a different raw value", () => {
    const sig = signShareToken("abc-123");
    expect(verifyShareToken("abc-124", sig)).toBe(false);
  });

  it("generateShareToken emits raw + tokenHash + tokenHmac shape", () => {
    const out = generateShareToken();
    expect(out.raw.length).toBeGreaterThan(0);
    expect(out.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(out.tokenHmac.length).toBeGreaterThan(0);
    expect(verifyShareToken(out.raw, out.tokenHmac)).toBe(true);
  });
});
