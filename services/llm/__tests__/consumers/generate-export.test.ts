/**
 * Story 5.5 T4.6 — `generate-export` consumer unit tests.
 *
 * Stubs the `postgres` template-tag client and the Supabase Storage
 * upload surface. Exercises:
 *   - JSON shape matches AC3 (BOM + 2-space indent + required fields)
 *   - state transitions queued → generating → ready
 *   - audit emits both system-actor (`export.generated`) and
 *     patient-actor (`record.exported`) rows
 *   - failure on the LAST attempt persists `failed` + emits
 *     `export.failed` audit
 */
import { describe, expect, it, vi } from "vitest";

import {
  buildJsonArtifact,
  processOne,
} from "../../src/consumers/generate-export";

interface SqlCall {
  type: "query" | "begin";
  strings?: readonly string[];
  values?: unknown[];
  txCalls?: SqlCall[];
}

function makeFakeSql(opts: {
  selectExportRow: () => Promise<unknown[]>;
  selectObservations?: () => Promise<unknown[]>;
  selectUploads?: () => Promise<unknown[]>;
  capture: SqlCall[];
}) {
  // Track which select we're returning based on call order.
  let selectIdx = 0;
  const selects = [
    opts.selectExportRow,
    opts.selectObservations ?? (async () => []),
    opts.selectUploads ?? (async () => []),
  ];

  const tag = (strings: TemplateStringsArray, ...values: unknown[]) => {
    const joined = strings.join(" ").trim().toUpperCase();
    opts.capture.push({ type: "query", strings: [...strings], values });
    if (joined.startsWith("SELECT")) {
      const fn = selects[selectIdx];
      selectIdx += 1;
      return (fn ?? (async () => []))();
    }
    // INSERT / UPDATE — return [] (driver returns rows on RETURNING only).
    return Promise.resolve([]);
  };

  (
    tag as unknown as { begin: (fn: (tx: unknown) => unknown) => unknown }
  ).begin = async (fn: (tx: unknown) => unknown) => {
    const txCalls: SqlCall[] = [];
    opts.capture.push({ type: "begin", txCalls });
    const txTag = (strings: TemplateStringsArray, ...values: unknown[]) => {
      txCalls.push({ type: "query", strings: [...strings], values });
      return Promise.resolve([]);
    };
    return await fn(txTag);
  };

  return tag as unknown as Parameters<typeof processOne>[0]["sql"];
}

function makeFakeSupabase(uploadResult: { error: null | { message: string } }) {
  const uploaded: { path: string; body: unknown; contentType?: string }[] = [];
  return {
    storage: {
      from: () => ({
        upload: async (
          path: string,
          body: unknown,
          opts?: { contentType?: string },
        ) => {
          uploaded.push({ path, body, contentType: opts?.contentType });
          return uploadResult;
        },
      }),
    },
    _uploaded: uploaded,
  } as unknown as Parameters<typeof processOne>[0]["supabase"] & {
    _uploaded: { path: string; body: unknown; contentType?: string }[];
  };
}

const PATIENT_ID = "00000000-0000-0000-0000-000000000001";
const EXPORT_ID = "00000000-0000-0000-0000-000000000abc";

describe("buildJsonArtifact — AC3 shape", () => {
  it("emits UTF-8 BOM + 2-space indent + required fields", async () => {
    const capture: SqlCall[] = [];
    // buildJsonArtifact skips the export-row SELECT (row passed in directly),
    // so the SELECT slots shift: 1st = observations, 2nd = uploads.
    const sql = makeFakeSql({
      capture,
      selectExportRow: async () => [
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
      selectObservations: async () => [
        {
          id: "u-1",
          created_at: "2024-06-01T10:00:00Z",
          source: "post_onboarding",
          status: "complete",
        },
      ],
      selectUploads: async () => [],
    });

    const artifact = await buildJsonArtifact(sql as never, {
      id: EXPORT_ID,
      patient_id: PATIENT_ID,
      format: "json",
      status: "generating",
    });
    const text = artifact.bytes.toString("utf8");
    // BOM is the first character.
    expect(text.charCodeAt(0)).toBe(0xfeff);
    // Pretty-printed with 2-space indent.
    expect(text).toContain('\n  "schemaVersion": "1.0.0",');
    expect(text).toContain('\n  "patient": {');
    // PII hygiene — patient.id is uuid only; no email/displayName.
    expect(text).not.toMatch(/email|displayName/i);
    // All eight required observation fields.
    const parsed = JSON.parse(text.slice(1)) as {
      observations: Record<string, unknown>[];
      lifeEvents: unknown[];
    };
    const obs = parsed.observations[0]!;
    expect(Object.keys(obs).sort()).toEqual(
      [
        "biomarkerName",
        "collectedAt",
        "labName",
        "loincCode",
        "sourceType",
        "unitUcum",
        "valueNumeric",
      ].sort(),
    );
    expect(parsed.lifeEvents).toEqual([]);
  });
});

describe("processOne — state transitions + audit", () => {
  it("queued → generating → ready, emits both audit rows", async () => {
    const capture: SqlCall[] = [];
    const sql = makeFakeSql({
      capture,
      selectExportRow: async () => [
        {
          id: EXPORT_ID,
          patient_id: PATIENT_ID,
          format: "json",
          status: "queued",
        },
      ],
      selectObservations: async () => [],
      selectUploads: async () => [],
    });
    const supabase = makeFakeSupabase({ error: null });

    await processOne({ sql, supabase }, EXPORT_ID, 0);

    // First call is the SELECT export row; second is the queued→generating UPDATE.
    const updateGen = capture.find(
      (c) =>
        c.type === "query" &&
        /SET status = 'generating'/.test(c.strings?.join(" ") ?? ""),
    );
    expect(updateGen).toBeDefined();

    // Supabase upload happened with the patient-prefixed path.
    expect(
      (supabase as unknown as { _uploaded: { path: string }[] })._uploaded[0]
        ?.path,
    ).toBe(`${PATIENT_ID}/${EXPORT_ID}.json`);

    // Final tx contains 1 UPDATE + 2 audit INSERTs.
    const tx = capture.find((c) => c.type === "begin");
    expect(tx?.txCalls?.length).toBe(3);
    const txText = tx?.txCalls?.map((c) => c.strings?.join("")).join("|") ?? "";
    expect(txText).toContain("SET status = 'ready'");
    expect(txText).toMatch(/INSERT INTO audit_log/);
    // Both event kinds present.
    const flattened = (tx?.txCalls ?? [])
      .map((c) => `${c.strings?.join("") ?? ""}::${JSON.stringify(c.values)}`)
      .join("|");
    expect(flattened).toContain("export.generated");
    expect(flattened).toContain("record.exported");
  });

  it("on final-attempt upload failure: persists 'failed' + export.failed audit", async () => {
    const capture: SqlCall[] = [];
    const sql = makeFakeSql({
      capture,
      selectExportRow: async () => [
        {
          id: EXPORT_ID,
          patient_id: PATIENT_ID,
          format: "json",
          status: "queued",
        },
      ],
      selectObservations: async () => [],
      selectUploads: async () => [],
    });
    const supabase = makeFakeSupabase({ error: { message: "fetch failed" } });

    // retrycount = 2 → next attempt is the LAST (retry_limit = 3).
    await processOne({ sql, supabase }, EXPORT_ID, 2);

    const tx = capture.find((c) => c.type === "begin");
    expect(tx).toBeDefined();
    const txText = tx?.txCalls?.map((c) => c.strings?.join("")).join("|") ?? "";
    expect(txText).toContain("SET status = 'failed'");
    const flattened = (tx?.txCalls ?? [])
      .map((c) => `${c.strings?.join("") ?? ""}::${JSON.stringify(c.values)}`)
      .join("|");
    expect(flattened).toContain("export.failed");
  });

  it("skips rows already 'ready' (idempotent retry)", async () => {
    const capture: SqlCall[] = [];
    const sql = makeFakeSql({
      capture,
      selectExportRow: async () => [
        {
          id: EXPORT_ID,
          patient_id: PATIENT_ID,
          format: "json",
          status: "ready",
        },
      ],
    });
    const supabase = makeFakeSupabase({ error: null });
    const consoleSpy = vi
      .spyOn(console, "log")
      .mockImplementation(() => undefined);

    await processOne({ sql, supabase }, EXPORT_ID, 0);

    // No UPDATEs / audit inserts after the SELECT.
    const updates = capture.filter(
      (c) =>
        c.type === "query" && /^\s*UPDATE/i.test(c.strings?.join(" ") ?? ""),
    );
    expect(updates).toHaveLength(0);
    consoleSpy.mockRestore();
  });
});
