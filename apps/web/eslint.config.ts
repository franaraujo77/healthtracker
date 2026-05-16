import { defineConfig } from "eslint/config";

import { baseConfig, restrictEnvAccess } from "@healthtracker/eslint-config/base";
import { nextjsConfig } from "@healthtracker/eslint-config/nextjs";
import { reactConfig } from "@healthtracker/eslint-config/react";

export default defineConfig(
  {
    ignores: [".next/**"],
  },
  baseConfig,
  reactConfig,
  nextjsConfig,
  restrictEnvAccess,
);
