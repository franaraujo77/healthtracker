/**
 * Story 5.2 review-fix Patch #18 (T8.2) — fake-timer assertion that
 * `computeExpiresAt` (the `createShareToken` duration → expires_at
 * mapping) returns the expected timestamp for each enum value.
 *
 * Locks `now()` so the comparison is exact rather than ±a few ms.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { computeExpiresAt } from "../../src/router/sharing";

const FROZEN = new Date("2026-05-26T12:00:00.000Z");

beforeAll(() => {
  vi.useFakeTimers();
  vi.setSystemTime(FROZEN);
});

afterAll(() => {
  vi.useRealTimers();
});

describe("computeExpiresAt — Story 5.2 duration → expires_at mapping", () => {
  it("24h → now() + 24h", () => {
    expect(computeExpiresAt("24h")).toEqual(
      new Date(FROZEN.getTime() + 24 * 60 * 60 * 1000),
    );
  });

  it("7d → now() + 7 days", () => {
    expect(computeExpiresAt("7d")).toEqual(
      new Date(FROZEN.getTime() + 7 * 24 * 60 * 60 * 1000),
    );
  });

  it("30d → now() + 30 days", () => {
    expect(computeExpiresAt("30d")).toEqual(
      new Date(FROZEN.getTime() + 30 * 24 * 60 * 60 * 1000),
    );
  });

  it("no_expiry → null", () => {
    expect(computeExpiresAt("no_expiry")).toBeNull();
  });
});
