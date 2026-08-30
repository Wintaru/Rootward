// @ts-check
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import prettier from "eslint-config-prettier/flat";

/**
 * Shared flat ESLint config for the pure-TypeScript packages (`packages/*`).
 * `apps/web` uses its own config because it needs the Next.js plugin.
 *
 * @param {string} tsconfigRootDir - the consuming package directory
 *   (`import.meta.dirname`), so type-aware linting resolves that package's
 *   `tsconfig.json`.
 */
export default function baseConfig(tsconfigRootDir) {
  return tseslint.config(
    { ignores: ["dist/**", "coverage/**", "eslint.config.mjs"] },
    js.configs.recommended,
    ...tseslint.configs.recommendedTypeChecked,
    {
      languageOptions: {
        parserOptions: { projectService: true, tsconfigRootDir },
      },
      rules: {
        "@typescript-eslint/no-explicit-any": "error",
        "@typescript-eslint/no-floating-promises": "error",
        "@typescript-eslint/no-non-null-assertion": "error",
        // WAYFINDER decision 8: packages/* stay pure TypeScript so a C# port
        // stays possible. No Node or Deno built-ins.
        "no-restricted-imports": [
          "error",
          {
            patterns: [
              {
                group: ["node:*"],
                message: "No Node built-ins (WAYFINDER decision 8).",
              },
              {
                group: ["https://deno.land/*", "jsr:*"],
                message: "No Deno imports (WAYFINDER decision 8).",
              },
            ],
          },
        ],
      },
    },
    prettier,
  );
}
