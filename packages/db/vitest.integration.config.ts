import { defineConfig } from "vitest/config";

/**
 * Testcontainer-driven integration tests. Each suite spins up a
 * fresh Postgres container; do NOT run in parallel — Docker resource
 * pressure makes that flakier than serial execution.
 *
 * Requires a container runtime running locally / in CI. See
 * `__tests__/integration/setup.ts` for bootstrap details. `globalSetup`
 * auto-detects Rancher Desktop / colima / OrbStack so the suite runs
 * without a hand-set `DOCKER_HOST` (Docker Desktop / CI are unaffected).
 */
export default defineConfig({
  test: {
    include: ["__tests__/integration/**/*.integration.test.ts"],
    globalSetup: ["__tests__/integration/global-setup.ts"],
    testTimeout: 120_000,
    hookTimeout: 120_000,
    fileParallelism: false,
  },
});
