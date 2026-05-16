import { defineConfig } from "eslint/config";

import { baseConfig } from "@healthtracker/eslint-config/base";
import { reactConfig } from "@healthtracker/eslint-config/react";

export default defineConfig(
  {
    ignores: ["dist/**"],
  },
  baseConfig,
  reactConfig,
);
