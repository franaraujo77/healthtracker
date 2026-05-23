import { describe, expect, it, vi } from "vitest";

import type { AuditDb } from "../src/audit";
import {
  DEFAULT_NOTIFICATION_PREFERENCES,
  getNotificationPreferences,
  writeNotificationPreferences,
} from "../src/notifications";

const PATIENT_ID = "11111111-1111-1111-1111-111111111111";

function makeSelectDb(rows: unknown[]) {
  const where = vi.fn(() => ({
    limit: vi.fn(() => Promise.resolve(rows)),
  }));
  const from = vi.fn(() => ({ where }));
  const select = vi.fn(() => ({ from }));
  return { db: { select } as unknown as AuditDb, select, from, where };
}

describe("getNotificationPreferences", () => {
  it("returns the row when it exists", async () => {
    const stored = {
      resultsReady: true,
      lettersReady: false,
      recordAccess: true,
      reviewRequired: false,
    };
    const { db } = makeSelectDb([stored]);
    const result = await getNotificationPreferences(db, PATIENT_ID);
    expect(result).toEqual(stored);
  });

  it("returns the synthetic default when no row exists", async () => {
    const { db } = makeSelectDb([]);
    const result = await getNotificationPreferences(db, PATIENT_ID);
    expect(result).toEqual(DEFAULT_NOTIFICATION_PREFERENCES);
    expect(result.resultsReady).toBe(true);
    expect(result.lettersReady).toBe(true);
    expect(result.recordAccess).toBe(true);
    expect(result.reviewRequired).toBe(true);
  });
});

describe("writeNotificationPreferences", () => {
  it("UPSERTs on patient_id (PK) and returns the post-write row", async () => {
    const prefs = {
      resultsReady: true,
      lettersReady: false,
      recordAccess: true,
      reviewRequired: false,
    };
    const returning = vi.fn(() => Promise.resolve([prefs]));
    const onConflictDoUpdate = vi.fn(() => ({ returning }));
    const values = vi.fn(() => ({ onConflictDoUpdate }));
    const db = { insert: vi.fn(() => ({ values })) } as unknown as AuditDb;

    const result = await writeNotificationPreferences(db, PATIENT_ID, prefs);
    expect(result).toEqual(prefs);
    expect(values).toHaveBeenCalledWith(
      expect.objectContaining({
        patientId: PATIENT_ID,
        resultsReady: true,
        lettersReady: false,
        recordAccess: true,
        reviewRequired: false,
      }),
    );
    // UPSERT — onConflictDoUpdate must update the same 4 boolean fields
    // PLUS `updatedAt` (defense against drift between INSERT and UPDATE).
    expect(onConflictDoUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        set: expect.objectContaining({
          resultsReady: true,
          lettersReady: false,
          recordAccess: true,
          reviewRequired: false,
          updatedAt: expect.any(Date) as unknown,
        }) as unknown,
      }),
    );
  });

  it("throws when the UPSERT returns no row (defensive)", async () => {
    const returning = vi.fn(() => Promise.resolve([]));
    const onConflictDoUpdate = vi.fn(() => ({ returning }));
    const values = vi.fn(() => ({ onConflictDoUpdate }));
    const db = { insert: vi.fn(() => ({ values })) } as unknown as AuditDb;
    await expect(
      writeNotificationPreferences(db, PATIENT_ID, {
        resultsReady: true,
        lettersReady: true,
        recordAccess: true,
        reviewRequired: true,
      }),
    ).rejects.toThrow();
  });
});
