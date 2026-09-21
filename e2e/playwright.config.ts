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
 * - `settings` — the `/settings` screen, which edits the singleton
 *   `tree_settings` row. Every other screen reads that row, so a test that
 *   saves a different default generation depth changes what the tree draws
 *   for whoever is mid-assertion. One worker only serialises this project
 *   against itself — Playwright still schedules projects concurrently — so
 *   `dependencies` is what actually holds it until `app` and `mobile` have
 *   finished.
 *
 *   Playwright skips a project whose dependency *failed*, and this suite
 *   fails on every filed bug until it is fixed, so these tests sit out an
 *   ordinary run while the tree is red. Run them directly for the settings
 *   screen itself:
 *
 *       pnpm test:e2e:settings
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
      testIgnore: [
        "**/destructive/**",
        "**/responsive.spec.ts",
        "**/settings.spec.ts",
      ],
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "mobile",
      testMatch: ["**/responsive.spec.ts"],
      use: { ...devices["Pixel 7"] },
    },
    {
      name: "settings",
      testMatch: ["**/settings.spec.ts"],
      dependencies: ["app", "mobile"],
      fullyParallel: false,
      workers: 1,
      use: { ...devices["Desktop Chrome"] },
    },
    ...(destructiveEnabled
      ? [
          {
            name: "destructive",
            testMatch: ["**/destructive/**"],
            fullyParallel: false,
            workers: 1,
            // A backup export plus a full-size GedZip import; the specs
            // set their own expect timeouts inside this.
            timeout: 1_200_000,
            use: { ...devices["Desktop Chrome"] },
          },
        ]
      : []),
  ],
});
