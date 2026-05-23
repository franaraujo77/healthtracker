import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";

import {
  countPdfPages,
  EXTRACTION_PULSE_COPY_0_10S_PT_BR,
  EXTRACTION_PULSE_COPY_10_20S_PT_BR,
  EXTRACTION_PULSE_COPY_20_30S_PT_BR,
  EXTRACTION_PULSE_COPY_30S_PLUS_PT_BR,
  extractionPulseCopyForElapsedMs,
  extractionPulseShouldShowManualEntry,
  isUploadSource,
} from "@healthtracker/validators";

/**
 * Story 2.1 — pure-function helpers from `@healthtracker/validators`.
 * Tests live here because the validators package has no Vitest config
 * (and adding one for this story is out of proportion to the cost).
 */

async function buildPdfWithPages(pages: number): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pages; i += 1) {
    doc.addPage();
  }
  return doc.save();
}

describe("countPdfPages", () => {
  it("returns 1 for a single-page PDF", async () => {
    const bytes = await buildPdfWithPages(1);
    await expect(countPdfPages(bytes)).resolves.toBe(1);
  });

  it("returns 11 for an 11-page PDF (one past the cap)", async () => {
    const bytes = await buildPdfWithPages(11);
    await expect(countPdfPages(bytes)).resolves.toBe(11);
  });

  it("accepts an ArrayBuffer as well as a Uint8Array", async () => {
    const bytes = await buildPdfWithPages(3);
    const ab = bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength,
    );
    await expect(countPdfPages(ab as ArrayBuffer)).resolves.toBe(3);
  });
});

describe("extractionPulseCopyForElapsedMs", () => {
  it("returns the 0–10s copy at t=0", () => {
    expect(extractionPulseCopyForElapsedMs(0)).toBe(
      EXTRACTION_PULSE_COPY_0_10S_PT_BR,
    );
  });
  it("returns the 0–10s copy just under 10s", () => {
    expect(extractionPulseCopyForElapsedMs(9_999)).toBe(
      EXTRACTION_PULSE_COPY_0_10S_PT_BR,
    );
  });
  it("returns the 10–20s copy at exactly 10s", () => {
    expect(extractionPulseCopyForElapsedMs(10_000)).toBe(
      EXTRACTION_PULSE_COPY_10_20S_PT_BR,
    );
  });
  it("returns the 20–30s copy at exactly 20s", () => {
    expect(extractionPulseCopyForElapsedMs(20_000)).toBe(
      EXTRACTION_PULSE_COPY_20_30S_PT_BR,
    );
  });
  it("returns the 30s+ copy at exactly 30s", () => {
    expect(extractionPulseCopyForElapsedMs(30_000)).toBe(
      EXTRACTION_PULSE_COPY_30S_PLUS_PT_BR,
    );
  });
  it("returns the 30s+ copy beyond 30s", () => {
    expect(extractionPulseCopyForElapsedMs(120_000)).toBe(
      EXTRACTION_PULSE_COPY_30S_PLUS_PT_BR,
    );
  });
});

describe("extractionPulseShouldShowManualEntry", () => {
  it("is false before 30s", () => {
    expect(extractionPulseShouldShowManualEntry(29_999)).toBe(false);
  });
  it("is true at exactly 30s", () => {
    expect(extractionPulseShouldShowManualEntry(30_000)).toBe(true);
  });
});

describe("isUploadSource", () => {
  it("accepts the two declared sources", () => {
    expect(isUploadSource("onboarding_import")).toBe(true);
    expect(isUploadSource("post_onboarding")).toBe(true);
  });
  it("rejects anything else", () => {
    expect(isUploadSource("")).toBe(false);
    expect(isUploadSource("system")).toBe(false);
    expect(isUploadSource("ONBOARDING_IMPORT")).toBe(false);
  });
});
