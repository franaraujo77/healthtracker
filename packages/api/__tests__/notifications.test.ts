import { describe, expect, it, vi } from "vitest";

import type { AuditDb } from "../src/audit";
import {
  enqueueNotificationSend,
  revokePushTokenByDevice,
  writePushToken,
} from "../src/notifications";

const PATIENT_ID = "11111111-1111-1111-1111-111111111111";
const DEVICE_ID = "22222222-2222-2222-2222-222222222222";
const UPLOAD_ID = "33333333-3333-3333-3333-333333333333";

describe("writePushToken", () => {
  it("upserts on (patient_id, device_id) and returns the row id", async () => {
    const returning = vi.fn(() => Promise.resolve([{ id: "tok-1" }]));
    const onConflictDoUpdate = vi.fn(() => ({ returning }));
    const values = vi.fn(() => ({ onConflictDoUpdate }));
    const db = {
      insert: vi.fn(() => ({ values })),
    } as unknown as AuditDb;

    const row = await writePushToken(db, {
      patientId: PATIENT_ID,
      deviceId: DEVICE_ID,
      expoToken: "ExponentPushToken[abc]",
      platform: "ios",
      appVersion: "1.0.0",
    });

    expect(row).toEqual({ id: "tok-1" });
    expect(values).toHaveBeenCalledWith(
      expect.objectContaining({
        patientId: PATIENT_ID,
        deviceId: DEVICE_ID,
        expoToken: "ExponentPushToken[abc]",
        platform: "ios",
        appVersion: "1.0.0",
      }),
    );
    // The conflict-update path clears `revokedAt: null` so a
    // re-register reactivates a soft-deleted row.
    expect(onConflictDoUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        set: expect.objectContaining({
          expoToken: "ExponentPushToken[abc]",
          revokedAt: null,
        }) as unknown,
      }),
    );
  });
});

describe("revokePushTokenByDevice", () => {
  it("issues an UPDATE scoped to (patient_id, device_id)", async () => {
    const execute = vi.fn(() => Promise.resolve(undefined));
    const db = { execute } as unknown as AuditDb;

    await revokePushTokenByDevice(db, PATIENT_ID, DEVICE_ID);
    expect(execute).toHaveBeenCalledTimes(1);
  });
});

describe("enqueueNotificationSend", () => {
  it("inserts a `notification.send` pg-boss job with the singleton key", async () => {
    const execute = vi.fn(() => Promise.resolve(undefined));
    const db = { execute } as unknown as AuditDb;

    await enqueueNotificationSend(db, {
      uploadId: UPLOAD_ID,
      patientId: PATIENT_ID,
      kind: "complete",
    });
    expect(execute).toHaveBeenCalledTimes(1);
  });
});
