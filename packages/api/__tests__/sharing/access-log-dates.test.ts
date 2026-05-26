/**
 * Story 5.3 T2.2 — boundary tests for `formatRelativeTimePtBr` and
 * `formatAbsolutePtBr`. The validators package doesn't wire a test
 * runner (see `packages/validators/package.json`); this suite lives
 * in the API tests dir so it runs under `pnpm --filter @healthtracker/api
 * test:unit` alongside the other Story 5.3 unit tests.
 */
import { describe, expect, it } from "vitest";

import {
  formatAbsolutePtBr,
  formatRelativeTimePtBr,
} from "@healthtracker/validators";

const NOW = new Date("2026-05-26T14:32:00.000Z");

describe("formatRelativeTimePtBr — bucket boundaries", () => {
  it("returns 'agora' for the same instant", () => {
    expect(formatRelativeTimePtBr(NOW, NOW)).toBe("agora");
  });

  it("returns 'agora' for < 60s", () => {
    const t = new Date(NOW.getTime() - 30_000);
    expect(formatRelativeTimePtBr(t, NOW)).toBe("agora");
  });

  it("flips to 'há 1 min' at exactly 60s", () => {
    const t = new Date(NOW.getTime() - 60_000);
    expect(formatRelativeTimePtBr(t, NOW)).toBe("há 1 min");
  });

  it("returns 'há N min' for < 60m", () => {
    const t = new Date(NOW.getTime() - 30 * 60_000);
    expect(formatRelativeTimePtBr(t, NOW)).toBe("há 30 min");
  });

  it("flips to 'há 1 h' at exactly 60m", () => {
    const t = new Date(NOW.getTime() - 60 * 60_000);
    expect(formatRelativeTimePtBr(t, NOW)).toBe("há 1 h");
  });

  it("returns 'há N h' for < 24h", () => {
    const t = new Date(NOW.getTime() - 5 * 60 * 60_000);
    expect(formatRelativeTimePtBr(t, NOW)).toBe("há 5 h");
  });

  it("flips to 'há 1 dia' at exactly 24h (singular)", () => {
    const t = new Date(NOW.getTime() - 24 * 60 * 60_000);
    expect(formatRelativeTimePtBr(t, NOW)).toBe("há 1 dia");
  });

  it("uses plural 'dias' for N > 1 under the 7d cap", () => {
    const t = new Date(NOW.getTime() - 3 * 24 * 60 * 60_000);
    expect(formatRelativeTimePtBr(t, NOW)).toBe("há 3 dias");
  });

  it("falls through to absolute at exactly 7d", () => {
    const t = new Date(NOW.getTime() - 7 * 24 * 60 * 60_000);
    expect(formatRelativeTimePtBr(t, NOW)).toBe(formatAbsolutePtBr(t));
  });
});

describe("formatAbsolutePtBr", () => {
  it("renders the expected pt-BR long-date shape", () => {
    // Use a local-noon date to dodge timezone drift between CI runners;
    // assert against the shape Intl.DateTimeFormat produces.
    const d = new Date("2026-05-23T17:32:00.000Z");
    const out = formatAbsolutePtBr(d);
    // "23 de maio de 2026 às HH:MM" — month name spelled out, no
    // ordinal "23º", colon-separated time. Allow any timezone-shifted
    // hour:minute pair.
    expect(out).toMatch(/^\d{1,2} de \w+ de \d{4} às \d{2}:\d{2}$/);
  });
});
