/**
 * Story 5.1 — unit coverage for the
 * `configureBiomarkersInputSchema` refine added in Patch #5 (review
 * 2026-05-26). The integration test file
 * (`configure-biomarkers.integration.test.ts`) is excluded from the
 * unit run via `vitest.config.ts`; this file keeps the refine
 * regression in the fast unit suite.
 */
import { describe, expect, it } from "vitest";

import { configureBiomarkersInputSchema } from "@healthtracker/validators";

describe("configureBiomarkersInputSchema — duplicate refine (Patch #5)", () => {
  it("accepts a batch with all-distinct biomarker categories", () => {
    const result = configureBiomarkersInputSchema.safeParse({
      shareTokenId: "11111111-1111-4111-8111-111111111111",
      scope: [
        { biomarkerCategory: "ferritin", visible: true },
        { biomarkerCategory: "hemoglobin", visible: false },
      ],
    });
    expect(result.success).toBe(true);
  });

  it("rejects a batch with duplicate biomarkerCategory", () => {
    const result = configureBiomarkersInputSchema.safeParse({
      shareTokenId: "11111111-1111-4111-8111-111111111111",
      scope: [
        { biomarkerCategory: "ferritin", visible: true },
        { biomarkerCategory: "ferritin", visible: false },
      ],
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const flat = result.error.issues.map((i) => i.message).join(" | ");
      expect(flat).toMatch(/Duplicate biomarkerCategory/);
    }
  });
});
