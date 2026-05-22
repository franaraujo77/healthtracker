import { describe, expect, it } from "vitest";

import { UPLOAD_TRANSITIONS as WORKER_TRANSITIONS } from "../src/state-machine/upload-transitions.js";

/**
 * Story 2.3 R1-P110 — snapshot-sync test for worker state-machine
 * contract.
 *
 * The worker can't import `packages/api/src/upload-transitions.ts`
 * directly (different Drizzle / postgres-driver connection), so it
 * duplicates the legal-transition arc map. This test pins the
 * worker's map shape so a future change has to update both
 * deliberately.
 *
 * **Limitation**: this test does NOT verify the actual SQL bodies
 * match between worker (`sql\`UPDATE uploads ...\``) and API
 * (Drizzle `.update().set().where()`). Real SQL drift requires
 * integration testing (deferred F103 + F112 — testcontainer or local
 * Supabase).
 */
describe("Story 2.3 R1-P110 — worker / API state-machine snapshot sync", () => {
  it("worker's UPLOAD_TRANSITIONS matches the canonical map", () => {
    expect(WORKER_TRANSITIONS).toEqual({
      queued: ["processing"],
      processing: ["pending_review", "complete", "failed"],
      pending_review: ["complete", "failed"],
      complete: [],
      failed: [],
    });
  });

  it("worker's UPLOAD_TRANSITIONS shape is frozen (regression guard)", () => {
    // Mirrors the API helper's `as const satisfies Record<...>` —
    // adding a new state without updating both files would change
    // the keys() count below.
    const keys = Object.keys(WORKER_TRANSITIONS).sort();
    expect(keys).toEqual([
      "complete",
      "failed",
      "pending_review",
      "processing",
      "queued",
    ]);
  });
});
