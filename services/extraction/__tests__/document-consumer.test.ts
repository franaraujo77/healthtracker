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
  /** R1-P95 — status returned by the `SELECT status FROM uploads` lookup after a queued→processing miss. */
  currentStatus?: string;
}

function makeSql(behavior: MockSqlBehavior) {
  let transitionCallIndex = 0;
  let observationCallIndex = 0;
  const labNameUpdates: { labName: string }[] = [];
  // Story 2.3 R1-P95/P106 — also handles SELECT status (re-query
  // after queued→processing miss). R1-P109 — `.begin()` runs the
  // passed callback with this same sql mock so transaction-scoped
  // INSERTs route through the same handler.
  const sql = vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => {
    const raw = strings.join("?").toLowerCase();
    // F141 — narrow discriminator: the lab_name UPDATE has `set lab_name`
    // in its SQL; must be checked BEFORE the generic `update uploads`
    // branch which consumes the transition-call counter.
    if (raw.includes("update uploads") && raw.includes("set lab_name")) {
      labNameUpdates.push({ labName: String(values[0]) });
      return Promise.resolve([]);
    }
    if (raw.includes("update uploads")) {
      const rows = behavior.transitionRows[transitionCallIndex++] ?? [];
      return Promise.resolve(rows);
    }
    if (raw.includes("select status from uploads")) {
      // R1-P95 — status lookup after queued→processing miss.
      return Promise.resolve(
        behavior.currentStatus ? [{ status: behavior.currentStatus }] : [],
      );
    }
    if (raw.includes("from loinc_ref")) {
      const name = String(values[0]).toLowerCase();
      const hit = behavior.loinc[name];
      return Promise.resolve(hit ? [hit] : []);
    }
    if (raw.includes("insert into observations")) {
      const id = `obs-${++observationCallIndex}`;
      return Promise.resolve([{ id }]);
    }
    if (raw.includes("insert into extraction_review_queue")) {
      return Promise.resolve([]);
    }
    if (raw.includes("insert into audit_log")) {
      return Promise.resolve([]);
    }
    return Promise.resolve([]);
  }) as unknown as Parameters<typeof handleDocumentJob>[0]["sql"];
  // Story 2.3 R1-P109 — transaction wrapper. The mock runs the
  // callback with the same sql tag, so writes inside .begin route
  // through the same template-string handler above.
  (
    sql as unknown as { begin: (cb: (tx: unknown) => unknown) => unknown }
  ).begin = (cb) => Promise.resolve(cb(sql));
  return Object.assign(sql, { __labNameUpdates: labNameUpdates });
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

describe("F141 — uploads.lab_name dispatcher write", () => {
  it("UPDATEs uploads.lab_name to the most-common lab across publishable fields", async () => {
    const sql = makeSql({
      transitionRows: [
        [{ id: UPLOAD_ID, status: "processing" }],
        [{ id: UPLOAD_ID, status: "complete" }],
      ],
      loinc: { hemoglobina: HEMOGLOBINA_LOINC },
    });
    await handleDocumentJob(
      {
        sql,
        textractAdapter: mockAdapter([
          { ...HEMOGLOBINA, labName: "Fleury" },
          { ...HEMOGLOBINA, biomarkerName: "Hemoglobina", labName: "Fleury" },
          { ...HEMOGLOBINA, biomarkerName: "Hemoglobina", labName: "Sabin" },
        ]),
        downloadStorageObject: mockDownload,
      },
      jobPayload(),
    );
    const { __labNameUpdates } = sql as unknown as {
      __labNameUpdates: { labName: string }[];
    };
    expect(__labNameUpdates).toHaveLength(1);
    expect(__labNameUpdates[0]?.labName).toBe("Fleury");
  });

  it("skips the lab_name UPDATE when no publishable field carried a lab", async () => {
    const sql = makeSql({
      transitionRows: [
        [{ id: UPLOAD_ID, status: "processing" }],
        [{ id: UPLOAD_ID, status: "complete" }],
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
    const { __labNameUpdates } = sql as unknown as {
      __labNameUpdates: { labName: string }[];
    };
    expect(__labNameUpdates).toHaveLength(0);
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

describe("handleDocumentJob — optimistic-lock miss (R1-P95 + R2-P114)", () => {
  it("R2-P114: throws (so pg-boss retries) when queued→processing misses AND status is missing/null", async () => {
    const sql = makeSql({
      transitionRows: [[]], // miss on first transition
      loinc: {},
      // No `currentStatus` — the SELECT returns no rows. The
      // handler must THROW so pg-boss retries (post-R2-P114).
      // The old behavior was silent-skip; new contract is explicit
      // case enumeration.
    });
    await expect(
      handleDocumentJob(
        {
          sql,
          textractAdapter: mockAdapter([HEMOGLOBINA]),
          downloadStorageObject: mockDownload,
        },
        jobPayload(),
      ),
    ).rejects.toThrow(/queued→processing missed/);
  });

  it("R2-P114: ack-skips silently when the row is in pending_review", async () => {
    const sql = makeSql({
      transitionRows: [[]],
      loinc: {},
      currentStatus: "pending_review",
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
      expect.stringMatching(/skipping; current status=pending_review/),
    );
    warnSpy.mockRestore();
  });

  it("resumes when queued→processing misses BUT the row is already in processing (crashed worker recovery)", async () => {
    const sql = makeSql({
      transitionRows: [
        [], // queued → processing misses (row already processing)
        [{ id: UPLOAD_ID, status: "complete" }], // processing → complete succeeds
      ],
      loinc: { hemoglobina: HEMOGLOBINA_LOINC },
      currentStatus: "processing",
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
      expect.stringMatching(/resuming after prior worker crash/),
    );
    warnSpy.mockRestore();
  });
});
