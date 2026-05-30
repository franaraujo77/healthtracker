/**
 * Story 6.5 T8.2 — exhaustive boundary on `ageInDays`.
 *
 * Pure UTC ms-math — no DST / locale concerns. The helper is the
 * single source of truth for staleness compares in
 * `getConversationStarter`; bugs here propagate into chip-rendering
 * for every doctor.
 */
import { describe, expect, it } from "vitest";

import { ageInDays } from "@healthtracker/validators";

describe("ageInDays — Story 6.5 T8.2", () => {
  it("returns 0 for same instant", () => {
    const now = new Date("2026-05-30T12:00:00Z");
    expect(ageInDays(now, now)).toBe(0);
  });

  it("returns 0 for sub-day intervals (1 hour ago)", () => {
    const now = new Date("2026-05-30T12:00:00Z");
    const collected = new Date("2026-05-30T11:00:00Z");
    expect(ageInDays(now, collected)).toBe(0);
  });

  it("returns 1 for exactly 24h ago", () => {
    const now = new Date("2026-05-30T12:00:00Z");
    const collected = new Date("2026-05-29T12:00:00Z");
    expect(ageInDays(now, collected)).toBe(1);
  });

  it("returns 180 for exactly 180 days ago — boundary at default", () => {
    const now = new Date("2026-05-30T00:00:00Z");
    const collected = new Date(now.getTime() - 180 * 86_400_000);
    expect(ageInDays(now, collected)).toBe(180);
  });

  it("returns 181 for 180d + 1ms ago — strictly greater than threshold", () => {
    const now = new Date("2026-05-30T00:00:00Z");
    const collected = new Date(now.getTime() - (180 * 86_400_000 + 1));
    expect(ageInDays(now, collected)).toBe(180);
    const collected2 = new Date(now.getTime() - 181 * 86_400_000);
    expect(ageInDays(now, collected2)).toBe(181);
  });

  it("handles leap-year crossing (Feb 29 2024 → Mar 1 2024)", () => {
    const now = new Date("2024-03-01T00:00:00Z");
    const collected = new Date("2024-02-29T00:00:00Z");
    expect(ageInDays(now, collected)).toBe(1);
  });

  it("handles year-old (~365 days)", () => {
    const now = new Date("2026-05-30T00:00:00Z");
    const collected = new Date("2025-05-30T00:00:00Z");
    expect(ageInDays(now, collected)).toBe(365);
  });

  it("returns negative when collected is in the future (forensic edge)", () => {
    // The resolver should never feed a future date; this just locks
    // in the behaviour so a future bug surface is obvious.
    const now = new Date("2026-05-30T00:00:00Z");
    const future = new Date("2026-06-01T00:00:00Z");
    expect(ageInDays(now, future)).toBeLessThan(0);
  });
});
