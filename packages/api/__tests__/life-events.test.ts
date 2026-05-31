import { describe, expect, it, vi } from "vitest";

import type { AuditDb } from "../src/audit";
import { createLifeEvent, listLifeEventsInWindow } from "../src/life-events";

const PATIENT_ID = "66666666-6666-6666-6666-666666666666";

/**
 * Story 7.1 — unit tests for the life-events helpers. Same mock-DB
 * pattern as observations.test.ts: chain the Drizzle builder and
 * assert call shape + audit metadata.
 */
function makeInsertDb(returnedRow: {
  id: string;
  eventDate: string;
  description: string;
  category: string | null;
  privacyFlag: string;
}) {
  const returning = vi.fn(() => Promise.resolve([returnedRow]));
  const valuesFn = vi.fn(() => ({ returning }));
  const insertFn = vi.fn(() => ({ values: valuesFn }));
  const auditValues = vi.fn(() => Promise.resolve(undefined));
  return {
    db: {
      insert: vi
        .fn()
        // first call — life_events row insert (chained .values().returning())
        .mockImplementationOnce(insertFn)
        // second call — writeAuditLog (.values() only)
        .mockImplementationOnce(() => ({ values: auditValues })),
    } as unknown as AuditDb,
    insertFn,
    valuesFn,
    auditValues,
  };
}

describe("createLifeEvent", () => {
  it("inserts the row and writes a life_event.created audit (metadata WITHOUT description)", async () => {
    const returnedRow = {
      id: "le-1",
      eventDate: "2024-06-01",
      description: "comecei nova rotina",
      category: "lifestyle" as const,
      privacyFlag: "patient_only" as const,
    };
    const { db, valuesFn, auditValues } = makeInsertDb(returnedRow);

    const out = await createLifeEvent(db, PATIENT_ID, {
      eventDate: "2024-06-01",
      description: "comecei nova rotina",
      category: "lifestyle",
    });

    expect(out).toEqual(returnedRow);
    expect(valuesFn).toHaveBeenCalledWith(
      expect.objectContaining({
        patientId: PATIENT_ID,
        eventDate: "2024-06-01",
        description: "comecei nova rotina",
        category: "lifestyle",
      }),
    );
    expect(auditValues).toHaveBeenCalledTimes(1);
    const firstCall = auditValues.mock.calls[0] as unknown as
      | [
          {
            event: string;
            resourceType: string;
            resourceId: string;
            actorType: string;
            actorId: string;
            metadata: Record<string, unknown>;
          },
        ]
      | undefined;
    if (!firstCall) throw new Error("audit values not called");
    const auditArg = firstCall[0];
    expect(auditArg.event).toBe("life_event.created");
    expect(auditArg.resourceType).toBe("life_event");
    expect(auditArg.resourceId).toBe("le-1");
    expect(auditArg.actorType).toBe("patient");
    expect(auditArg.actorId).toBe(PATIENT_ID);
    expect(auditArg.metadata).toEqual({
      eventDate: "2024-06-01",
      category: "lifestyle",
    });
    // PII discipline — description MUST NEVER appear in audit metadata.
    expect(JSON.stringify(auditArg.metadata)).not.toContain(
      "comecei nova rotina",
    );
  });

  it("maps undefined category to null on insert", async () => {
    const { db, valuesFn } = makeInsertDb({
      id: "le-2",
      eventDate: "2024-06-01",
      description: "x",
      category: null,
      privacyFlag: "patient_only",
    });

    await createLifeEvent(db, PATIENT_ID, {
      eventDate: "2024-06-01",
      description: "x",
    });

    expect(valuesFn).toHaveBeenCalledWith(
      expect.objectContaining({ category: null }),
    );
  });

  it("throws when the insert returns no row", async () => {
    const returning = vi.fn(() => Promise.resolve([]));
    const valuesFn = vi.fn(() => ({ returning }));
    const db = {
      insert: vi.fn(() => ({ values: valuesFn })),
    } as unknown as AuditDb;

    await expect(
      createLifeEvent(db, PATIENT_ID, {
        eventDate: "2024-06-01",
        description: "x",
      }),
    ).rejects.toThrow(/no row/);
  });
});

describe("listLifeEventsInWindow", () => {
  it("SELECTs by patient + date window and returns ordered events", async () => {
    const rows = [
      {
        id: "le-1",
        eventDate: "2024-06-01",
        description: "a",
        category: "lifestyle",
        privacyFlag: "patient_only",
      },
      {
        id: "le-2",
        eventDate: "2024-06-15",
        description: "b",
        category: null,
        privacyFlag: "patient_only",
      },
    ];
    const orderBy = vi.fn(() => Promise.resolve(rows));
    const where = vi.fn(() => ({ orderBy }));
    const from = vi.fn(() => ({ where }));
    const select = vi.fn(() => ({ from }));
    const db = { select } as unknown as AuditDb;

    const out = await listLifeEventsInWindow(db, PATIENT_ID, {
      fromDate: "2024-06-01",
      toDate: "2024-06-30",
    });

    expect(out).toEqual({ events: rows });
    expect(select).toHaveBeenCalledTimes(1);
    expect(where).toHaveBeenCalledTimes(1);
    expect(orderBy).toHaveBeenCalledTimes(1);
  });
});
