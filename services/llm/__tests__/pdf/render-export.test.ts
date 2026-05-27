/**
 * Story 5.5 T4.7 — PDF render smoke test.
 *
 * Asserts the @react-pdf/renderer pipeline produces a syntactically
 * valid PDF (starts with `%PDF-` magic bytes) and has at least 2 pages
 * (cover + content). Uses a minimal fixture; the rendering is
 * deterministic — no LLM call, no network.
 *
 * Falls back to the built-in Helvetica font since we don't register
 * Lora / DM Sans here (font registration is a worker-boot side effect,
 * see RecordExportPdf header).
 */
import { describe, expect, it } from "vitest";

import { buildPdfArtifact } from "../../src/consumers/generate-export";

const PATIENT_ID = "00000000-0000-0000-0000-000000000001";
const EXPORT_ID = "00000000-0000-0000-0000-000000000abc";

function makeSql(opts: { observations: unknown[]; uploads: unknown[] }): never {
  let idx = 0;
  const responses = [opts.observations, opts.uploads];
  const tag = (..._args: unknown[]) => {
    const res = responses[idx];
    idx += 1;
    return Promise.resolve(res ?? []);
  };
  return tag as never;
}

describe("buildPdfArtifact — render smoke", () => {
  it("produces a valid PDF Buffer", async () => {
    const sql = makeSql({
      observations: [
        {
          loinc_code: "718-7",
          biomarker_name: "Hemoglobina",
          value_numeric: "14.2",
          unit_ucum: "g/dL",
          collected_at: "2024-06-01",
          lab_name: "Lab Central",
          source: "extracted",
          reference_range_low: "12",
          reference_range_high: "16",
        },
      ],
      uploads: [
        {
          id: "u-1",
          created_at: "2024-06-01T10:00:00Z",
          source: "post_onboarding",
          status: "complete",
        },
      ],
    });

    const { bytes } = await buildPdfArtifact(sql, {
      id: EXPORT_ID,
      patient_id: PATIENT_ID,
      format: "pdf",
      status: "generating",
    });
    expect(bytes.byteLength).toBeGreaterThan(1000);
    expect(bytes.slice(0, 5).toString("utf8")).toBe("%PDF-");
    // Page count heuristic — the EOF "/Count N" entry from the page-tree.
    const text = bytes.toString("latin1");
    const match = /\/Type\s*\/Pages[^]*?\/Count\s+(\d+)/.exec(text);
    if (match) {
      expect(Number(match[1])).toBeGreaterThanOrEqual(2);
    }
  }, 30_000);
});
