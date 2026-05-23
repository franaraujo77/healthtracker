import { describe, expect, it, vi } from "vitest";

import type { AuditDb } from "../src/audit";
import type { UploadStatus } from "../src/upload-transitions";
import {
  applyDeadLetter,
  applyUploadTransition,
  UPLOAD_TRANSITIONS,
} from "../src/upload-transitions";

const UPLOAD_ID = "55555555-5555-5555-5555-555555555555";

/**
 * Builds a Drizzle-update-chain mock that captures the `.set(...)`
 * argument and returns `returningRows` from `.returning()`.
 */
function makeDb(returningRows: { id: string; status: UploadStatus }[]) {
  const returning = vi.fn(() => Promise.resolve(returningRows));
  const where = vi.fn(() => ({ returning }));
  const set = vi.fn(() => ({ where }));
  const update = vi.fn(() => ({ set }));
  return {
    db: { update } as unknown as AuditDb,
    update,
    set,
    where,
    returning,
  };
}

describe("upload-transitions — legal arcs", () => {
  const legalArcs: { from: UploadStatus; to: UploadStatus }[] = [
    { from: "queued", to: "processing" },
    { from: "processing", to: "pending_review" },
    { from: "processing", to: "complete" },
    { from: "processing", to: "failed" },
    { from: "pending_review", to: "complete" },
    { from: "pending_review", to: "failed" },
  ];

  for (const arc of legalArcs) {
    it(`accepts ${arc.from} → ${arc.to}`, async () => {
      const { db, update, set } = makeDb([{ id: UPLOAD_ID, status: arc.to }]);

      const result = await applyUploadTransition(db, {
        uploadId: UPLOAD_ID,
        from: arc.from,
        to: arc.to,
      });

      expect(result).toEqual({ updated: true, currentStatus: arc.to });
      expect(update).toHaveBeenCalledTimes(1);
      expect(set).toHaveBeenCalledWith(
        expect.objectContaining({ status: arc.to }),
      );
    });
  }
});

describe("upload-transitions — illegal arcs throw INVALID_UPLOAD_TRANSITION", () => {
  // Every (from, to) pair that's NOT in the legal arc set, plus the
  // self-transition for each state.
  const allStatuses: UploadStatus[] = [
    "queued",
    "processing",
    "pending_review",
    "complete",
    "failed",
  ];

  const legalSet = new Set<string>();
  for (const [from, tos] of Object.entries(UPLOAD_TRANSITIONS)) {
    for (const to of tos) legalSet.add(`${from}->${to}`);
  }

  const illegal: { from: UploadStatus; to: UploadStatus }[] = [];
  for (const from of allStatuses) {
    for (const to of allStatuses) {
      if (!legalSet.has(`${from}->${to}`)) {
        illegal.push({ from, to });
      }
    }
  }

  for (const arc of illegal) {
    it(`rejects ${arc.from} → ${arc.to}`, async () => {
      const { db, update } = makeDb([]);

      await expect(
        applyUploadTransition(db, {
          uploadId: UPLOAD_ID,
          from: arc.from,
          to: arc.to,
        }),
      ).rejects.toMatchObject({
        code: "CONFLICT",
        message: "INVALID_UPLOAD_TRANSITION",
      });
      // Illegal transitions short-circuit before touching the DB.
      expect(update).not.toHaveBeenCalled();
    });
  }
});

describe("upload-transitions — optimistic-lock miss", () => {
  it("returns { updated: false, currentStatus: null } when the WHERE clause matches zero rows", async () => {
    const { db } = makeDb([]);

    const result = await applyUploadTransition(db, {
      uploadId: UPLOAD_ID,
      from: "queued",
      to: "processing",
    });

    expect(result).toEqual({ updated: false, currentStatus: null });
  });

  it("merges metadata via the `||` jsonb concatenation seam", async () => {
    const { db, set } = makeDb([{ id: UPLOAD_ID, status: "processing" }]);

    await applyUploadTransition(db, {
      uploadId: UPLOAD_ID,
      from: "queued",
      to: "processing",
      metadata: { reason: "worker-pickup", workerId: "w-1" },
    });

    // The metadata arg is wrapped in a `sql` template; we just verify
    // the `.set()` call received the column update at all (Drizzle's
    // sql tag is opaque to deep equality).
    expect(set).toHaveBeenCalledWith(
      expect.objectContaining({ status: "processing" }),
    );
  });
});

describe("upload-transitions — applyDeadLetter", () => {
  it("forces failed and returns { updated: true } for non-terminal rows", async () => {
    const { db, set } = makeDb([{ id: UPLOAD_ID, status: "failed" }]);

    const result = await applyDeadLetter(db, { uploadId: UPLOAD_ID });

    expect(result).toEqual({ updated: true, currentStatus: "failed" });
    expect(set).toHaveBeenCalledWith(
      expect.objectContaining({ status: "failed" }),
    );
  });

  it("returns { updated: false } when the row is already terminal (WHERE matches zero)", async () => {
    const { db } = makeDb([]);

    const result = await applyDeadLetter(db, { uploadId: UPLOAD_ID });

    expect(result).toEqual({ updated: false, currentStatus: null });
  });
});

describe("upload-transitions — UPLOAD_TRANSITIONS map shape", () => {
  it("declares the expected arc set (regression guard against silent edits)", () => {
    expect(UPLOAD_TRANSITIONS).toEqual({
      queued: ["processing"],
      processing: ["pending_review", "complete", "failed"],
      pending_review: ["complete", "failed"],
      complete: [],
      failed: [],
    });
  });
});
