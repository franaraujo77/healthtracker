/**
 * Story 6.5 T8.1 — Zod boundary tests for
 * `updateStalenessThresholdsInputSchema`.
 */
import { describe, expect, it } from "vitest";

import {
  biomarkerCategoryLabelPtBr,
  STALENESS_DEFAULT_DAYS,
  STALENESS_THRESHOLD_MAX_DAYS,
  STALENESS_THRESHOLD_MIN_DAYS,
  STALENESS_THRESHOLDS_MAX_ENTRIES,
  updateStalenessThresholdsInputSchema,
} from "@healthtracker/validators";

describe("updateStalenessThresholdsInputSchema — Story 6.5 T8.1", () => {
  it("accepts empty array (no-op semantics)", () => {
    expect(() =>
      updateStalenessThresholdsInputSchema.parse({ thresholds: [] }),
    ).not.toThrow();
  });

  it("accepts a single valid entry", () => {
    expect(() =>
      updateStalenessThresholdsInputSchema.parse({
        thresholds: [{ biomarkerCategory: "lipid_panel", thresholdDays: 90 }],
      }),
    ).not.toThrow();
  });

  it("rejects thresholdDays at the min - 1 boundary (0)", () => {
    expect(() =>
      updateStalenessThresholdsInputSchema.parse({
        thresholds: [
          {
            biomarkerCategory: "lipid_panel",
            thresholdDays: STALENESS_THRESHOLD_MIN_DAYS - 1,
          },
        ],
      }),
    ).toThrow();
  });

  it("accepts thresholdDays at the min and max boundaries", () => {
    expect(() =>
      updateStalenessThresholdsInputSchema.parse({
        thresholds: [
          {
            biomarkerCategory: "lipid_panel",
            thresholdDays: STALENESS_THRESHOLD_MIN_DAYS,
          },
          {
            biomarkerCategory: "thyroid",
            thresholdDays: STALENESS_THRESHOLD_MAX_DAYS,
          },
        ],
      }),
    ).not.toThrow();
  });

  it("rejects thresholdDays above max", () => {
    expect(() =>
      updateStalenessThresholdsInputSchema.parse({
        thresholds: [
          {
            biomarkerCategory: "lipid_panel",
            thresholdDays: STALENESS_THRESHOLD_MAX_DAYS + 1,
          },
        ],
      }),
    ).toThrow();
  });

  it("rejects non-integer thresholdDays", () => {
    expect(() =>
      updateStalenessThresholdsInputSchema.parse({
        thresholds: [{ biomarkerCategory: "lipid_panel", thresholdDays: 30.5 }],
      }),
    ).toThrow();
  });

  it("rejects empty biomarkerCategory string", () => {
    expect(() =>
      updateStalenessThresholdsInputSchema.parse({
        thresholds: [{ biomarkerCategory: "  ", thresholdDays: 30 }],
      }),
    ).toThrow();
  });

  it("rejects duplicate categories via refine", () => {
    expect(() =>
      updateStalenessThresholdsInputSchema.parse({
        thresholds: [
          { biomarkerCategory: "lipid_panel", thresholdDays: 30 },
          { biomarkerCategory: "lipid_panel", thresholdDays: 60 },
        ],
      }),
    ).toThrow();
  });

  it("rejects arrays beyond the cap", () => {
    const tooMany = Array.from(
      { length: STALENESS_THRESHOLDS_MAX_ENTRIES + 1 },
      (_, i) => ({
        biomarkerCategory: `cat_${i}`,
        thresholdDays: 30,
      }),
    );
    expect(() =>
      updateStalenessThresholdsInputSchema.parse({ thresholds: tooMany }),
    ).toThrow();
  });
});

describe("biomarkerCategoryLabelPtBr — Story 6.5 AC2 fallback", () => {
  it("returns pt-BR label for a known category", () => {
    expect(biomarkerCategoryLabelPtBr("lipid_panel")).toBe("Lipídios");
    expect(biomarkerCategoryLabelPtBr("thyroid")).toBe("Tireoide");
    expect(biomarkerCategoryLabelPtBr("iron")).toBe("Ferro");
  });

  it("falls back to the raw category for an unknown one", () => {
    expect(biomarkerCategoryLabelPtBr("future_seed_added")).toBe(
      "future_seed_added",
    );
  });

  it("exports the system default constant for the AC1 hint", () => {
    expect(STALENESS_DEFAULT_DAYS).toBe(180);
  });
});
