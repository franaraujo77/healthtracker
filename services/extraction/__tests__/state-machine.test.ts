import { describe, expect, it, vi } from "vitest";

import {
  applyDeadLetter,
  applyUploadTransition,
} from "../src/state-machine/upload-transitions.js";

/**
 * The worker's `applyUploadTransition` mirrors the API helper's
 * contract. These tests verify the legal-arc gate + the
 * optimistic-lock miss return shape using a tagged-template mock
 * that captures the SQL invocation and returns canned rows.
 */
function makeSql(returningRows: { id: string; status: string }[]) {
  // postgres's sql tag returns an awaitable iterable of rows when
  // used as `sql<RowType[]>\`...\``. Mock it as a function that
  // also exposes recursive `sql\`...\`` for nested template tags
  // (the COALESCE branches use `sql\`...\``).
  const sql = vi.fn(() => Promise.resolve(returningRows)) as unknown as {
    (...args: unknown[]): Promise<unknown[]>;
  };
  return sql;
}

describe("applyUploadTransition — legal arcs", () => {
  it("accepts queued → processing", async () => {
    const sql = makeSql([{ id: "u-1", status: "processing" }]);
    const result = await applyUploadTransition(sql as never, {
      uploadId: "u-1",
      from: "queued",
      to: "processing",
    });
    expect(result).toEqual({ updated: true, currentStatus: "processing" });
  });

  it("accepts processing → complete", async () => {
    const sql = makeSql([{ id: "u-1", status: "complete" }]);
    const result = await applyUploadTransition(sql as never, {
      uploadId: "u-1",
      from: "processing",
      to: "complete",
    });
    expect(result.updated).toBe(true);
  });

  it("returns { updated: false } on optimistic-lock miss", async () => {
    const sql = makeSql([]);
    const result = await applyUploadTransition(sql as never, {
      uploadId: "u-1",
      from: "queued",
      to: "processing",
    });
    expect(result).toEqual({ updated: false, currentStatus: null });
  });
});

describe("applyUploadTransition — illegal arcs throw", () => {
  it("rejects same-state self-transition", async () => {
    const sql = makeSql([]);
    await expect(
      applyUploadTransition(sql as never, {
        uploadId: "u-1",
        from: "processing",
        to: "processing",
      }),
    ).rejects.toThrow(/INVALID_UPLOAD_TRANSITION/);
  });

  it("rejects failed → queued (re-queue is a new row)", async () => {
    const sql = makeSql([]);
    await expect(
      applyUploadTransition(sql as never, {
        uploadId: "u-1",
        from: "failed",
        to: "queued",
      }),
    ).rejects.toThrow(/INVALID_UPLOAD_TRANSITION/);
  });
});

describe("applyDeadLetter", () => {
  it("forces failed when a non-terminal row matches", async () => {
    const sql = makeSql([{ id: "u-1", status: "failed" }]);
    const result = await applyDeadLetter(sql as never, { uploadId: "u-1" });
    expect(result).toEqual({ updated: true, currentStatus: "failed" });
  });

  it("returns { updated: false } when row is already terminal", async () => {
    const sql = makeSql([]);
    const result = await applyDeadLetter(sql as never, { uploadId: "u-1" });
    expect(result).toEqual({ updated: false, currentStatus: null });
  });
});
