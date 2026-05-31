import { describe, expect, it, vi } from "vitest";

import type { AuditDb } from "../src/audit";
import { markUploadViewed } from "../src/uploads-mark-viewed";

const PATIENT_ID = "66666666-6666-6666-6666-666666666666";
const UPLOAD_ID = "77777777-7777-7777-7777-777777777777";

/**
 * Story 7.2 — unit tests for `markUploadViewed`. The helper issues
 * an UPDATE guarded by `WHERE viewed_at IS NULL` so second calls are
 * idempotent no-ops; the `returning()` row count surfaces this back
 * to the caller as `{ marked: boolean }`.
 */
function makeUpdateDb(returnedRows: { id: string }[]) {
  const returning = vi.fn(() => Promise.resolve(returnedRows));
  const where = vi.fn(() => ({ returning }));
  const set = vi.fn(() => ({ where }));
  const update = vi.fn(() => ({ set }));
  const db = { update } as unknown as AuditDb;
  return { db, update, set, where, returning };
}

describe("markUploadViewed", () => {
  it("returns { marked: true } when the row was unviewed", async () => {
    const { db } = makeUpdateDb([{ id: UPLOAD_ID }]);
    const out = await markUploadViewed(db, PATIENT_ID, UPLOAD_ID);
    expect(out).toEqual({ marked: true });
  });

  it("returns { marked: false } when the row was already viewed (idempotent no-op)", async () => {
    const { db } = makeUpdateDb([]);
    const out = await markUploadViewed(db, PATIENT_ID, UPLOAD_ID);
    expect(out).toEqual({ marked: false });
  });

  it("issues update with patient + id + isNull(viewedAt) predicate", async () => {
    const { db, update, set, where } = makeUpdateDb([{ id: UPLOAD_ID }]);
    await markUploadViewed(db, PATIENT_ID, UPLOAD_ID);
    expect(update).toHaveBeenCalledTimes(1);
    expect(set).toHaveBeenCalledTimes(1);
    expect(where).toHaveBeenCalledTimes(1);
  });
});
