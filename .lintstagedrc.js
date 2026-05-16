export default {
  "**/*.{js,jsx,ts,tsx,mjs,mts,cjs,cts,json,jsonc,md,mdx,css,yaml,yml}": [
    "pnpm exec prettier --write --ignore-unknown",
  ],
};
