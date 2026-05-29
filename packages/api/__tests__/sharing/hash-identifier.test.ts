import { describe, expect, it } from "vitest";

import { hashIdentifier } from "../../src/sharing";

describe("hashIdentifier", () => {
  it("is deterministic for identical input", () => {
    const a = hashIdentifier("doctor@example.com");
    const b = hashIdentifier("doctor@example.com");
    expect(a).toBe(b);
  });

  it("is case-sensitive (callers normalize at the boundary)", () => {
    expect(hashIdentifier("DOCTOR@example.com")).not.toBe(
      hashIdentifier("doctor@example.com"),
    );
  });

  it("returns a 64-char SHA-256 hex digest", () => {
    expect(hashIdentifier("x")).toMatch(/^[0-9a-f]{64}$/);
  });
});
