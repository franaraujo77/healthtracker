import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    passWithNoTests: true,
    testTimeout: 30_000,
    // *.integration.test.ts files run against testcontainers and live
    // outside the unit suite (Docker required). Mirror the
    // `@healthtracker/db` package's split (see vitest.integration.config.ts).
    exclude: ["**/node_modules/**", "**/dist/**", "**/*.integration.test.ts"],
  },
});
