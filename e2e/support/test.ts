import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  test as base,
  type Browser,
  type Locator,
  type Page,
} from "@playwright/test";

import { accountSpecs, storageStatePath, type RoleKey } from "./accounts";
import type { TestUser } from "./supabase-admin";

const here = fileURLToPath(new URL(".", import.meta.url));

/**
 * The accounts `global-setup` made, keyed by access level. Read lazily so a
 * test file that never touches an account does not fail on a missing file.
 */
let cached: Readonly<Record<RoleKey, TestUser>> | null = null;

export function accounts(): Readonly<Record<RoleKey, TestUser>> {
  if (cached !== null) {
    return cached;
  }

  const path = resolve(here, "../.auth/accounts.json");
  const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));

  // Checked rather than asserted: a stale or truncated file would otherwise
  // surface as `undefined.userId` deep inside a test, instead of here with
  // the reason and the fix.
  if (typeof parsed !== "object" || parsed === null) {
    throw new Error(
      `${path} is not an object. Re-run the suite to rebuild it.`,
    );
  }
  const directory = parsed as Partial<Record<RoleKey, TestUser>>;
  for (const spec of accountSpecs) {
    if (typeof directory[spec.key]?.userId !== "string") {
      throw new Error(
        `${path} has no user id for "${spec.key}". Re-run the suite to rebuild it.`,
      );
    }
  }

  cached = directory as Readonly<Record<RoleKey, TestUser>>;
  return cached;
}

type RolePages = {
  /** Signed in as an active `admin` (SPEC §9.4). */
  readonly adminPage: Page;
  /** Signed in as an active `moderator`. */
  readonly moderatorPage: Page;
  /** Signed in as an active `viewer`, linked to the fixture person. */
  readonly viewerPage: Page;
  /** Signed in, `status = pending` — belongs on `/onboarding`. */
  readonly pendingPage: Page;
  /** Signed in, `status = suspended`. */
  readonly suspendedPage: Page;
  /** No session at all. */
  readonly anonPage: Page;
};

/**
 * `test` with one ready-made page per access level. Each is its own browser
 * context, restored from the session `global-setup` saved, so a test can
 * compare two roles side by side in the same spec without signing in.
 */
export const test = base.extend<RolePages>({
  adminPage: async ({ browser }, use) => {
    await withRole(browser, "admin", use);
  },
  moderatorPage: async ({ browser }, use) => {
    await withRole(browser, "moderator", use);
  },
  viewerPage: async ({ browser }, use) => {
    await withRole(browser, "viewer", use);
  },
  pendingPage: async ({ browser }, use) => {
    await withRole(browser, "pending", use);
  },
  suspendedPage: async ({ browser }, use) => {
    await withRole(browser, "suspended", use);
  },
  anonPage: async ({ browser }, use) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    try {
      await use(page);
    } finally {
      await context.close();
    }
  },
});

async function withRole(
  browser: Browser,
  key: RoleKey,
  use: (page: Page) => Promise<void>,
): Promise<void> {
  const context = await browser.newContext({
    storageState: resolve(here, "..", storageStatePath(key)),
  });
  const page = await context.newPage();
  try {
    await use(page);
  } finally {
    await context.close();
  }
}

export { expect } from "@playwright/test";

/**
 * The page's own error/status alerts, without Next's route announcer — an
 * always-present, always-empty `<div role="alert" id="__next-route-announcer__">`
 * that otherwise makes every `getByRole("alert")` a strict-mode violation.
 */
export function alerts(page: Page): Locator {
  return page.locator('[role="alert"]:not(#__next-route-announcer__)');
}
