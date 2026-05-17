import { defineWorkspace } from "vitest/config";

export default defineWorkspace([
  "packages/*/vitest.config.ts",
  // apps/expo is excluded — uses Jest via React Native tooling
  // apps/web has no unit tests yet; add apps/web/vitest.config.ts when needed
]);
