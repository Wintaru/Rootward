import type { Page } from "@playwright/test";

import { unnamedControls } from "../support/a11y";
import { accountMenuTrigger, signInWithMagicLink } from "../support/auth";
import { fixtureIds, FIXTURE_SURNAME } from "../support/fixture-data";
import { scratchPersons } from "../support/scratch";
import { deleteTestUser, ensureTestUser } from "../support/supabase-admin";
import { expect, test } from "../support/test";

/**
 * Keyboard operation and accessible names across every screen.
 *
 * "The control works" has to include working without a mouse, and being
 * announced as something other than "button". The name audit walks the real
 * DOM rather than trusting a locator: a control Playwright can only find by
 * position is exactly the one a screen reader cannot describe.
 */

const scratch = scratchPersons();

/** Accounts this spec signs in and out on its own, rather than borrowing a
 * shared role session. */
const signedOutAccounts: string[] = [];

test.afterAll(async () => {
  await scratch.remove();
  for (const email of signedOutAccounts) {
    await deleteTestUser(email);
  }
});

/** Presses Tab until `locator` has focus, or gives up. Returns how many
 * presses it took — a control the keyboard cannot reach at all returns
 * `null`. */
async function tabTo(
  page: Page,
  selector: string,
  limit = 40,
): Promise<number | null> {
  for (let presses = 1; presses <= limit; presses += 1) {
    await page.keyboard.press("Tab");
    const focused = await page.evaluate(
      (target) => document.activeElement?.matches(target) ?? false,
      selector,
    );
    if (focused) {
      return presses;
    }
  }
  return null;
}

test.describe("every control has a name", () => {
  const ROUTES = [
    { path: "/people", role: "viewer" },
    { path: `/person/${fixtureIds.grandfather}`, role: "viewer" },
    { path: `/tree/${fixtureIds.grandfather}`, role: "viewer" },
    { path: "/moderation", role: "moderator" },
    { path: "/import", role: "moderator" },
    { path: "/settings", role: "admin" },
  ] as const;

  for (const route of ROUTES) {
    test(`${route.path} announces every control`, async ({
      viewerPage,
      moderatorPage,
      adminPage,
    }) => {
      const page =
        route.role === "viewer"
          ? viewerPage
          : route.role === "moderator"
            ? moderatorPage
            : adminPage;
      await page.goto(route.path);
      await expect(page.getByRole("banner")).toBeVisible();

      expect(await unnamedControls(page)).toEqual([]);
    });
  }

  for (const section of [
    "name-gender",
    "additional-names",
    "relationships",
    "events",
    "facts",
    "media",
    "sources",
    "notes",
    "reference-numbers",
  ]) {
    /**
     * The relationships section fails this today (#118): its role and
     * relation selects render bare, so a screen reader announces six
     * controls as just "combobox".
     */
    test(`the ${section} edit section announces every control`, async ({
      moderatorPage,
    }) => {
      await moderatorPage.goto(
        `/person/${fixtureIds.viewerPerson}/edit?section=${section}`,
      );
      await expect(moderatorPage.getByRole("main")).toBeVisible();

      expect(await unnamedControls(moderatorPage)).toEqual([]);
    });
  }
});

test.describe("keyboard operation", () => {
  test("the sign-in form submits from the keyboard alone", async ({
    anonPage,
  }) => {
    await anonPage.goto("/login");
    await anonPage.getByLabel("Email").focus();
    await anonPage.keyboard.type("e2e-keyboard@rootward.test");
    await anonPage.keyboard.press("Enter");

    await expect(anonPage.getByText("Check your email")).toBeVisible({
      timeout: 20_000,
    });
  });

  test("the people filter submits on Enter", async ({ viewerPage }) => {
    await viewerPage.goto("/people");
    await viewerPage.getByLabel("Filter by name").focus();
    await viewerPage.keyboard.type(FIXTURE_SURNAME);
    await viewerPage.keyboard.press("Enter");

    await expect(viewerPage).toHaveURL(new RegExp(`q=${FIXTURE_SURNAME}`));
  });

  test("the header search is reachable by Tab", async ({ viewerPage }) => {
    await viewerPage.goto("/people");
    await viewerPage.getByRole("banner").click();
    expect(
      await tabTo(viewerPage, 'header input[type="search"], header input'),
    ).not.toBeNull();
  });

  test("a tree card's profile button works from the keyboard", async ({
    viewerPage,
  }) => {
    await viewerPage.goto(`/tree/${fixtureIds.grandfather}`);
    const button = viewerPage.locator(
      `[data-open-profile="${fixtureIds.grandfather}"]`,
    );
    await expect(button).toBeVisible({ timeout: 20_000 });

    await button.focus();
    await viewerPage.keyboard.press("Enter");
    await expect(viewerPage).toHaveURL(
      new RegExp(`/person/${fixtureIds.grandfather}$`),
    );
  });

  test("the edit-section rail is a list of real links", async ({
    moderatorPage,
  }) => {
    await moderatorPage.goto(`/person/${fixtureIds.grandfather}/edit`);
    const rail = moderatorPage.getByRole("navigation", {
      name: "Edit sections",
    });
    await rail.getByRole("link", { name: "Events" }).focus();
    await moderatorPage.keyboard.press("Enter");

    await expect(
      moderatorPage.getByRole("heading", { level: 2, name: "Events" }),
    ).toBeVisible();
  });

  test("the active edit section is marked for assistive tech", async ({
    moderatorPage,
  }) => {
    await moderatorPage.goto(
      `/person/${fixtureIds.grandfather}/edit?section=facts`,
    );
    await expect(
      moderatorPage
        .getByRole("navigation", { name: "Edit sections" })
        .getByRole("link", { name: "Facts" }),
    ).toHaveAttribute("aria-current", "page");
  });

  test("a section's Save can be reached and pressed by keyboard", async ({
    moderatorPage,
  }) => {
    const id = await scratch.create("Keyboardsave");
    await moderatorPage.goto(`/person/${id}/edit`);
    await moderatorPage.getByLabel("Nickname").focus();
    await moderatorPage.keyboard.type("Typed by keyboard");

    const save = moderatorPage.getByRole("button", { name: "Save" });
    await save.focus();
    await moderatorPage.keyboard.press("Enter");
    await expect(moderatorPage.getByText("Saved.")).toBeVisible();
  });

  test("the notification panel opens from the keyboard", async ({
    moderatorPage,
  }) => {
    await moderatorPage.goto("/people");
    await moderatorPage.getByRole("button", { name: /^Notifications/ }).focus();
    await moderatorPage.keyboard.press("Enter");
    await expect(
      moderatorPage.getByRole("dialog", { name: "Notifications" }),
    ).toBeVisible();
  });

  /**
   * Its own account, never a shared role one. The five role contexts all
   * restore the same saved session, so signing one of them out revokes that
   * session's refresh token for every other worker holding it — which is
   * exactly the redirect loop it produced the first time this test used
   * `adminPage`.
   */
  test("sign out is reachable and works without a mouse", async ({
    anonPage,
  }) => {
    const email = "e2e-keyboard-signout@rootward.test";
    signedOutAccounts.push(email);
    await ensureTestUser({
      email,
      role: "viewer",
      status: "active",
      displayName: "E2E Keyboard Sign-out",
    });
    await signInWithMagicLink(anonPage, email);

    // Open the account chip's menu from the keyboard, arrow to "Sign out",
    // and activate it — the item is a submit button in the sign-out form.
    await accountMenuTrigger(anonPage).focus();
    await anonPage.keyboard.press("Enter");
    const signOutItem = anonPage.getByRole("menuitem", { name: "Sign out" });
    await expect(signOutItem).toBeVisible();
    await signOutItem.focus();
    await anonPage.keyboard.press("Enter");
    await anonPage.waitForURL(/\/login/, { timeout: 20_000 });

    // Really gone, not just navigated away from.
    await anonPage.goto("/tree");
    await expect(anonPage).toHaveURL(/\/login(\?|$)/);
  });
});

test.describe("page structure", () => {
  const ROUTES = [
    "/people",
    `/person/${fixtureIds.grandfather}`,
    `/tree/${fixtureIds.grandfather}`,
  ];

  for (const path of ROUTES) {
    // The tree view has none today (#119) — it is the app's landing screen
    // and the only one with no page heading.
    test(`${path} has exactly one level-1 heading`, async ({ viewerPage }) => {
      await viewerPage.goto(path);
      await expect(viewerPage.getByRole("banner")).toBeVisible();
      await expect(viewerPage.getByRole("heading", { level: 1 })).toHaveCount(
        1,
      );
    });
  }

  test("a page has one main region and one banner, not several", async ({
    viewerPage,
  }) => {
    await viewerPage.goto("/people");
    await expect(viewerPage.getByRole("main")).toHaveCount(1);
    await expect(viewerPage.getByRole("banner")).toHaveCount(1);
  });
});
