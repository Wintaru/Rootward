// @ts-check
import baseConfig from "../eslint.config.base.mjs";

/**
 * The e2e suite is Node-only tooling, not shipped code, so it keeps the
 * shared base config minus the "no Node built-ins" rule (WAYFINDER decision 8
 * is about `packages/*` staying portable — this package never ships).
 */
export default [
  ...baseConfig(import.meta.dirname),
  {
    ignores: ["test-results/**", "playwright-report/**", ".auth/**"],
  },
  {
    rules: {
      "no-restricted-imports": "off",
    },
  },
];
