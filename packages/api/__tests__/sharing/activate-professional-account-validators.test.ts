/**
 * Story 6.3 T8 — Zod coverage for
 * `activateProfessionalAccountInputSchema` and
 * `getActivationStatusOutputSchema`.
 *
 * The browser modal pre-fills the display name and category options
 * from these constants; reviewers reading the constant set MUST match
 * the resolver's enum or the activation surface drifts.
 */
import { describe, expect, it } from "vitest";

import {
  activateProfessionalAccountInputSchema,
  getActivationStatusOutputSchema,
  PROFESSIONAL_CATEGORY_LABEL_PT_BR,
  PROFESSIONAL_CATEGORY_VALUES,
  professionalCategorySchema,
} from "@healthtracker/validators";

const VALID_SHARE_TOKEN_ID = "11111111-1111-4111-8111-111111111111";

describe("activateProfessionalAccountInputSchema — Story 6.3 AC3 / T1.3", () => {
  it.each(PROFESSIONAL_CATEGORY_VALUES)("accepts category=%s", (category) => {
    const result = activateProfessionalAccountInputSchema.safeParse({
      shareTokenId: VALID_SHARE_TOKEN_ID,
      tokenHmac: "abc123",
      displayName: "Dr. R",
      category,
    });
    expect(result.success).toBe(true);
  });

  it("rejects empty displayName (trim → empty)", () => {
    const result = activateProfessionalAccountInputSchema.safeParse({
      shareTokenId: VALID_SHARE_TOKEN_ID,
      tokenHmac: "abc",
      displayName: "   ",
      category: "endocrinologista",
    });
    expect(result.success).toBe(false);
  });

  it("trims displayName whitespace", () => {
    const result = activateProfessionalAccountInputSchema.safeParse({
      shareTokenId: VALID_SHARE_TOKEN_ID,
      tokenHmac: "abc",
      displayName: "  Dr. R  ",
      category: "outro",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.displayName).toBe("Dr. R");
    }
  });

  it("rejects displayName longer than 80 chars", () => {
    const result = activateProfessionalAccountInputSchema.safeParse({
      shareTokenId: VALID_SHARE_TOKEN_ID,
      tokenHmac: "abc",
      displayName: "x".repeat(81),
      category: "nutricionista",
    });
    expect(result.success).toBe(false);
  });

  it("rejects unknown category", () => {
    const result = activateProfessionalAccountInputSchema.safeParse({
      shareTokenId: VALID_SHARE_TOKEN_ID,
      tokenHmac: "abc",
      displayName: "Dr. R",
      category: "fake_category",
    });
    expect(result.success).toBe(false);
  });

  it("rejects malformed shareTokenId", () => {
    const result = activateProfessionalAccountInputSchema.safeParse({
      shareTokenId: "not-a-uuid",
      tokenHmac: "abc",
      displayName: "Dr. R",
      category: "endocrinologista",
    });
    expect(result.success).toBe(false);
  });

  it("rejects empty tokenHmac (no enumeration of bad HMACs)", () => {
    const result = activateProfessionalAccountInputSchema.safeParse({
      shareTokenId: VALID_SHARE_TOKEN_ID,
      tokenHmac: "",
      displayName: "Dr. R",
      category: "endocrinologista",
    });
    expect(result.success).toBe(false);
  });
});

describe("getActivationStatusOutputSchema", () => {
  it("accepts activated:false with nulls", () => {
    const result = getActivationStatusOutputSchema.safeParse({
      activated: false,
      displayName: null,
      category: null,
    });
    expect(result.success).toBe(true);
  });

  it("accepts activated:true with populated fields", () => {
    const result = getActivationStatusOutputSchema.safeParse({
      activated: true,
      displayName: "Dr. R",
      category: "cardiologista",
    });
    expect(result.success).toBe(true);
  });
});

describe("PROFESSIONAL_CATEGORY_LABEL_PT_BR — AC7 closed-set parity", () => {
  it("has exactly one label per enum value", () => {
    const labelKeys = Object.keys(PROFESSIONAL_CATEGORY_LABEL_PT_BR).sort();
    const enumValues = [...PROFESSIONAL_CATEGORY_VALUES].sort();
    expect(labelKeys).toEqual(enumValues);
  });

  it("every label is a non-empty string", () => {
    for (const value of PROFESSIONAL_CATEGORY_VALUES) {
      const label = PROFESSIONAL_CATEGORY_LABEL_PT_BR[value];
      expect(typeof label).toBe("string");
      expect(label.length).toBeGreaterThan(0);
    }
  });

  it("schema parses every enum value", () => {
    for (const value of PROFESSIONAL_CATEGORY_VALUES) {
      expect(professionalCategorySchema.safeParse(value).success).toBe(true);
    }
  });
});
