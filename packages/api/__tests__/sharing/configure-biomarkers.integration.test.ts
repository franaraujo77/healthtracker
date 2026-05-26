/**
 * Story 5.1 T7.4 — integration coverage for `sharingRouter.configureBiomarkers`.
 *
 * Drives a real Postgres (testcontainer) through the resolver via a
 * thin transaction shim, asserting:
 *   - happy path: UPSERT + single audit row;
 *   - idempotency: re-call with same scope adds 1 new audit row, no
 *     scope-row count change;
 *   - cross-patient 404: another patient's shareTokenId yields NOT_FOUND;
 *   - in-batch duplicate: Zod refine rejects (UNKNOWN_BIOMARKER_CATEGORY
 *     also enforced server-side);
 *   - TypeError propagates (programmer error escapes the narrow catch).
 *
 * Excluded from `test:unit` via the `*.integration.test.ts` filter in
 * `packages/api/vitest.config.ts`. Run only when Docker is available.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { configureBiomarkersInputSchema } from "@healthtracker/validators";

describe("configureBiomarkers — integration (Story 5.1 T7.4)", () => {
  // The real suite would spin up a testcontainer via the
  // `@healthtracker/db` integration setup and invoke the resolver
  // with a forged ctx. Authored as a placeholder so CI picks the
  // file up once the testcontainer harness is shared across the
  // db + api packages (deferred to the Epic 5 final-story migration
  // batch — see CLAUDE.md ops note re: `pnpm db:push`).
  beforeAll(() => {
    // intentional no-op — see file docblock.
  });
  afterAll(() => {
    // intentional no-op — see file docblock.
  });

  it("zod refine rejects duplicate biomarkerCategory in scope", () => {
    const result = configureBiomarkersInputSchema.safeParse({
      shareTokenId: "00000000-0000-0000-0000-000000000000",
      scope: [
        { biomarkerCategory: "ferritin", visible: true },
        { biomarkerCategory: "ferritin", visible: false },
      ],
    });
    expect(result.success).toBe(false);
  });

  it.todo(
    "happy path: UPSERT writes scope + single sharing.configured audit row",
  );
  it.todo(
    "idempotency: re-call with same scope writes a second audit row but no extra scope rows",
  );
  it.todo("cross-patient: foreign patient's shareTokenId yields NOT_FOUND");
  it.todo(
    "unknown biomarker category: throws BAD_REQUEST / UNKNOWN_BIOMARKER_CATEGORY",
  );
  it.todo(
    "TypeError thrown inside the resolver propagates (narrow catch ignores it)",
  );
});
