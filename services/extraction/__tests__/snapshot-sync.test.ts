import { describe, expect, it } from "vitest";

import { UPLOAD_TRANSITIONS as API_TRANSITIONS } from "@healthtracker/api/upload-transitions";

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
describe("Story 2.3 R1-P110 + R2-P129 — worker / API state-machine snapshot sync", () => {
  it("worker's UPLOAD_TRANSITIONS matches the canonical map", () => {
    expect(WORKER_TRANSITIONS).toEqual({
      queued: ["processing"],
      processing: ["pending_review", "complete", "failed"],
      pending_review: ["complete", "failed"],
      complete: [],
      failed: [],
    });
  });

  // R2-P129 — actually compare worker vs API. R1-P110 originally
  // only pinned the worker side. This test catches divergence between
  // `services/extraction/src/state-machine/upload-transitions.ts`
  // and `packages/api/src/upload-transitions.ts` — the canonical
  // source of truth Story 2.1 shipped.
  it("worker's UPLOAD_TRANSITIONS exactly equals the API helper's", () => {
    expect(WORKER_TRANSITIONS).toEqual(API_TRANSITIONS);
  });

  it("worker's UPLOAD_TRANSITIONS shape is frozen (regression guard)", () => {
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
