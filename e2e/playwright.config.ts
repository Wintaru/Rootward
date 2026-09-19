import { fileURLToPath } from "node:url";

import { defineConfig, devices } from "@playwright/test";

// The suite talks to the same local stack `pnpm dev` runs, and reads its keys
// from the repo-root `.env`. Load it before anything below touches
// `process.env` (`support/env.ts` throws on a missing value).
process.loadEnvFile?.(fileURLToPath(new URL("../.env", import.meta.url)));

const baseURL = process.env.E2E_BASE_URL ?? "http://localhost:3000";

/**
 * Projects, by blast radius:
 *
 * - `app` — everything a member can do without destroying the tree.
 * - `mobile` — the same app at phone width (SPEC §8.1, issue #65).
 * - `destructive` — wipe-tree and GEDCOM import, which empty the database by
 *   design (SPEC §7, decision 33: only the first import is a plain load).
 *
 * `destructive` is appended only when `E2E_DESTRUCTIVE=1`. A bare
 * `playwright test` runs *every* configured project — `testMatch` chooses
 * which files a project runs, not whether the project runs at all — so
 * leaving it in the list unconditionally would wipe the developer's stack on
 * an ordinary `pnpm test:e2e`. The spec file carries the same guard, so a
 * stale config cannot re-open the hole.
 *
 *     E2E_DESTRUCTIVE=1 pnpm test:e2e --project=destructive
 *
 * Every project needs the dev stack up (`pnpm dev`). `webServer` is
 * deliberately not configured: the stack is shared with other sessions on
 * the machine (CLAUDE.md), so the suite attaches to a running server rather
 * than owning its lifecycle.
 */
const destructiveEnabled = process.env.E2E_DESTRUCTIVE === "1";
export default defineConfig({
  testDir: "./tests",
  outputDir: "./test-results",
  fullyParallel: true,
  forbidOnly: process.env.CI !== undefined,
  retries: process.env.CI !== undefined ? 2 : 0,
  workers: process.env.CI !== undefined ? 2 : 4,
  reporter: [
    ["list"],
    ["html", { outputFolder: "playwright-report", open: "never" }],
    ["json", { outputFile: "test-results/results.json" }],
  ],
  timeout: 60_000,
  expect: { timeout: 10_000 },
  globalSetup: "./support/global-setup.ts",
  globalTeardown: "./support/global-teardown.ts",
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    testIdAttribute: "data-testid",
  },
  projects: [
    {
      name: "app",
      testIgnore: ["**/destructive/**", "**/responsive.spec.ts"],
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "mobile",
      testMatch: ["**/responsive.spec.ts"],
      use: { ...devices["Pixel 7"] },
    },
    ...(destructiveEnabled
      ? [
          {
            name: "destructive",
            testMatch: ["**/destructive/**"],
            fullyParallel: false,
            workers: 1,
            use: { ...devices["Desktop Chrome"] },
          },
        ]
      : []),
  ],
});
