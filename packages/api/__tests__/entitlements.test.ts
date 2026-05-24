import { describe, expect, it } from "vitest";

import { isPremium } from "../src/middleware/entitlements";

describe("isPremium", () => {
  it("returns true when app_metadata.subscriptionTier === 'premium'", () => {
    expect(isPremium({ app_metadata: { subscriptionTier: "premium" } })).toBe(
      true,
    );
  });

  it("returns false for free / missing / undefined tiers", () => {
    expect(isPremium({ app_metadata: { subscriptionTier: "free" } })).toBe(
      false,
    );
    expect(isPremium({ app_metadata: {} })).toBe(false);
    expect(isPremium({})).toBe(false);
    expect(isPremium(null)).toBe(false);
    expect(isPremium(undefined)).toBe(false);
  });

  it("is strict on the literal — 'Premium' (capitalised) is not premium", () => {
    expect(isPremium({ app_metadata: { subscriptionTier: "Premium" } })).toBe(
      false,
    );
  });
});
