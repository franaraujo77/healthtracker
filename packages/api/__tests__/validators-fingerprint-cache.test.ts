import { describe, expect, it } from "vitest";

import {
  FINGERPRINT_CACHE_FRESH_A11Y_PT_BR,
  FINGERPRINT_CACHE_STALE_A11Y_PT_BR,
  FINGERPRINT_CACHE_STALE_HINT_PT_BR,
  FINGERPRINT_CACHE_STALE_THRESHOLD_MS,
  FINGERPRINT_CACHE_UPDATED_AT_PREFIX_PT_BR,
  formatCachedUpdatedAtPtBr,
  INICIO_OFFLINE_UPLOAD_DISABLED_PT_BR,
  UNKNOWN_DATE_PT_BR,
} from "@healthtracker/validators";

/**
 * Story 3.4 — pure-function tests for the validators surface added
 * for the offline-cached Fingerprint. Lives in `@healthtracker/api`
 * because the validators package has no Vitest config (same rationale
 * as `validators-pdf-helpers.test.ts`).
 */

describe("FINGERPRINT_CACHE_STALE_THRESHOLD_MS", () => {
  it("equals 24 hours in milliseconds", () => {
    expect(FINGERPRINT_CACHE_STALE_THRESHOLD_MS).toBe(86_400_000);
  });
});

describe("FINGERPRINT_CACHE_UPDATED_AT_PREFIX_PT_BR", () => {
  it("matches the AC1 wording exactly", () => {
    expect(FINGERPRINT_CACHE_UPDATED_AT_PREFIX_PT_BR).toBe(
      "Última atualização: ",
    );
  });
});

describe("FINGERPRINT_CACHE_STALE_HINT_PT_BR", () => {
  it("matches the AC3 subtext exactly", () => {
    expect(FINGERPRINT_CACHE_STALE_HINT_PT_BR).toBe(
      "Pode não refletir seu exame mais recente.",
    );
  });
});

describe("INICIO_OFFLINE_UPLOAD_DISABLED_PT_BR", () => {
  it("matches the AC2 toast/hint wording exactly", () => {
    expect(INICIO_OFFLINE_UPLOAD_DISABLED_PT_BR).toBe(
      "Conecte-se à internet para enviar um novo exame.",
    );
  });
});

describe("FINGERPRINT_CACHE_FRESH_A11Y_PT_BR", () => {
  it("renders the fresh-state a11y label", () => {
    expect(FINGERPRINT_CACHE_FRESH_A11Y_PT_BR("23/05/2026 14:30")).toBe(
      "Última atualização em 23/05/2026 14:30.",
    );
  });
});

describe("FINGERPRINT_CACHE_STALE_A11Y_PT_BR", () => {
  it("renders the stale-state a11y label naming the 24h threshold", () => {
    expect(FINGERPRINT_CACHE_STALE_A11Y_PT_BR("21/05/2026 09:00")).toBe(
      "Última atualização em 21/05/2026 09:00. Há mais de 24 horas. Pode não refletir seu exame mais recente.",
    );
  });
});

describe("formatCachedUpdatedAtPtBr", () => {
  // Use a fixed UTC epoch and verify against the platform's actual
  // `toLocaleString('pt-BR', ...)` output so the test stays portable
  // across timezones / CI runners (CI may not be in America/Sao_Paulo).
  it("renders DD/MM/AAAA HH:mm in 24-hour clock", () => {
    const epochMs = Date.UTC(2026, 4, 23, 17, 30);
    const formatted = formatCachedUpdatedAtPtBr(epochMs);
    const expected = new Date(epochMs).toLocaleString("pt-BR", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
    expect(formatted).toBe(expected);
    // Sanity: regex assertion — DD/MM/YYYY HH:mm (24h, two-digit fields).
    expect(formatted).toMatch(/^\d{2}\/\d{2}\/\d{4},? \d{2}:\d{2}$/);
  });

  it("returns the i18n placeholder for non-positive / non-finite inputs", () => {
    expect(formatCachedUpdatedAtPtBr(0)).toBe(UNKNOWN_DATE_PT_BR);
    expect(formatCachedUpdatedAtPtBr(-1)).toBe(UNKNOWN_DATE_PT_BR);
    expect(formatCachedUpdatedAtPtBr(Number.NaN)).toBe(UNKNOWN_DATE_PT_BR);
    expect(formatCachedUpdatedAtPtBr(Number.POSITIVE_INFINITY)).toBe(
      UNKNOWN_DATE_PT_BR,
    );
  });
});
