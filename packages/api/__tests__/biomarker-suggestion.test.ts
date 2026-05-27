import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AuditDb } from "../src/audit";
import { generateBiomarkerSuggestion } from "../src/letters";

const PATIENT_ID = "55555555-5555-5555-5555-555555555555";
const SUPABASE_ACCESS_TOKEN = "test-jwt";

interface MockDb {
  db: AuditDb;
  insertFn: ReturnType<typeof vi.fn>;
  auditValues: ReturnType<typeof vi.fn>;
}

function makeDb(): MockDb {
  const auditValues = vi.fn(() => Promise.resolve(undefined));
  const insertFn = vi.fn(() => ({ values: auditValues }));
  return {
    db: { insert: insertFn } as unknown as AuditDb,
    insertFn,
    auditValues,
  };
}

const originalFetch = globalThis.fetch;
const originalLlmUrl = process.env.LLM_SERVICE_URL;

beforeEach(() => {
  process.env.LLM_SERVICE_URL = "http://test.invalid";
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  process.env.LLM_SERVICE_URL = originalLlmUrl;
  vi.restoreAllMocks();
});

describe("generateBiomarkerSuggestion", () => {
  it("returns the suggestion + writes a biomarker_suggestion.generated audit on 200", async () => {
    const { db, insertFn, auditValues } = makeDb();
    globalThis.fetch = vi.fn(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            suggestion: "Pode valer a pena discutir esse resultado?",
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      ),
    );
    const out = await generateBiomarkerSuggestion(db, {
      patientId: PATIENT_ID,
      supabaseAccessToken: SUPABASE_ACCESS_TOKEN,
      input: {
        biomarkerName: "Ferritina",
        value: 47,
        unitUcum: "ng/mL",
        loincCode: "2276-4",
      },
    });
    expect(out).toEqual({
      suggestion: "Pode valer a pena discutir esse resultado?",
    });
    expect(insertFn).toHaveBeenCalledOnce();
    const auditPayload = auditValues.mock.calls[0]?.[0] as
      | Record<string, unknown>
      | undefined;
    expect(auditPayload).toMatchObject({
      actorId: PATIENT_ID,
      actorType: "patient",
      event: "biomarker_suggestion.generated",
      resourceType: "biomarker_suggestion",
      metadata: { loincCode: "2276-4", biomarkerName: "Ferritina" },
    });
  });

  it("forwards the Supabase access_token as Bearer auth to services/llm", async () => {
    const { db } = makeDb();
    const fetchSpy = vi.fn((_url: unknown, _init?: RequestInit) =>
      Promise.resolve(
        new Response(JSON.stringify({ suggestion: "ok?" }), { status: 200 }),
      ),
    );
    globalThis.fetch = fetchSpy;
    await generateBiomarkerSuggestion(db, {
      patientId: PATIENT_ID,
      supabaseAccessToken: SUPABASE_ACCESS_TOKEN,
      input: {
        biomarkerName: "x",
        value: 1,
        unitUcum: "u",
        loincCode: null,
      },
    });
    const call = fetchSpy.mock.calls[0];
    const init = call?.[1];
    const headers = (init?.headers ?? {}) as Record<string, string>;
    expect(headers.Authorization).toBe(`Bearer ${SUPABASE_ACCESS_TOKEN}`);
  });

  it("translates a 429 cooldown into TRPC TOO_MANY_REQUESTS without writing audit", async () => {
    const { db, insertFn } = makeDb();
    globalThis.fetch = vi.fn(() =>
      Promise.resolve(
        new Response(JSON.stringify({ code: "COOLDOWN" }), { status: 429 }),
      ),
    );
    await expect(
      generateBiomarkerSuggestion(db, {
        patientId: PATIENT_ID,
        supabaseAccessToken: SUPABASE_ACCESS_TOKEN,
        input: {
          biomarkerName: "x",
          value: 1,
          unitUcum: "u",
          loincCode: null,
        },
      }),
    ).rejects.toMatchObject({ code: "TOO_MANY_REQUESTS" });
    expect(insertFn).not.toHaveBeenCalled();
  });

  it("translates a 5xx into TRPC INTERNAL_SERVER_ERROR without writing audit", async () => {
    const { db, insertFn } = makeDb();
    globalThis.fetch = vi.fn(() =>
      Promise.resolve(new Response("boom", { status: 502 })),
    );
    await expect(
      generateBiomarkerSuggestion(db, {
        patientId: PATIENT_ID,
        supabaseAccessToken: SUPABASE_ACCESS_TOKEN,
        input: {
          biomarkerName: "x",
          value: 1,
          unitUcum: "u",
          loincCode: null,
        },
      }),
    ).rejects.toMatchObject({ code: "INTERNAL_SERVER_ERROR" });
    expect(insertFn).not.toHaveBeenCalled();
  });

  it("translates a network/fetch failure into INTERNAL_SERVER_ERROR without writing audit", async () => {
    const { db, insertFn } = makeDb();
    globalThis.fetch = vi.fn(() =>
      Promise.reject(new TypeError("fetch failed")),
    );
    await expect(
      generateBiomarkerSuggestion(db, {
        patientId: PATIENT_ID,
        supabaseAccessToken: SUPABASE_ACCESS_TOKEN,
        input: {
          biomarkerName: "x",
          value: 1,
          unitUcum: "u",
          loincCode: null,
        },
      }),
    ).rejects.toMatchObject({ code: "INTERNAL_SERVER_ERROR" });
    expect(insertFn).not.toHaveBeenCalled();
  });

  it("rejects malformed responses (missing/empty suggestion) without writing audit", async () => {
    const { db, insertFn } = makeDb();
    globalThis.fetch = vi.fn(() =>
      Promise.resolve(
        new Response(JSON.stringify({ suggestion: "" }), { status: 200 }),
      ),
    );
    await expect(
      generateBiomarkerSuggestion(db, {
        patientId: PATIENT_ID,
        supabaseAccessToken: SUPABASE_ACCESS_TOKEN,
        input: {
          biomarkerName: "x",
          value: 1,
          unitUcum: "u",
          loincCode: null,
        },
      }),
    ).rejects.toMatchObject({ code: "INTERNAL_SERVER_ERROR" });
    expect(insertFn).not.toHaveBeenCalled();
  });

  it("throws when LLM_SERVICE_URL is not configured (no fetch, no audit)", async () => {
    delete process.env.LLM_SERVICE_URL;
    const { db, insertFn } = makeDb();
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy;
    await expect(
      generateBiomarkerSuggestion(db, {
        patientId: PATIENT_ID,
        supabaseAccessToken: SUPABASE_ACCESS_TOKEN,
        input: {
          biomarkerName: "x",
          value: 1,
          unitUcum: "u",
          loincCode: null,
        },
      }),
    ).rejects.toMatchObject({ code: "INTERNAL_SERVER_ERROR" });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(insertFn).not.toHaveBeenCalled();
  });
});
