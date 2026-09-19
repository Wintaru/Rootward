import type { Page } from "@playwright/test";

import { fixtureIds, fixtureNames } from "../support/fixture-data";
import { expect, test } from "../support/test";

/**
 * `/tree/[personId]` — the hourglass view (SPEC §8.2, decisions 23 and 28).
 *
 * `family-chart` renders its cards by injecting HTML rather than mounting
 * components, so the cards are addressed through the `data-*` hooks
 * `lib/tree/person-card.ts` writes (`data-person-id`, `data-open-profile`,
 * `data-expand-relation`) — those attributes are the component's contract
 * with `FamilyTree`'s delegated listeners, not incidental markup.
 */

const card = (page: Page, personId: string) =>
  page.locator(`[data-person-id="${personId}"]`);

test.describe("the tree view", () => {
  test("draws the focus person and their relatives", async ({ viewerPage }) => {
    await viewerPage.goto(`/tree/${fixtureIds.viewerPerson}`);
    await expect(card(viewerPage, fixtureIds.viewerPerson)).toBeVisible();
    await expect(card(viewerPage, fixtureIds.grandfather)).toBeVisible();
    await expect(card(viewerPage, fixtureIds.grandmother)).toBeVisible();
    await expect(card(viewerPage, fixtureIds.child)).toBeVisible();
  });

  test("shows a name and lifespan on each card", async ({ viewerPage }) => {
    await viewerPage.goto(`/tree/${fixtureIds.grandfather}`);
    const focus = card(viewerPage, fixtureIds.grandfather);
    await expect(focus).toContainText(fixtureNames.grandfather);
    await expect(focus).toContainText("1901");
  });

  test("re-centres when another card is clicked", async ({ viewerPage }) => {
    await viewerPage.goto(`/tree/${fixtureIds.viewerPerson}`);
    await card(viewerPage, fixtureIds.grandfather).click();
    await expect(viewerPage).toHaveURL(
      new RegExp(`/tree/${fixtureIds.grandfather}`),
    );
  });

  test("the back button walks focus history (decision 28)", async ({
    viewerPage,
  }) => {
    await viewerPage.goto(`/tree/${fixtureIds.viewerPerson}`);
    await card(viewerPage, fixtureIds.grandfather).click();
    await expect(viewerPage).toHaveURL(
      new RegExp(`/tree/${fixtureIds.grandfather}`),
    );
    await viewerPage.goBack();
    await expect(viewerPage).toHaveURL(
      new RegExp(`/tree/${fixtureIds.viewerPerson}`),
    );
  });

  test("opens the profile from a card's icon button (#52)", async ({
    viewerPage,
  }) => {
    await viewerPage.goto(`/tree/${fixtureIds.viewerPerson}`);
    await viewerPage
      .locator(`[data-open-profile="${fixtureIds.grandfather}"]`)
      .click();
    await expect(viewerPage).toHaveURL(
      new RegExp(`/person/${fixtureIds.grandfather}`),
    );
  });

  test("a double-click on the card body opens the profile", async ({
    viewerPage,
  }) => {
    await viewerPage.goto(`/tree/${fixtureIds.viewerPerson}`);
    await card(viewerPage, fixtureIds.child).dblclick();
    await expect(viewerPage).toHaveURL(
      new RegExp(`/person/${fixtureIds.child}`),
    );
  });

  test("never draws a card for a person the viewer cannot see", async ({
    viewerPage,
  }) => {
    await viewerPage.goto(`/tree/${fixtureIds.viewerPerson}`);
    await expect(card(viewerPage, fixtureIds.viewerPerson)).toBeVisible();
    for (const hiddenId of [
      fixtureIds.hidden,
      fixtureIds.moderatorsOnly,
      fixtureIds.closeFamily,
    ]) {
      await expect(card(viewerPage, hiddenId)).toHaveCount(0);
    }
  });

  test("a moderator does see the restricted siblings", async ({
    moderatorPage,
  }) => {
    // Centred on their father, every child is drawn — including the three
    // restricted ones, which is the RLS half of this working.
    await moderatorPage.goto(`/tree/${fixtureIds.grandfather}`);
    await expect(card(moderatorPage, fixtureIds.hidden)).toBeVisible();
    await expect(card(moderatorPage, fixtureIds.moderatorsOnly)).toBeVisible();
    await expect(card(moderatorPage, fixtureIds.closeFamily)).toBeVisible();
  });

  /**
   * BUG-006 regression. `get_neighborhood` fetches the focus person's
   * siblings on purpose — the migration says so, `neighborhood.ts` says so,
   * and SPEC §8.2 lists them in the payload — and the RPC really does return
   * them (generation 0). The ids even reach the browser. But the chart draws
   * only ancestors, descendants, and partners, so standing on your own
   * record your brothers and sisters are missing; you have to walk up to a
   * parent to find them.
   */
  test("draws the focus person's siblings", async ({ moderatorPage }) => {
    await moderatorPage.goto(`/tree/${fixtureIds.viewerPerson}`);
    await expect(card(moderatorPage, fixtureIds.viewerPerson)).toBeVisible();
    await expect(
      card(moderatorPage, fixtureIds.hidden),
      "the neighborhood query fetches the focus person's siblings — they must be drawn",
    ).toBeVisible();
  });
});

test.describe("the depth controls", () => {
  test("offer an ancestors and a descendants stepper", async ({
    viewerPage,
  }) => {
    await viewerPage.goto(`/tree/${fixtureIds.viewerPerson}`);
    const group = viewerPage.getByRole("group", { name: "Generations shown" });
    await expect(group).toBeVisible();
    await expect(
      group.getByRole("button", { name: "More ancestors" }),
    ).toBeVisible();
    await expect(
      group.getByRole("button", { name: "Fewer descendants" }),
    ).toBeVisible();
  });

  test("put the override in the URL", async ({ viewerPage }) => {
    await viewerPage.goto(`/tree/${fixtureIds.viewerPerson}`);
    await viewerPage.getByRole("button", { name: "More ancestors" }).click();
    await expect(viewerPage).toHaveURL(/[?&]up=3/);
  });

  test("offer a reset once the depth differs from the default", async ({
    viewerPage,
  }) => {
    await viewerPage.goto(`/tree/${fixtureIds.viewerPerson}`);
    await viewerPage.getByRole("button", { name: "More ancestors" }).click();
    const reset = viewerPage.getByRole("button", { name: "Reset" });
    await expect(reset).toBeVisible();
    await reset.click();
    await expect(viewerPage).not.toHaveURL(/up=3/);
  });

  test("read an override straight from the URL", async ({ viewerPage }) => {
    await viewerPage.goto(`/tree/${fixtureIds.viewerPerson}?up=1&down=1`);
    const group = viewerPage.getByRole("group", { name: "Generations shown" });
    await expect(group).toContainText("1");
    await expect(
      viewerPage.getByRole("button", { name: "Reset" }),
    ).toBeVisible();
  });

  test("clamp a nonsense depth rather than erroring", async ({
    viewerPage,
  }) => {
    const response = await viewerPage.goto(
      `/tree/${fixtureIds.viewerPerson}?up=999&down=-4`,
    );
    expect(response?.status()).toBe(200);
    await expect(card(viewerPage, fixtureIds.viewerPerson)).toBeVisible();
  });

  test("clamp a non-numeric depth rather than erroring", async ({
    viewerPage,
  }) => {
    const response = await viewerPage.goto(
      `/tree/${fixtureIds.viewerPerson}?up=abc&down=`,
    );
    expect(response?.status()).toBe(200);
    await expect(card(viewerPage, fixtureIds.viewerPerson)).toBeVisible();
  });
});

test.describe("the tree index", () => {
  test("redirects to a person", async ({ viewerPage }) => {
    await viewerPage.goto("/tree");
    await expect(viewerPage).toHaveURL(/\/tree\/[0-9a-f-]{36}/);
  });
});

test.describe("the generation bands", () => {
  test("label the focus generation", async ({ viewerPage }) => {
    await viewerPage.goto(`/tree/${fixtureIds.viewerPerson}`);
    await expect(card(viewerPage, fixtureIds.viewerPerson)).toBeVisible();
    await expect(
      viewerPage.locator("svg").getByText(/Root Generation/),
    ).toBeVisible();
  });
});
