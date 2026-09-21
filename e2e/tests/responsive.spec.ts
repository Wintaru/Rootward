import type { Page } from "@playwright/test";

import { fixtureIds, fixtureMediaId } from "../support/fixture-data";
import { openSignOut } from "../support/auth";
import { expect, test } from "../support/test";

/**
 * Every route is usable at 390 px wide (SPEC §8.1, issue #65).
 *
 * This file runs under the `mobile` project (a Pixel 7), so the viewport is
 * already narrow. "Usable" is checked two ways: the page's own content is
 * reachable, and nothing forces a horizontal scroll — a wide table or an
 * unwrapped header is the usual way a phone layout breaks.
 */

/**
 * Grouped by role rather than carrying a role field per route: destructuring
 * `viewerPage`, `moderatorPage` and `adminPage` in one test body would make
 * Playwright build all three signed-in contexts for every route, three times
 * the browser work for one page under test.
 */
const VIEWER_ROUTES = [
  "/people",
  `/person/${fixtureIds.grandfather}`,
  `/tree/${fixtureIds.viewerPerson}`,
  `/media/${fixtureMediaId}`,
];

const MODERATOR_ROUTES = [
  "/moderation",
  "/import",
  "/person/new",
  `/person/${fixtureIds.grandfather}/edit`,
];

const ADMIN_ROUTES = ["/settings", "/settings?tab=tree", "/settings?tab=roles"];

/**
 * The page must not scroll sideways. The tree view is the documented
 * exception: it is a pannable canvas, so its own viewport scrolls by design.
 */
async function hasHorizontalOverflow(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const doc = document.documentElement;
    return doc.scrollWidth > doc.clientWidth + 1;
  });
}

async function assertFitsPhone(page: Page, path: string): Promise<void> {
  const response = await page.goto(path);
  expect(response?.status()).toBe(200);
  await expect(
    page.getByRole("main").or(page.locator(".rw-tree-viewport")).first(),
  ).toBeVisible();

  if (!path.startsWith("/tree/")) {
    expect(
      await hasHorizontalOverflow(page),
      `${path} scrolls sideways at phone width`,
    ).toBe(false);
  }
}

for (const path of VIEWER_ROUTES) {
  test(`${path} fits a phone screen`, async ({ viewerPage }) => {
    await assertFitsPhone(viewerPage, path);
  });
}

for (const path of MODERATOR_ROUTES) {
  test(`${path} fits a phone screen`, async ({ moderatorPage }) => {
    await assertFitsPhone(moderatorPage, path);
  });
}

for (const path of ADMIN_ROUTES) {
  test(`${path} fits a phone screen`, async ({ adminPage }) => {
    await assertFitsPhone(adminPage, path);
  });
}

test.describe("the phone header", () => {
  test("collapses the nav behind a Menu disclosure", async ({ adminPage }) => {
    await adminPage.goto("/people");
    const menu = adminPage.locator('summary[aria-label="Menu"]');
    await expect(menu).toBeVisible();

    // Closed to begin with: the links must not be taking up the header.
    await expect(
      adminPage.getByRole("link", { name: "Settings" }),
    ).toBeHidden();

    await menu.click();
    await expect(
      adminPage.getByRole("link", { name: "Settings" }),
    ).toBeVisible();
  });

  test("closes the menu after following a link", async ({ adminPage }) => {
    await adminPage.goto("/people");
    await adminPage.locator('summary[aria-label="Menu"]').click();
    await adminPage.getByRole("link", { name: "Moderation" }).click();
    await expect(adminPage).toHaveURL(/\/moderation$/);
    await expect(
      adminPage.getByRole("link", { name: "Settings" }),
    ).toBeHidden();
  });

  test("keeps sign-out reachable", async ({ viewerPage }) => {
    await viewerPage.goto("/people");
    // The chip shows initials only at this width; its menu still opens.
    await expect(await openSignOut(viewerPage)).toBeVisible();
  });
});

test.describe("the phone edit view", () => {
  test("keeps the section rail reachable", async ({ moderatorPage }) => {
    await moderatorPage.goto(`/person/${fixtureIds.grandfather}/edit`);
    const rail = moderatorPage.getByRole("navigation", {
      name: "Edit sections",
    });
    await expect(rail).toBeVisible();
    await rail.getByRole("link", { name: "Events" }).click();
    await expect(
      moderatorPage.getByRole("heading", { level: 2, name: "Events" }),
    ).toBeVisible();
  });
});
