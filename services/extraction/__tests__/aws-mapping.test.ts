import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { AnalyzeDocumentCommandOutput } from "@aws-sdk/client-textract";
import { describe, expect, it } from "vitest";

import { CONFIDENCE_GATE_THRESHOLD } from "../src/pipeline/dispatch.js";
import {
  clamp01,
  mapAnalyzeDocumentResponse,
  splitValueUnit,
} from "../src/textract/aws-mapping.js";

/**
 * Story 9.1 — the AWS adapter's only non-trivial logic is the pure
 * `mapAnalyzeDocumentResponse` (block-graph traversal + heuristic field
 * extraction). It is covered here field-by-field against a recorded
 * Textract `AnalyzeDocument` fixture. The SDK network call in
 * `aws-adapter.ts` is a thin wrapper and is deliberately NOT exercised
 * (NFR-S8: no live AWS in CI).
 */

const fixture = JSON.parse(
  readFileSync(
    fileURLToPath(
      new URL("./fixtures/textract-analyze-document.json", import.meta.url),
    ),
    "utf8",
  ),
) as AnalyzeDocumentCommandOutput;

describe("clamp01", () => {
  it.each([
    [0.62, 0.62],
    [1.5, 1],
    [-0.2, 0],
    [Number.NaN, 0],
    [Number.POSITIVE_INFINITY, 0],
  ])("clamps %s -> %s", (input, expected) => {
    expect(clamp01(input)).toBe(expected);
  });
});

describe("splitValueUnit", () => {
  it("splits a Brazilian-decimal value + unit", () => {
    expect(splitValueUnit("14,2 g/dL")).toEqual({
      valueText: "14,2",
      unitText: "g/dL",
    });
  });

  it("preserves a thousands-separated value with no unit", () => {
    expect(splitValueUnit("4.500")).toEqual({
      valueText: "4.500",
      unitText: undefined,
    });
  });

  it("returns null for a non-numeric value", () => {
    expect(splitValueUnit("Positivo")).toBeNull();
  });

  it("does NOT parse the value (keeps the comma raw)", () => {
    const out = splitValueUnit("2,5 uUI/mL");
    expect(out?.valueText).toBe("2,5");
  });
});

describe("mapAnalyzeDocumentResponse", () => {
  const fields = mapAnalyzeDocumentResponse(fixture);
  const byName = new Map(fields.map((f) => [f.biomarkerName, f]));

  it("maps every FORMS pair + every table data row (5 fields, no dupes)", () => {
    expect(fields).toHaveLength(5);
    expect([...byName.keys()].sort()).toEqual([
      "Colesterol",
      "Glicose",
      "Hemoglobina",
      "TSH",
      "Vitamina D",
    ]);
  });

  it("does NOT emit the document-context (date/lab) FORMS keys as biomarkers", () => {
    expect(byName.has("Data da Coleta")).toBe(false);
    expect(byName.has("Laboratório")).toBe(false);
  });

  it("stamps the document-level collection date + lab name onto EVERY field", () => {
    // Load-bearing: without collectedAtText the dispatcher quarantines the
    // field (collectedAt === null → structurallyBad) and never publishes.
    for (const f of fields) {
      expect(f.collectedAtText).toBe("15/03/2024");
      expect(f.labName).toBe("Laboratório Vida");
    }
  });

  it("maps the FORMS key/value pair field-by-field", () => {
    expect(byName.get("Hemoglobina")).toEqual({
      biomarkerName: "Hemoglobina",
      valueText: "14,2",
      unitText: "g/dL",
      confidence: 0.9,
      collectedAtText: "15/03/2024",
      labName: "Laboratório Vida",
    });
  });

  it("maps table 1 rows (Glicose, Colesterol) with the explicit unit column", () => {
    expect(byName.get("Glicose")).toEqual({
      biomarkerName: "Glicose",
      valueText: "99",
      unitText: "mg/dL",
      confidence: 0.95,
      collectedAtText: "15/03/2024",
      labName: "Laboratório Vida",
    });
    expect(byName.get("Colesterol")).toEqual({
      biomarkerName: "Colesterol",
      valueText: "180",
      unitText: "mg/dL",
      confidence: 0.88,
      collectedAtText: "15/03/2024",
      labName: "Laboratório Vida",
    });
  });

  it("maps a SECOND table (multi-table report)", () => {
    expect(byName.get("TSH")).toEqual({
      biomarkerName: "TSH",
      valueText: "2,5",
      unitText: "uUI/mL",
      confidence: 0.91,
      collectedAtText: "15/03/2024",
      labName: "Laboratório Vida",
    });
  });

  it("normalises confidence to [0,1] and routes a low-confidence field to review", () => {
    const vitD = byName.get("Vitamina D");
    expect(vitD).toEqual({
      biomarkerName: "Vitamina D",
      valueText: "22,0",
      unitText: "ng/mL",
      confidence: 0.62,
      collectedAtText: "15/03/2024",
      labName: "Laboratório Vida",
    });
    // 0.62 < 0.85 gate → dispatchExtractedFields routes this to the
    // review queue as `low_confidence`. Use the EXPORTED threshold, never
    // a hard-coded 0.85.
    expect(vitD!.confidence).toBeLessThan(CONFIDENCE_GATE_THRESHOLD);
  });

  it("keeps all confidences in the normalised [0,1] range", () => {
    for (const f of fields) {
      expect(f.confidence).toBeGreaterThanOrEqual(0);
      expect(f.confidence).toBeLessThanOrEqual(1);
    }
  });

  it("returns [] for an empty block list", () => {
    expect(mapAnalyzeDocumentResponse({ Blocks: [] })).toEqual([]);
    expect(mapAnalyzeDocumentResponse({})).toEqual([]);
  });
});

/**
 * Compact inline-block builders for the correctness-patch tests below
 * (kept small + local; the big fixture covers the happy path).
 */
function word(id: string, text: string) {
  return { Id: id, BlockType: "WORD" as const, Text: text, Confidence: 95 };
}
function cell(id: string, row: number, col: number, wordId: string) {
  return {
    Id: id,
    BlockType: "CELL" as const,
    RowIndex: row,
    ColumnIndex: col,
    Confidence: 95,
    Relationships: [{ Type: "CHILD" as const, Ids: [wordId] }],
  };
}

describe("mapAnalyzeDocumentResponse — correctness patches", () => {
  it("does NOT pick a reference-range column as the value column", () => {
    // Header: [Exame, Resultado, Valor de Referência]. The reference column
    // is numeric ("70 - 99") and "Valor de referência" contains "valor",
    // so a naive value-column pick would grab it. It must not.
    const blocks = [
      cell("h1", 1, 1, "wh1"),
      word("wh1", "Exame"),
      cell("h2", 1, 2, "wh2"),
      word("wh2", "Resultado"),
      cell("h3", 1, 3, "wh3"),
      word("wh3", "Valor de Referência"),
      cell("d1", 2, 1, "wd1"),
      word("wd1", "Glicose"),
      cell("d2", 2, 2, "wd2"),
      word("wd2", "99"),
      cell("d3", 2, 3, "wd3"),
      word("wd3", "70 - 99"),
      {
        Id: "tbl",
        BlockType: "TABLE" as const,
        Confidence: 95,
        Relationships: [
          { Type: "CHILD" as const, Ids: ["h1", "h2", "h3", "d1", "d2", "d3"] },
        ],
      },
    ];
    const out = mapAnalyzeDocumentResponse({ Blocks: blocks });
    expect(out).toHaveLength(1);
    expect(out[0]?.biomarkerName).toBe("Glicose");
    expect(out[0]?.valueText).toBe("99"); // the result, NOT "70" from the range
  });

  it("keeps distinct same-name measurements (dedup is by name + value)", () => {
    // Same biomarker, two different values (e.g. two draws on one report).
    // Name-only dedup would drop one; name+value keeps both.
    const blocks = [
      cell("h1", 1, 1, "wh1"),
      word("wh1", "Exame"),
      cell("h2", 1, 2, "wh2"),
      word("wh2", "Resultado"),
      cell("d1", 2, 1, "wd1"),
      word("wd1", "Glicose"),
      cell("d2", 2, 2, "wd2"),
      word("wd2", "99"),
      cell("e1", 3, 1, "we1"),
      word("we1", "Glicose"),
      cell("e2", 3, 2, "we2"),
      word("we2", "140"),
      {
        Id: "tbl",
        BlockType: "TABLE" as const,
        Confidence: 95,
        Relationships: [
          {
            Type: "CHILD" as const,
            Ids: ["h1", "h2", "d1", "d2", "e1", "e2"],
          },
        ],
      },
    ];
    const out = mapAnalyzeDocumentResponse({ Blocks: blocks });
    expect(out).toHaveLength(2);
    expect(out.map((f) => f.valueText).sort()).toEqual(["140", "99"]);
  });
});
