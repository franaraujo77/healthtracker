import { defineConfig } from "eslint/config";

import { baseConfig } from "@healthtracker/eslint-config/base";
import { reactConfig } from "@healthtracker/eslint-config/react";

export default defineConfig(
  {
    ignores: ["dist/**"],
  },
  baseConfig,
  reactConfig,
  {
    files: ["src/**/*.tsx", "src/**/*.ts"],
    ignores: ["src/theme/**"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector:
            "Literal[value=/^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6}|[0-9A-Fa-f]{8})$/]",
          message:
            "Use a Tamagui semantic token (e.g. '$color.primaryTeal') instead of a hardcoded hex value.",
        },
      ],
    },
  },
);
