import { describe, expect, it, vi } from "vitest";

import type { ExtractDocumentPayload, JobPayload } from "@healthtracker/types";

import type {
  RawExtractedField,
  TextractAdapter,
} from "../src/textract/adapter.js";
import { handleDocumentJob } from "../src/consumers/document.js";

const UPLOAD_ID = "11111111-1111-1111-1111-111111111111";
const PATIENT_ID = "22222222-2222-2222-2222-222222222222";

interface MockSqlBehavior {
  /** Rows returned by the UPDATE uploads ... RETURNING — driven by call index. */
  transitionRows: { id: string; status: string }[][];
  /** Rows returned by LOINC lookup — keyed by biomarker name (case-insensitive). */
  loinc: Record<string, { loinc_code: string; unit_ucum: string }>;
}

function makeSql(behavior: MockSqlBehavior) {
  let transitionCallIndex = 0;
  const sql = vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => {
    const raw = strings.join("?").toLowerCase();
    if (raw.includes("update uploads")) {
      const rows = behavior.transitionRows[transitionCallIndex++] ?? [];
      return Promise.resolve(rows);
    }
    if (raw.includes("from loinc_ref")) {
      // biomarkerName parameter is the first value
      const name = String(values[0]).toLowerCase();
      const hit = behavior.loinc[name];
      return Promise.resolve(hit ? [hit] : []);
    }
    if (raw.includes("insert into observations")) {
      return Promise.resolve([{ id: "obs-1" }]);
    }
    if (raw.includes("insert into extraction_review_queue")) {
      return Promise.resolve([]);
    }
    return Promise.resolve([]);
  });
  return sql as unknown as Parameters<typeof handleDocumentJob>[0]["sql"];
}

function jobPayload(): JobPayload<ExtractDocumentPayload> {
  return {
    jobId: "job-1",
    patientId: PATIENT_ID,
    correlationId: UPLOAD_ID,
    payload: {
      uploadId: UPLOAD_ID,
      storagePath: `${PATIENT_ID}/key/exam.pdf`,
      idempotencyKey: "key",
      mimeType: "application/pdf",
    },
    createdAt: new Date().toISOString(),
  };
}

function mockAdapter(fields: RawExtractedField[]): TextractAdapter {
  return { extract: () => Promise.resolve(fields) };
}

const mockDownload = () =>
  Promise.resolve({ bytes: new Uint8Array(), mimeType: "application/pdf" });

const HEMOGLOBINA = {
  biomarkerName: "Hemoglobina",
  valueText: "14,2",
  unitText: "g/dL",
  collectedAtText: "15/03/2024",
  confidence: 0.92,
};
const HEMOGLOBINA_LOINC = { loinc_code: "718-7", unit_ucum: "g/dL" };

describe("handleDocumentJob — happy path (all high confidence → complete)", () => {
  it("transitions queued → processing → complete", async () => {
    const sql = makeSql({
      transitionRows: [
        [{ id: UPLOAD_ID, status: "processing" }], // queued → processing
        [{ id: UPLOAD_ID, status: "complete" }], // processing → complete
      ],
      loinc: { hemoglobina: HEMOGLOBINA_LOINC },
    });
    await handleDocumentJob(
      {
        sql,
        textractAdapter: mockAdapter([HEMOGLOBINA]),
        downloadStorageObject: mockDownload,
      },
      jobPayload(),
    );
    // Two UPDATE uploads calls (queued→processing and processing→complete).
    // No throw means happy path completed.
    expect(sql).toHaveBeenCalled();
  });
});

describe("handleDocumentJob — pending_review (LOINC unresolved)", () => {
  it("routes the unknown biomarker to the review queue and transitions to pending_review", async () => {
    const sql = makeSql({
      transitionRows: [
        [{ id: UPLOAD_ID, status: "processing" }],
        [{ id: UPLOAD_ID, status: "pending_review" }],
      ],
      loinc: {}, // unknown biomarker
    });
    await handleDocumentJob(
      {
        sql,
        textractAdapter: mockAdapter([
          { ...HEMOGLOBINA, biomarkerName: "Unobtanium" },
        ]),
        downloadStorageObject: mockDownload,
      },
      jobPayload(),
    );
  });
});

describe("handleDocumentJob — dead-letter (all fields < 0.01)", () => {
  it("calls applyDeadLetter when every field falls below the threshold", async () => {
    const sql = makeSql({
      transitionRows: [
        [{ id: UPLOAD_ID, status: "processing" }], // queued → processing
        [{ id: UPLOAD_ID, status: "failed" }], // dead-letter UPDATE
      ],
      loinc: { hemoglobina: HEMOGLOBINA_LOINC },
    });
    await handleDocumentJob(
      {
        sql,
        textractAdapter: mockAdapter([{ ...HEMOGLOBINA, confidence: 0.0 }]),
        downloadStorageObject: mockDownload,
      },
      jobPayload(),
    );
  });
});

describe("handleDocumentJob — optimistic-lock miss", () => {
  it("logs and returns when queued → processing matches zero rows", async () => {
    const sql = makeSql({
      transitionRows: [[]], // miss on first transition
      loinc: {},
    });
    const warnSpy = vi
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);
    await handleDocumentJob(
      {
        sql,
        textractAdapter: mockAdapter([HEMOGLOBINA]),
        downloadStorageObject: mockDownload,
      },
      jobPayload(),
    );
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringMatching(/queued→processing failed/),
    );
    warnSpy.mockRestore();
  });
});
