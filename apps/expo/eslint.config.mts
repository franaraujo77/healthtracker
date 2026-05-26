import { defineConfig } from "eslint/config";

import { baseConfig } from "@healthtracker/eslint-config/base";
import { reactConfig } from "@healthtracker/eslint-config/react";

export default defineConfig(
  {
    ignores: [
      ".expo/**",
      "expo-plugins/**",
      // Test files authored for the day a runner is wired into this
      // package (Story 5.1 T7.7). Excluded from lint until then.
      "**/*.test.ts",
      "**/*.test.tsx",
    ],
  },
  baseConfig,
  reactConfig,
);
