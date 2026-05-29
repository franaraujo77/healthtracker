/**
 * Story 5.6 T7.4 — API integration scaffold for
 * `accountRouter.requestDeletion` + `getDeletionStatus`.
 *
 * The synchronous unit-level audit-kind assertion lives here as a
 * deterministic guard against drift between the validators constant
 * and the resolver's `writeAuditLog` call. The full
 * testcontainer-backed integration cases are scaffolded as
 * `it.todo()` per Story 5.5 R1 precedent — adding the suite to the
 * `db:integration` job is a Story 5.7 baseline-migration follow-up.
 */
import { describe, expect, it } from "vitest";

import { ACCOUNT_AUDIT_DELETION_REQUESTED } from "@healthtracker/validators";

describe("accountRouter.requestDeletion — audit-kind synchronization", () => {
  it("constant matches the spec verbatim", () => {
    expect(ACCOUNT_AUDIT_DELETION_REQUESTED).toBe("account.deletion_requested");
  });
});

describe("accountRouter.requestDeletion — integration (testcontainer scaffold)", () => {
  it.todo(
    "INSERTs an account_deletion_requests row + outbox job + audit event in one tx",
  );
  it.todo(
    "returns the same requestId on a concurrent double-tap (partial unique index + 23505 catch)",
  );
  it.todo("does NOT premium-gate (LGPD Art. 18 exemption)");
});

describe("accountRouter.getDeletionStatus — integration (testcontainer scaffold)", () => {
  it.todo("returns NOT_FOUND on cross-patient lookup");
  it.todo("returns the row's status on own lookup");
});
