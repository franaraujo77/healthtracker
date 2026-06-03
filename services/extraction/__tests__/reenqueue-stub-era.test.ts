import { describe, expect, it } from "vitest";

import {
  assertApplyPreconditions,
  DEFAULT_STUB_ERA_REASONS,
  isStubEraFailure,
  parseReenqueueArgs,
  toExtractPayload,
} from "../src/reenqueue-stub-era.helpers.js";

/**
 * Story 9.4 — only the pure planner is unit-tested (no DB / pg-boss in
 * CI). The script shell that wires `sql` + `boss.send` around these is
 * thin and operator-run (dry-run first).
 */

describe("parseReenqueueArgs", () => {
  it("defaults to dry-run, no cutoff, the default reason set", () => {
    expect(parseReenqueueArgs([])).toEqual({
      apply: false,
      before: null,
      reasons: [...DEFAULT_STUB_ERA_REASONS],
    });
  });

  it("parses --apply and a valid --before timestamp", () => {
    const out = parseReenqueueArgs([
      "--apply",
      "--before",
      "2026-06-15T00:00:00Z",
    ]);
    expect(out.apply).toBe(true);
    expect(out.before?.toISOString()).toBe("2026-06-15T00:00:00.000Z");
  });

  it("throws on an unparseable --before", () => {
    expect(() => parseReenqueueArgs(["--before", "not-a-date"])).toThrow(
      /ISO-8601/,
    );
  });

  it("throws on a loose (non-ISO-8601) --before like '2026'", () => {
    expect(() => parseReenqueueArgs(["--before", "2026"])).toThrow(/ISO-8601/);
    expect(() => parseReenqueueArgs(["--before", "2026-06-15"])).toThrow(
      /ISO-8601/,
    );
  });

  it("throws when --before is the last arg with no value", () => {
    expect(() => parseReenqueueArgs(["--before"])).toThrow(/ISO-8601/);
  });

  it("throws when --reasons has no usable value", () => {
    expect(() => parseReenqueueArgs(["--reasons"])).toThrow(/comma-separated/);
    expect(() => parseReenqueueArgs(["--reasons", " , "])).toThrow(
      /comma-separated/,
    );
  });

  it("overrides the reason set via --reasons", () => {
    expect(
      parseReenqueueArgs(["--reasons", "retries_exhausted, no_readable_text"])
        .reasons,
    ).toEqual(["retries_exhausted", "no_readable_text"]);
  });

  it("throws on an unknown argument", () => {
    expect(() => parseReenqueueArgs(["--nope"])).toThrow(/Unknown argument/);
  });
});

describe("assertApplyPreconditions", () => {
  it("throws when --apply has no --before cutoff", () => {
    expect(() =>
      assertApplyPreconditions({ apply: true, before: null }),
    ).toThrow(/Refusing to --apply without --before/);
  });

  it("allows --apply with a cutoff, and dry-run without one", () => {
    expect(() =>
      assertApplyPreconditions({ apply: true, before: new Date() }),
    ).not.toThrow();
    expect(() =>
      assertApplyPreconditions({ apply: false, before: null }),
    ).not.toThrow();
  });
});

describe("isStubEraFailure", () => {
  const before = new Date("2026-06-15T00:00:00Z");
  const opts = { before, reasons: ["retries_exhausted", "no_readable_text"] };

  it("is true for a failed, pre-cutoff, matching-reason upload", () => {
    expect(
      isStubEraFailure(
        {
          status: "failed",
          reason: "retries_exhausted",
          updatedAt: new Date("2026-06-10T00:00:00Z"),
        },
        opts,
      ),
    ).toBe(true);
  });

  it("is false for a POST-cutoff failure (genuine post-launch — AC2)", () => {
    expect(
      isStubEraFailure(
        {
          status: "failed",
          reason: "no_readable_text",
          updatedAt: new Date("2026-06-20T00:00:00Z"),
        },
        opts,
      ),
    ).toBe(false);
  });

  it("is false for a non-matching reason", () => {
    expect(
      isStubEraFailure(
        {
          status: "failed",
          reason: "storage_unavailable",
          updatedAt: new Date("2026-06-10T00:00:00Z"),
        },
        opts,
      ),
    ).toBe(false);
  });

  it("is false for a non-failed upload", () => {
    expect(
      isStubEraFailure(
        {
          status: "complete",
          reason: "retries_exhausted",
          updatedAt: new Date("2026-06-10T00:00:00Z"),
        },
        opts,
      ),
    ).toBe(false);
  });

  it("is time-unbounded when before is null", () => {
    expect(
      isStubEraFailure(
        {
          status: "failed",
          reason: "retries_exhausted",
          updatedAt: new Date("2030-01-01T00:00:00Z"),
        },
        { before: null, reasons: ["retries_exhausted"] },
      ),
    ).toBe(true);
  });

  it("is false for a null reason", () => {
    expect(
      isStubEraFailure(
        {
          status: "failed",
          reason: null,
          updatedAt: new Date("2026-06-10T00:00:00Z"),
        },
        opts,
      ),
    ).toBe(false);
  });
});

describe("toExtractPayload", () => {
  it("reconstructs the payload from the row columns", () => {
    expect(
      toExtractPayload({
        uploadId: "u1",
        storagePath: "p1/key/exam.pdf",
        idempotencyKey: "key",
        mimeType: "application/pdf",
      }),
    ).toEqual({
      uploadId: "u1",
      storagePath: "p1/key/exam.pdf",
      idempotencyKey: "key",
      mimeType: "application/pdf",
    });
  });

  it("throws when a required column is null", () => {
    expect(() =>
      toExtractPayload({
        uploadId: "u1",
        storagePath: null,
        idempotencyKey: "key",
        mimeType: "application/pdf",
      }),
    ).toThrow(/missing required columns/);
  });

  it("throws on an unsupported mimeType (not in the allowlist)", () => {
    expect(() =>
      toExtractPayload({
        uploadId: "u1",
        storagePath: "p1/key/exam.tiff",
        idempotencyKey: "key",
        mimeType: "image/tiff",
      }),
    ).toThrow(/unsupported mimeType/);
  });
});
