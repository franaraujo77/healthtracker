import { defineConfig } from "vitest/config";

/**
 * Story 2.3 — Vitest config for the extraction worker.
 *
 * Tests in `__tests__/` are excluded from the worker's `tsc` build
 * (`tsconfig.json` rootDir is `src`); vitest uses its own
 * type-stripping pipeline so the test files don't need to be part
 * of the production output.
 */
export default defineConfig({
  test: {
    include: ["__tests__/**/*.test.ts"],
    environment: "node",
  },
});
