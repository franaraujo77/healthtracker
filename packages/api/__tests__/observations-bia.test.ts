import { describe, expect, it, vi } from "vitest";

import type { BiaSubmissionInput } from "@healthtracker/validators";

import type { AuditDb } from "../src/audit";
import {
  SENTINEL_UPLOAD_UUID,
  writeBiaObservations,
} from "../src/observations";

const PATIENT_ID = "11111111-1111-1111-1111-111111111111";

const BASE_INPUT: BiaSubmissionInput = {
  visceralFatAreaCm2: 80,
  skeletalMuscleMassKg: 32,
  bodyFatPercentage: 22,
  collectedAt: "2024-03-15",
  deviceName: "InBody",
  deviceModel: "770",
};

/**
 * Story 2.7 — scripted DB mock. The helper calls in order:
 *   1. SELECT existing observations (duplicate detection)
 *   2. UPDATE existing observations (overwrite path only)
 *   3. INSERT 3× observation (writeObservation × 3)
 *   4. INSERT 1× audit_log (writeAuditLog)
 */
function makeDb(script: {
  existingIds?: string[];
  insertReturnings?: ({ id: string } | null)[];
}) {
  const existingIds = script.existingIds ?? [];
  const insertReturnings = script.insertReturnings ?? [
    { id: "obs-1" },
    { id: "obs-2" },
    { id: "obs-3" },
  ];

  // SELECT chain — used for the duplicate-detection query.
  // R1-P202 — `.for("update")` is now part of the chain.
  const selectRows = existingIds.map((id) => ({ id }));
  const selectFn = vi.fn(() => {
    const chain: Record<string, unknown> = {};
    const finalize = Promise.resolve(selectRows);
    chain.from = vi.fn(() => chain);
    chain.where = vi.fn(() => {
      const inner: Record<string, unknown> = {};
      inner.for = vi.fn(() => finalize);
      inner.then = finalize.then.bind(finalize);
      inner.catch = finalize.catch.bind(finalize);
      return inner;
    });
    return chain;
  });

  // UPDATE chain — used for the overwrite soft-delete.
  const updateSetArgs: unknown[] = [];
  const updateWhereCalls: unknown[] = [];
  const updateFn = vi.fn(() => {
    const chain: Record<string, unknown> = {};
    chain.set = vi.fn((arg: unknown) => {
      updateSetArgs.push(arg);
      return chain;
    });
    chain.where = vi.fn((arg: unknown) => {
      updateWhereCalls.push(arg);
      return Promise.resolve(undefined);
    });
    return chain;
  });

  // INSERT chain — used by writeObservation × 3 + writeAuditLog.
  let insertCallCount = 0;
  const insertValuesArgs: unknown[] = [];
  const insertFn = vi.fn(() => {
    const chain: Record<string, unknown> = {};
    chain.values = vi.fn((arg: unknown) => {
      insertValuesArgs.push(arg);
      const inner: Record<string, unknown> = {};
      inner.onConflictDoNothing = vi.fn(() => ({
        returning: vi.fn(() => {
          const ret = insertReturnings[insertCallCount] ?? null;
          insertCallCount += 1;
          return Promise.resolve(ret ? [ret] : []);
        }),
      }));
      // writeAuditLog does `.insert().values()` without onConflict/.returning
      const p = Promise.resolve(undefined);
      inner.then = p.then.bind(p);
      inner.catch = p.catch.bind(p);
      return inner;
    });
    return chain;
  });

  return {
    db: {
      select: selectFn,
      update: updateFn,
      insert: insertFn,
    } as unknown as AuditDb,
    insertValuesArgs,
    updateSetArgs,
    updateWhereCalls,
    selectFn,
    updateFn,
    insertFn,
  };
}

describe("writeBiaObservations", () => {
  it("AC1 — fans out to 3 observations with source='manual_bia' and the BIA LOINC codes", async () => {
    const { db, insertValuesArgs } = makeDb({});
    const result = await writeBiaObservations(db, {
      patientId: PATIENT_ID,
      input: BASE_INPUT,
    });
    expect(result.status).toBe("created");
    if (result.status !== "created") throw new Error("unreachable");
    expect(result.observationIds).toEqual(["obs-1", "obs-2", "obs-3"]);
    // Three observation INSERTs in order — visceral fat, skeletal
    // muscle, body fat.
    expect(insertValuesArgs[0]).toMatchObject({
      patientId: PATIENT_ID,
      uploadId: SENTINEL_UPLOAD_UUID,
      loincCode: "73711-2",
      unitUcum: "cm2",
      source: "manual_bia",
      confidenceScore: "1",
      valueNumeric: "80",
      labName: "InBody 770",
    });
    expect(insertValuesArgs[1]).toMatchObject({
      loincCode: "73964-7",
      unitUcum: "kg",
      source: "manual_bia",
    });
    expect(insertValuesArgs[2]).toMatchObject({
      loincCode: "41982-0",
      unitUcum: "%",
      source: "manual_bia",
    });
  });

  it("AC2 — emits exactly ONE observation.write audit per submission with observationIds in metadata", async () => {
    const { db, insertValuesArgs } = makeDb({});
    await writeBiaObservations(db, {
      patientId: PATIENT_ID,
      input: BASE_INPUT,
    });
    // The 4th insert call is the audit row.
    expect(insertValuesArgs[3]).toMatchObject({
      actorType: "patient",
      actorId: PATIENT_ID,
      event: "observation.write",
      resourceType: "observation",
      resourceId: "obs-1",
      metadata: expect.objectContaining({
        source: "manual_bia",
        observationIds: ["obs-1", "obs-2", "obs-3"],
        collectedAt: "2024-03-15",
        labName: "InBody 770",
      }) as unknown,
    });
  });

  it("AC3 — duplicate detection: returns { status: 'duplicate' } without writing when overwrite is not set", async () => {
    const { db, insertFn, updateFn } = makeDb({
      existingIds: ["existing-1", "existing-2", "existing-3"],
    });
    const result = await writeBiaObservations(db, {
      patientId: PATIENT_ID,
      input: BASE_INPUT,
    });
    expect(result.status).toBe("duplicate");
    if (result.status !== "duplicate") throw new Error("unreachable");
    expect(result.existingObservationIds).toEqual([
      "existing-1",
      "existing-2",
      "existing-3",
    ]);
    // Neither soft-delete nor inserts happen.
    expect(updateFn).not.toHaveBeenCalled();
    expect(insertFn).not.toHaveBeenCalled();
  });

  it("AC3 — overwrite: soft-deletes existing rows + inserts 3 new ones + audit metadata includes overwroteObservationIds", async () => {
    const { db, insertValuesArgs, updateSetArgs } = makeDb({
      existingIds: ["existing-1", "existing-2", "existing-3"],
    });
    const result = await writeBiaObservations(db, {
      patientId: PATIENT_ID,
      input: { ...BASE_INPUT, overwrite: true },
    });
    expect(result.status).toBe("created");
    if (result.status !== "created") throw new Error("unreachable");
    expect(result.overwroteObservationIds).toEqual([
      "existing-1",
      "existing-2",
      "existing-3",
    ]);
    // UPDATE set { deletedAt } was called.
    expect(updateSetArgs[0]).toMatchObject({
      deletedAt: expect.any(Date) as unknown,
    });
    // The audit metadata carries overwroteObservationIds.
    expect(insertValuesArgs[3]).toMatchObject({
      event: "observation.write",
      metadata: expect.objectContaining({
        overwroteObservationIds: ["existing-1", "existing-2", "existing-3"],
      }) as unknown,
    });
  });

  it("composes labName with deviceCustomName when deviceName='Outro'", async () => {
    const { db, insertValuesArgs } = makeDb({});
    await writeBiaObservations(db, {
      patientId: PATIENT_ID,
      input: {
        ...BASE_INPUT,
        deviceName: "Outro",
        deviceCustomName: "Omron",
        deviceModel: "BF511",
      },
    });
    expect(insertValuesArgs[0]).toMatchObject({ labName: "Omron BF511" });
  });

  it("throws when collectedAt is unparseable (defense-in-depth past Zod)", async () => {
    const { db } = makeDb({});
    await expect(
      writeBiaObservations(db, {
        patientId: PATIENT_ID,
        input: { ...BASE_INPUT, collectedAt: "not-a-date" },
      }),
    ).rejects.toThrow();
  });

  it("R2-P212 — translates PG unique_violation (23505) on the BIA partial index to a `duplicate` response", async () => {
    // R2-P211 — manual_bia inserts can't ON-CONFLICT-no-op because
    // `writeObservation`'s `where` clause excludes them; a race with
    // a concurrent submission raises `unique_violation`. The helper
    // catches SQLSTATE 23505 and surfaces it as a duplicate so the
    // client renders the overwrite modal.
    const selectRows: { id: string }[] = [];
    const selectFn = vi.fn(() => {
      const chain: Record<string, unknown> = {};
      const finalize = Promise.resolve(selectRows);
      chain.from = vi.fn(() => chain);
      chain.where = vi.fn(() => {
        const inner: Record<string, unknown> = {};
        inner.for = vi.fn(() => finalize);
        return inner;
      });
      return chain;
    });
    const insertFn = vi.fn(() => {
      const chain: Record<string, unknown> = {};
      chain.values = vi.fn(() => {
        const err: { code: string } & Error = Object.assign(
          new Error("duplicate key value"),
          { code: "23505" },
        );
        return {
          onConflictDoNothing: vi.fn(() => ({
            returning: vi.fn(() => Promise.reject(err)),
          })),
        };
      });
      return chain;
    });
    const db = {
      select: selectFn,
      update: vi.fn(),
      insert: insertFn,
    } as unknown as AuditDb;

    const result = await writeBiaObservations(db, {
      patientId: PATIENT_ID,
      input: BASE_INPUT,
    });
    expect(result.status).toBe("duplicate");
  });

  it("R2-P212 — non-23505 errors still bubble out (programmer errors aren't translated to duplicate)", async () => {
    const { db } = makeDb({});
    // Force a TypeError mid-insert by tampering with the mock.
    const broken = {
      ...db,
      insert: vi.fn(() => {
        throw new TypeError("downstream crashed");
      }),
    } as unknown as AuditDb;
    await expect(
      writeBiaObservations(broken, {
        patientId: PATIENT_ID,
        input: BASE_INPUT,
      }),
    ).rejects.toThrow(TypeError);
  });

  it("R2-P214 — two devices on the same date both succeed against a shared mock backing store", async () => {
    // R2-P214 — the original R1-P199 test used two independent
    // mocks; both saw an empty queue and trivially passed. This
    // version maintains a shared `rowStore` that records inserts
    // and serves the SELECT-FOR-UPDATE from accumulated state, so
    // the second device's duplicate-detection query actually sees
    // the first device's rows.
    interface StoredRow {
      labName: string;
      collectedAt: string;
      patientId: string;
      source: string;
    }
    const rowStore: StoredRow[] = [];
    let nextInsertId = 0;
    const makeSharedDb = (queryLabName: string): AuditDb => {
      // SELECT returns rows that match the helper's WHERE
      // predicate (patient + date + lab + source + not soft-deleted).
      const matching = rowStore
        .filter(
          (r) =>
            r.patientId === PATIENT_ID &&
            r.collectedAt === BASE_INPUT.collectedAt &&
            r.labName === queryLabName &&
            r.source === "manual_bia",
        )
        .map((_, i) => ({ id: `existing-${i}` }));
      const selectFn = vi.fn(() => {
        const chain: Record<string, unknown> = {};
        chain.from = vi.fn(() => chain);
        chain.where = vi.fn(() => {
          const inner: Record<string, unknown> = {};
          inner.for = vi.fn(() => Promise.resolve(matching));
          return inner;
        });
        return chain;
      });
      const insertFn = vi.fn(() => {
        const chain: Record<string, unknown> = {};
        chain.values = vi.fn((arg: unknown) => {
          const v = arg as {
            labName?: string;
            collectedAt?: string;
            patientId?: string;
            source?: string;
          };
          // Only observation inserts have these fields; audit rows
          // skip storage (we only care about the unique-index sim).
          if (
            v.labName !== undefined &&
            v.collectedAt !== undefined &&
            v.patientId !== undefined &&
            v.source !== undefined
          ) {
            rowStore.push({
              labName: v.labName,
              collectedAt: v.collectedAt,
              patientId: v.patientId,
              source: v.source,
            });
          }
          nextInsertId += 1;
          const id = `obs-${nextInsertId}`;
          return {
            onConflictDoNothing: vi.fn(() => ({
              returning: vi.fn(() => Promise.resolve([{ id }])),
            })),
          };
        });
        return chain;
      });
      return {
        select: selectFn,
        update: vi.fn(),
        insert: insertFn,
      } as unknown as AuditDb;
    };

    const r1 = await writeBiaObservations(makeSharedDb("InBody 770"), {
      patientId: PATIENT_ID,
      input: { ...BASE_INPUT, deviceName: "InBody", deviceModel: "770" },
    });
    expect(r1.status).toBe("created");
    // Second device — the shared `rowStore` now contains 3 manual_bia
    // rows from the first submission, but the duplicate-detection
    // scope is keyed on `lab_name` so "Tanita BC-558" sees zero
    // matches and proceeds to write.
    const r2 = await writeBiaObservations(makeSharedDb("Tanita BC-558"), {
      patientId: PATIENT_ID,
      input: { ...BASE_INPUT, deviceName: "Tanita", deviceModel: "BC-558" },
    });
    expect(r2.status).toBe("created");
    // 6 manual_bia rows total in the shared store (3 per submission).
    const manualBiaRows = rowStore.filter((r) => r.source === "manual_bia");
    expect(manualBiaRows).toHaveLength(6);
    expect(
      manualBiaRows.filter((r) => r.labName === "InBody 770"),
    ).toHaveLength(3);
    expect(
      manualBiaRows.filter((r) => r.labName === "Tanita BC-558"),
    ).toHaveLength(3);
  });
});
