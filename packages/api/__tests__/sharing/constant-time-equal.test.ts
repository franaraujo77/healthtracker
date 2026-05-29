/**
 * Story 6.1 T6.4 — unit coverage for `constantTimeEqualHmac`.
 *
 * Asserts:
 *   - differing-length inputs return `false` without throwing
 *     (Node 18+ `timingSafeEqual` throws on unequal Buffer lengths;
 *     the helper must guard explicitly);
 *   - identical strings return `true`;
 *   - one-bit differences return `false`.
 */
import { describe, expect, it } from "vitest";

import { constantTimeEqualHmac } from "../../src/sharing";

describe("constantTimeEqualHmac — Story 6.1 T6.4 / AC3", () => {
  it("returns true for identical strings", () => {
    expect(constantTimeEqualHmac("abc", "abc")).toBe(true);
    expect(constantTimeEqualHmac("", "")).toBe(true);
  });

  it("returns false for differing-length inputs without throwing", () => {
    expect(() => constantTimeEqualHmac("abc", "abcd")).not.toThrow();
    expect(constantTimeEqualHmac("abc", "abcd")).toBe(false);
    expect(constantTimeEqualHmac("a", "")).toBe(false);
    expect(constantTimeEqualHmac("", "z")).toBe(false);
  });

  it("returns false for a one-bit difference", () => {
    expect(constantTimeEqualHmac("abc", "abd")).toBe(false);
    expect(constantTimeEqualHmac("ZZZZ", "ZZZY")).toBe(false);
  });

  it("returns false when inputs differ at the first byte", () => {
    expect(constantTimeEqualHmac("abc", "Xbc")).toBe(false);
  });
});
