import type { Page } from "@playwright/test";

import {
  fixtureIds,
  fixtureNames,
  FIXTURE_SURNAME,
} from "../support/fixture-data";
import { openSignOut } from "../support/auth";
import { expect, test } from "../support/test";

/**
 * The global chrome (SPEC §8.1 "Global chrome", issue #50): which links each
 * access level gets, the person search box (#62), and sign-out.
 *
 * The header renders its links twice — once in a `<details>` menu for phone
 * width, once inline for `sm` and up — so every link assertion is scoped to
 * the visible one rather than matching both.
 */

function nav(page: Page) {
  return page.getByRole("navigation", { name: "Main" }).last();
}

const EXPECTED_LINKS = {
  viewer: ["Home", "My record"],
  moderator: ["Home", "New person", "Import / Export", "Moderation"],
  admin: ["Home", "New person", "Import / Export", "Moderation", "Settings"],
} as const;

test.describe("header links", () => {
  test("a viewer gets Home and My record only", async ({ viewerPage }) => {
    await viewerPage.goto("/people");
    for (const label of EXPECTED_LINKS.viewer) {
      await expect(
        nav(viewerPage).getByRole("link", { name: label }),
      ).toBeVisible();
    }
    for (const label of [
      "Import / Export",
      "Moderation",
      "Settings",
      "New person",
    ]) {
      await expect(
        nav(viewerPage).getByRole("link", { name: label }),
      ).toHaveCount(0);
    }
  });

  test("a moderator gets the moderator links but not Settings", async ({
    moderatorPage,
  }) => {
    await moderatorPage.goto("/people");
    for (const label of EXPECTED_LINKS.moderator) {
      await expect(
        nav(moderatorPage).getByRole("link", { name: label }),
      ).toBeVisible();
    }
    await expect(
      nav(moderatorPage).getByRole("link", { name: "Settings" }),
    ).toHaveCount(0);
  });

  test("an admin gets every link", async ({ adminPage }) => {
    await adminPage.goto("/people");
    for (const label of EXPECTED_LINKS.admin) {
      await expect(
        nav(adminPage).getByRole("link", { name: label }),
      ).toBeVisible();
    }
  });

  test("a moderator with no claimed person gets no My record link", async ({
    moderatorPage,
  }) => {
    await moderatorPage.goto("/people");
    await expect(
      nav(moderatorPage).getByRole("link", { name: "My record" }),
    ).toHaveCount(0);
  });

  test("Home routes an approved member to the tree", async ({ viewerPage }) => {
    await viewerPage.goto("/people");
    await nav(viewerPage).getByRole("link", { name: "Home" }).click();
    await expect(viewerPage).toHaveURL(/\/tree\//);
  });
});

test.describe("the person search box", () => {
  test("shows matches as you type", async ({ viewerPage }) => {
    await viewerPage.goto("/people");
    await viewerPage.getByLabel("Search for a person").fill(FIXTURE_SURNAME);
    const results = viewerPage.getByRole("listbox", { name: "Search results" });
    await expect(results).toBeVisible();
    await expect(
      results.getByRole("link", { name: new RegExp(fixtureNames.grandfather) }),
    ).toBeVisible();
  });

  test("opens the person it is told to", async ({ viewerPage }) => {
    await viewerPage.goto("/people");
    await viewerPage.getByLabel("Search for a person").fill("Gideon");
    const results = viewerPage.getByRole("listbox", { name: "Search results" });
    await results.getByRole("link").first().click();
    await expect(
      viewerPage.getByRole("heading", {
        level: 1,
        name: fixtureNames.grandfather,
      }),
    ).toBeVisible();
  });

  test("Enter goes to the browse page with the query kept", async ({
    viewerPage,
  }) => {
    await viewerPage.goto("/people");
    await viewerPage.getByLabel("Search for a person").fill(FIXTURE_SURNAME);
    await viewerPage.getByLabel("Search for a person").press("Enter");
    await expect(viewerPage).toHaveURL(
      new RegExp(`/people\\?q=${FIXTURE_SURNAME}`),
    );
    await expect(viewerPage.getByLabel("Filter by name")).toHaveValue(
      FIXTURE_SURNAME,
    );
  });

  test("says so when nothing matches", async ({ viewerPage }) => {
    await viewerPage.goto("/people");
    await viewerPage
      .getByLabel("Search for a person")
      .fill("zzzznobodyhasthisname");
    await expect(viewerPage.getByText("No matches yet.")).toBeVisible();
  });

  /**
   * BUG-002 regression. `nameIlikeFilter` applies the whole query as one
   * `ILIKE` pattern to `given_name`, `surname`, and `nickname` separately, so
   * no single column ever contains "given surname". Typing the name exactly
   * as every list and profile heading prints it returns nothing — the most
   * obvious way to use a search box is the one way that cannot work.
   */
  test("finds a person by the full name the app displays", async ({
    viewerPage,
  }) => {
    await viewerPage.goto("/people");
    await viewerPage
      .getByLabel("Search for a person")
      .fill(fixtureNames.grandfather);
    const results = viewerPage.getByRole("listbox", { name: "Search results" });
    await expect(results).toBeVisible();
    await expect(
      results.getByRole("link", { name: new RegExp(fixtureNames.grandfather) }),
      "searching a person's displayed full name must find that person",
    ).toBeVisible();
  });

  test("does not leak a hidden person", async ({ viewerPage }) => {
    await viewerPage.goto("/people");
    await viewerPage.getByLabel("Search for a person").fill("Hilda");
    await expect(
      viewerPage.getByRole("listbox", { name: "Search results" }),
    ).toBeVisible();
    await expect(viewerPage.getByText(fixtureNames.hidden)).toHaveCount(0);
  });
});

test.describe("sign out", () => {
  // Since #79 the sign-out lives in the account chip's menu; the chip is on
  // every signed-in route and the item appears once the menu is open.
  test("is offered on every signed-in route", async ({ adminPage }) => {
    for (const path of ["/people", "/settings", "/moderation", "/import"]) {
      await adminPage.goto(path);
      await expect(await openSignOut(adminPage)).toBeVisible();
      await adminPage.keyboard.press("Escape");
    }
  });

  test("is offered to a pending member too", async ({ pendingPage }) => {
    await pendingPage.goto("/onboarding");
    await expect(await openSignOut(pendingPage)).toBeVisible();
  });
});

test.describe("unknown routes", () => {
  test("a bad person id 404s rather than erroring", async ({ viewerPage }) => {
    const response = await viewerPage.goto("/person/not-a-uuid");
    expect(response?.status()).toBe(404);
  });

  test("a bad tree id 404s rather than erroring", async ({ viewerPage }) => {
    const response = await viewerPage.goto("/tree/not-a-uuid");
    expect(response?.status()).toBe(404);
  });

  test("a bad media id 404s rather than erroring", async ({ viewerPage }) => {
    const response = await viewerPage.goto("/media/not-a-uuid");
    expect(response?.status()).toBe(404);
  });

  test("an unknown path 404s", async ({ viewerPage }) => {
    const response = await viewerPage.goto("/no-such-page");
    expect(response?.status()).toBe(404);
  });
});

test.describe("back-button behaviour", () => {
  test("walks back through profile navigation", async ({ viewerPage }) => {
    await viewerPage.goto(`/person/${fixtureIds.grandfather}`);
    await viewerPage
      .getByRole("link", { name: fixtureNames.viewerPerson })
      .first()
      .click();
    await expect(viewerPage).toHaveURL(
      new RegExp(`/person/${fixtureIds.viewerPerson}$`),
    );
    await viewerPage.goBack();
    await expect(viewerPage).toHaveURL(
      new RegExp(`/person/${fixtureIds.grandfather}$`),
    );
  });
});

/**
 * BUG-002 also reaches `/people`: its filter box calls the same
 * `nameIlikeFilter`, so the browse page cannot find a full name either.
 */
test.describe("the /people filter", () => {
  test("finds a person by the full name the app displays", async ({
    viewerPage,
  }) => {
    await viewerPage.goto(
      `/people?q=${encodeURIComponent(fixtureNames.grandfather)}`,
    );
    await expect(
      viewerPage.getByRole("link", { name: fixtureNames.grandfather }),
      "filtering by a person's displayed full name must find that person",
    ).toBeVisible();
  });
});
