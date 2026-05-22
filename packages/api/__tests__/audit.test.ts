import { describe, expect, it, vi } from "vitest";

import { AuditLog } from "@healthtracker/db/schema";

import type { AuditDb } from "../src/audit";
import { writeAuditLog } from "../src/audit";

function mockDb(opts?: { valuesRejectsWith?: Error }) {
  const values = opts?.valuesRejectsWith
    ? vi.fn().mockRejectedValue(opts.valuesRejectsWith)
    : vi.fn().mockResolvedValue(undefined);
  const insert = vi.fn(() => ({ values }));
  return { db: { insert } as unknown as AuditDb, insert, values };
}

describe("writeAuditLog", () => {
  it("inserts the given entry into audit_log", async () => {
    const { db, insert, values } = mockDb();

    await writeAuditLog(db, {
      actorId: "actor-1",
      actorType: "patient",
      event: "patient.created",
      resourceId: "actor-1",
      resourceType: "user",
      metadata: { actor: "self" },
    });

    expect(insert).toHaveBeenCalledWith(AuditLog);
    expect(values).toHaveBeenCalledWith({
      actorId: "actor-1",
      actorType: "patient",
      event: "patient.created",
      resourceId: "actor-1",
      resourceType: "user",
      metadata: { actor: "self" },
    });
  });

  it("defaults metadata to an empty object when omitted", async () => {
    const { db, values } = mockDb();

    await writeAuditLog(db, {
      actorId: "actor-1",
      actorType: "system",
      event: "something.happened",
      resourceId: "res-1",
      resourceType: "user",
    });

    expect(values).toHaveBeenCalledWith(
      expect.objectContaining({ metadata: {} }),
    );
  });

  it("propagates DB errors so the surrounding transaction can roll back", async () => {
    // Simulate an RLS denial: the policy WITH CHECK fails because
    // current_setting('app.current_patient_id') doesn't match actor_id.
    const rlsError = Object.assign(
      new Error("new row violates row-level security policy"),
      {
        code: "42501",
      },
    );
    const { db } = mockDb({ valuesRejectsWith: rlsError });

    await expect(
      writeAuditLog(db, {
        actorId: "actor-1",
        actorType: "patient",
        event: "patient.created",
        resourceId: "actor-1",
        resourceType: "user",
      }),
    ).rejects.toMatchObject({ code: "42501" });
  });
});
