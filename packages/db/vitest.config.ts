import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    exclude: [
      "__tests__/rls/**",
      "__tests__/integration/**",
      "**/node_modules/**",
    ],
    globals: true,
    passWithNoTests: true,
    testTimeout: 30_000,
  },
});
