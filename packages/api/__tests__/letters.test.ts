import { describe, expect, it, vi } from "vitest";

import type { SQL } from "@healthtracker/db";
import { PgDialect } from "@healthtracker/db";

import type { AuditDb } from "../src/audit";
import { getLetterForDraw } from "../src/letters";

// Mirror the Drizzle client config in `@healthtracker/db/client` — without
// the snake_case casing, the rendered SQL keeps Drizzle field names in
// camelCase and the predicate assertions below would test the wrong
// shape (and silently pass during a real-world snake_case regression).
const pgDialect = new PgDialect({ casing: "snake_case" });

const PATIENT_ID = "55555555-5555-5555-5555-555555555555";

interface FakeLetterRow {
  id: string;
  status: "queued" | "generating" | "complete" | "failed";
  createdAt: Date;
}

/**
 * Mock the Drizzle chain
 *   `db.select(...).from(...).innerJoin(...).where(...).orderBy(...).limit(...)`
 * used by `getLetterForDraw`. Captures the `.where()` argument so tests
 * can assert load-bearing predicates (patientId, deletedAt filter,
 * labName-null sentinel) are still in place — without these, a future
 * regression dropping `eq(Letters.patientId, ...)` would silently pass.
 */
function makeDb(rows: FakeLetterRow[]) {
  const limitFn = vi.fn(() => Promise.resolve(rows));
  const orderBy = vi.fn(() => ({ limit: limitFn }));
  const whereFn = vi.fn((_predicate: unknown) => ({ orderBy }));
  const innerJoin = vi.fn(() => ({ where: whereFn }));
  const fromChain = { innerJoin };
  const selectFn = vi.fn(() => ({ from: vi.fn(() => fromChain) }));
  return {
    db: { select: selectFn } as unknown as AuditDb,
    selectFn,
    innerJoin,
    whereFn,
    limitFn,
  };
}

/**
 * Render a Drizzle predicate tree to a string so tests can grep for
 * load-bearing invariants without depending on Drizzle's internal AST
 * shape. The predicate that flows into `.where()` is a tagged-template
 * SQL chunk; `String(p)` invokes `Symbol.toPrimitive` / `toString` on
 * the chunk and yields a readable representation that contains every
 * column, value, and the embedded raw-SQL EXISTS subquery.
 */
/**
 * Render the Drizzle predicate to a `{ sql, params }` pair via the real
 * Postgres dialect so tests can assert against the actual SQL the
 * driver would emit (column names in snake_case, bound parameters in
 * positional order). Far more reliable than util.inspect, which only
 * exposes Drizzle's internal AST.
 */
function predicateSql(predicate: unknown): { sql: string; params: unknown[] } {
  const query = pgDialect.sqlToQuery(predicate as SQL);
  return { sql: query.sql, params: query.params };
}

describe("getLetterForDraw", () => {
  it("returns the most recent letter for a draw when status='complete'", async () => {
    const { db } = makeDb([
      {
        id: "letter-newer",
        status: "complete",
        createdAt: new Date("2026-05-01"),
      },
    ]);
    const out = await getLetterForDraw(db, {
      patientId: PATIENT_ID,
      collectedAt: "2026-04-15",
      labName: "Fleury",
    });
    expect(out).toEqual({ letterId: "letter-newer", status: "complete" });
  });

  it("returns the row for every non-complete status (AC4 trigger)", async () => {
    for (const status of ["queued", "generating", "failed"] as const) {
      const { db } = makeDb([
        { id: "letter-x", status, createdAt: new Date("2026-05-01") },
      ]);
      const out = await getLetterForDraw(db, {
        patientId: PATIENT_ID,
        collectedAt: "2026-04-15",
        labName: "",
      });
      expect(out).toEqual({ letterId: "letter-x", status });
    }
  });

  it("returns null when no letter exists for the draw", async () => {
    const { db } = makeDb([]);
    const out = await getLetterForDraw(db, {
      patientId: PATIENT_ID,
      collectedAt: "2026-04-15",
      labName: "Fleury",
    });
    expect(out).toBeNull();
  });

  it("applies LIMIT 1 (AC7 — multi-upload tie-break by createdAt DESC)", async () => {
    const { db, limitFn } = makeDb([
      { id: "letter-A", status: "complete", createdAt: new Date() },
    ]);
    await getLetterForDraw(db, {
      patientId: PATIENT_ID,
      collectedAt: "2026-04-15",
      labName: "Fleury",
    });
    expect(limitFn).toHaveBeenCalledOnce();
  });

  // ---------------------------------------------------------------
  // Code-review F5 — predicate-shape assertions. The chain-pass-through
  // mocks don't validate what predicate is actually built; these tests
  // capture `.where()` arguments and assert the load-bearing invariants
  // are still present. Each invariant maps to a real risk: cross-patient
  // leakage, soft-deleted-observation leakage, sentinel mishandling.
  // ---------------------------------------------------------------

  it("passes the patientId into the WHERE clause (cross-patient leak defense)", async () => {
    const { db, whereFn } = makeDb([]);
    await getLetterForDraw(db, {
      patientId: PATIENT_ID,
      collectedAt: "2026-04-15",
      labName: "Fleury",
    });
    expect(whereFn).toHaveBeenCalledOnce();
    const predicate = whereFn.mock.calls[0]?.[0];
    const { sql, params } = predicateSql(predicate);
    // Both bound positions must reference the patient — the
    // `Letters.patientId` predicate and the EXISTS subquery's
    // `observations.patient_id` filter. A future regression that
    // drops either occurrence is the cross-patient leak we care
    // about.
    expect(sql).toContain('"letters"."patient_id"');
    const patientOccurrences = params.filter((p) => p === PATIENT_ID).length;
    expect(patientOccurrences).toBeGreaterThanOrEqual(2);
  });

  it("includes an EXISTS subquery filtering observations.deleted_at IS NULL", async () => {
    const { db, whereFn } = makeDb([]);
    await getLetterForDraw(db, {
      patientId: PATIENT_ID,
      collectedAt: "2026-04-15",
      labName: "Fleury",
    });
    const { sql } = predicateSql(whereFn.mock.calls[0]?.[0]);
    expect(sql).toMatch(/exists\s*\(/i);
    expect(sql).toMatch(/"observations"\."deleted_at"\s+is\s+null/i);
    expect(sql).toContain('"observations"."upload_id"');
    expect(sql).toContain('"observations"."patient_id"');
    expect(sql).toContain('"observations"."collected_at"');
  });

  it("renders empty-string labName as `uploads.lab_name IS NULL` (sentinel — not bound as '')", async () => {
    const { db, whereFn } = makeDb([]);
    await getLetterForDraw(db, {
      patientId: PATIENT_ID,
      collectedAt: "2026-04-15",
      labName: "",
    });
    const { sql, params } = predicateSql(whereFn.mock.calls[0]?.[0]);
    expect(sql).toMatch(/"uploads"\."lab_name"\s+is\s+null/i);
    // The empty string is NEVER bound as a parameter — that would
    // be a silent eq("") and would never match a real row.
    expect(params).not.toContain("");
  });

  it("renders a non-empty labName as `uploads.lab_name = $N` with the value bound", async () => {
    const { db, whereFn } = makeDb([]);
    await getLetterForDraw(db, {
      patientId: PATIENT_ID,
      collectedAt: "2026-04-15",
      labName: "Fleury",
    });
    const { sql, params } = predicateSql(whereFn.mock.calls[0]?.[0]);
    expect(sql).toMatch(/"uploads"\."lab_name"\s*=/);
    expect(params).toContain("Fleury");
  });
});
