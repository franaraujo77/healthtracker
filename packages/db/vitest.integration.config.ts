import { defineConfig } from "vitest/config";

/**
 * Testcontainer-driven integration tests. Each suite spins up a
 * fresh Postgres container; do NOT run in parallel — Docker resource
 * pressure makes that flakier than serial execution.
 *
 * Requires Docker running locally / in CI. See
 * `__tests__/integration/setup.ts` for bootstrap details.
 */
export default defineConfig({
  test: {
    include: ["__tests__/integration/**/*.integration.test.ts"],
    testTimeout: 120_000,
    hookTimeout: 120_000,
    fileParallelism: false,
  },
});
