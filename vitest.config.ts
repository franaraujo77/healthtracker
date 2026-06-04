import { defineConfig } from "vitest/config";

// Vitest 4 removed the standalone `vitest.workspace.ts` / `defineWorkspace`
// API in favour of `test.projects` declared directly in the root config.
export default defineConfig({
  test: {
    projects: [
      "packages/*/vitest.config.ts",
      // apps/expo is excluded — uses Jest via React Native tooling
      // apps/web has no unit tests yet; add apps/web/vitest.config.ts when needed
    ],
  },
});
