import { defineConfig } from "eslint/config";

import { baseConfig, restrictEnvAccess } from "@healthtracker/eslint-config/base";

export default defineConfig(
  {
    ignores: ["script/**"],
  },
  baseConfig,
  restrictEnvAccess,
);
