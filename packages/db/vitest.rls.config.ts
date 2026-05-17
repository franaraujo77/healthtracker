import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["__tests__/rls/**/*.rls.test.ts"],
    testTimeout: 30_000,
  },
});
