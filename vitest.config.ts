import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

export default defineConfig({
  // `packages/*` ship no build output during CI (typecheck/lint/test only), so
  // resolve cross-package imports to source. Keep this in step with the `paths`
  // entries in each package `tsconfig.json`.
  resolve: {
    alias: {
      "@rootward/shared": fileURLToPath(
        new URL("./packages/shared/src/index.ts", import.meta.url),
      ),
      // `apps/web` path alias (mirrors its tsconfig `paths`). Trailing slash so
      // it never swallows `@rootward/*` or `@supabase/*`.
      "@/": fileURLToPath(new URL("./apps/web/", import.meta.url)),
    },
  },
  test: {
    include: [
      "packages/*/src/**/*.{test,spec}.ts",
      "apps/web/**/*.{test,spec}.ts",
    ],
    passWithNoTests: true,
  },
});
