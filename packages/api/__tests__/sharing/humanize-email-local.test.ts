/**
 * Story 6.1 T6.3 — unit coverage for `humanizeEmailLocal`.
 *
 * Pure-string transformation. Bench cases from the spec:
 *   - `francis.araujo@x.com` → "Francis Araujo"
 *   - `f@x.com`              → "F"
 *   - `@x.com`               → null
 *   - empty string           → null
 *   - `f__o-bar.baz@x`       → "F O Bar Baz"
 */
import { describe, expect, it } from "vitest";

import { humanizeEmailLocal } from "../../src/sharing";

describe("humanizeEmailLocal — Story 6.1 T6.3 / AC4", () => {
  it("title-cases a dot-separated local part", () => {
    expect(humanizeEmailLocal("francis.araujo@x.com")).toBe("Francis Araujo");
  });

  it("uppercases a single-letter local part", () => {
    expect(humanizeEmailLocal("f@x.com")).toBe("F");
  });

  it("returns null when the local part is empty", () => {
    expect(humanizeEmailLocal("@x.com")).toBeNull();
  });

  it("returns null for an empty input", () => {
    expect(humanizeEmailLocal("")).toBeNull();
  });

  it("collapses mixed separators (._-) into spaces", () => {
    expect(humanizeEmailLocal("f__o-bar.baz@x")).toBe("F O Bar Baz");
  });

  it("handles a local part with no `@` at all", () => {
    expect(humanizeEmailLocal("just-a-name")).toBe("Just A Name");
  });

  it("returns null for separators-only", () => {
    expect(humanizeEmailLocal("...___---@x.com")).toBeNull();
  });

  it("lowercases SHOUTING input before title-casing", () => {
    expect(humanizeEmailLocal("FRANCIS.ARAUJO@x.com")).toBe("Francis Araujo");
  });
});
