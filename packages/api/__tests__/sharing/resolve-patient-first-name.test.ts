/**
 * Story 6.1 R1-N1 — `resolvePatientFirstName` contract guard.
 *
 * The resolver wraps this helper in a defensive `try/catch` (R1
 * reviewer flagged it as dead-code-guard-adjacent). The right answer
 * per CLAUDE.md is to PIN the contract with tests so the defensive
 * catch becomes provably-belt-and-suspenders, not silently-load-bearing.
 *
 * The helper MUST NOT throw on:
 *   - SDK rejection (non-programmer error → return null);
 *   - SDK returning `{ error }` (return null);
 *   - SDK returning no user (return null);
 *   - SDK returning empty email (return null);
 *   - SDK returning malformed email shapes (return null or best-effort).
 *
 * The helper MUST RE-THROW programmer errors (TypeError, ReferenceError,
 * SyntaxError) — Epic 2 retro narrow-catch discipline.
 */
import { describe, expect, it } from "vitest";

import { resolvePatientFirstName } from "../../src/sharing";

const PID = "00000000-0000-4000-8000-000000000001";

type AdminStub = Parameters<typeof resolvePatientFirstName>[0];

function stubReturning(
  result: Awaited<ReturnType<AdminStub["auth"]["admin"]["getUserById"]>>,
): AdminStub {
  return {
    auth: {
      admin: {
        getUserById: () => Promise.resolve(result),
      },
    },
  };
}

function stubRejecting(err: Error): AdminStub {
  return {
    auth: {
      admin: {
        getUserById: () => Promise.reject(err),
      },
    },
  };
}

describe("resolvePatientFirstName — never throws on SDK / data failures", () => {
  it("SDK rejects with a generic Error → returns null", async () => {
    const result = await resolvePatientFirstName(
      stubRejecting(new Error("network down")),
      PID,
    );
    expect(result).toBeNull();
  });

  it("SDK returns { error: {...} } → returns null", async () => {
    const result = await resolvePatientFirstName(
      stubReturning({
        data: { user: null },
        error: { message: "user not found" },
      }),
      PID,
    );
    expect(result).toBeNull();
  });

  it("SDK returns no user → returns null", async () => {
    const result = await resolvePatientFirstName(
      stubReturning({ data: { user: null }, error: null }),
      PID,
    );
    expect(result).toBeNull();
  });

  it("SDK returns user without email → returns null", async () => {
    const result = await resolvePatientFirstName(
      stubReturning({ data: { user: {} }, error: null }),
      PID,
    );
    expect(result).toBeNull();
  });

  it("SDK returns empty email → returns null", async () => {
    const result = await resolvePatientFirstName(
      stubReturning({ data: { user: { email: "" } }, error: null }),
      PID,
    );
    expect(result).toBeNull();
  });

  it("happy path — humanises the email local-part", async () => {
    const result = await resolvePatientFirstName(
      stubReturning({
        data: { user: { email: "francis.araujo@x.com" } },
        error: null,
      }),
      PID,
    );
    expect(result).toBe("Francis Araujo");
  });
});

describe("resolvePatientFirstName — re-throws programmer errors (narrow catch)", () => {
  it("TypeError propagates", async () => {
    await expect(
      resolvePatientFirstName(stubRejecting(new TypeError("bad arg")), PID),
    ).rejects.toBeInstanceOf(TypeError);
  });

  it("ReferenceError propagates", async () => {
    await expect(
      resolvePatientFirstName(
        stubRejecting(new ReferenceError("x is not defined")),
        PID,
      ),
    ).rejects.toBeInstanceOf(ReferenceError);
  });

  it("SyntaxError propagates", async () => {
    await expect(
      resolvePatientFirstName(stubRejecting(new SyntaxError("nope")), PID),
    ).rejects.toBeInstanceOf(SyntaxError);
  });
});
