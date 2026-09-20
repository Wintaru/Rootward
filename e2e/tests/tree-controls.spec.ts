import type { Page } from "@playwright/test";

import { fixtureIds, fixtureNames } from "../support/fixture-data";
import { scratchPersons } from "../support/scratch";
import { admin } from "../support/supabase-admin";
import { expect, test } from "../support/test";

/**
 * The tree view's own controls (SPEC §8.2, issues #23, #24, #52).
 *
 * `family-chart` builds each card by injecting an HTML string, so the
 * affordances on a card are plain buttons with `data-expand-relation` /
 * `data-open-profile` hooks rather than React elements. They are located by
 * accessible name here, which is what a person using the page has too.
 *
 * `tree.spec.ts` covers what the tree *draws*; this file covers what happens
 * when each control is pressed.
 */

const MAX_GENERATIONS = 10;

async function openTree(
  page: Page,
  personId: string,
  query = "",
): Promise<void> {
  await page.goto(`/tree/${personId}${query}`);
  await expect(page.locator(`[data-person-id="${personId}"]`)).toBeVisible({
    timeout: 20_000,
  });
}

test.describe("the generation steppers", () => {
  test("are grouped and labelled for a screen reader", async ({
    viewerPage,
  }) => {
    await openTree(viewerPage, fixtureIds.grandfather);
    const group = viewerPage.getByRole("group", { name: "Generations shown" });
    await expect(group).toBeVisible();
    await expect(group.getByText("Ancestors")).toBeVisible();
    await expect(group.getByText("Descendants")).toBeVisible();
  });

  test("More descendants raises the count and the URL", async ({
    viewerPage,
  }) => {
    await openTree(viewerPage, fixtureIds.grandfather, "?up=2&down=2");
    await viewerPage.getByRole("button", { name: "More descendants" }).click();

    await expect(viewerPage).toHaveURL(/down=3/);
    await expect(
      viewerPage.getByRole("button", { name: "Fewer descendants" }),
    ).toBeEnabled();
  });

  test("Fewer ancestors lowers the count and the URL", async ({
    viewerPage,
  }) => {
    await openTree(viewerPage, fixtureIds.grandfather, "?up=2&down=2");
    await viewerPage.getByRole("button", { name: "Fewer ancestors" }).click();
    await expect(viewerPage).toHaveURL(/up=1/);
  });

  test("stop at zero", async ({ viewerPage }) => {
    await openTree(viewerPage, fixtureIds.grandfather, "?up=0&down=0");
    await expect(
      viewerPage.getByRole("button", { name: "Fewer ancestors" }),
    ).toBeDisabled();
    await expect(
      viewerPage.getByRole("button", { name: "Fewer descendants" }),
    ).toBeDisabled();
  });

  test("stop at the maximum", async ({ viewerPage }) => {
    await openTree(
      viewerPage,
      fixtureIds.grandfather,
      `?up=${MAX_GENERATIONS}&down=${MAX_GENERATIONS}`,
    );
    await expect(
      viewerPage.getByRole("button", { name: "More ancestors" }),
    ).toBeDisabled();
    await expect(
      viewerPage.getByRole("button", { name: "More descendants" }),
    ).toBeDisabled();
  });

  test("Reset appears only off the default, and clears the override", async ({
    viewerPage,
  }) => {
    await openTree(viewerPage, fixtureIds.grandfather);
    await expect(viewerPage.getByRole("button", { name: "Reset" })).toHaveCount(
      0,
    );

    await viewerPage.getByRole("button", { name: "More ancestors" }).click();
    const reset = viewerPage.getByRole("button", { name: "Reset" });
    await expect(reset).toBeVisible();

    await reset.click();
    await expect(reset).toHaveCount(0, { timeout: 15_000 });
    await expect(viewerPage).toHaveURL(
      new RegExp(`/tree/${fixtureIds.grandfather}$`),
    );
  });

  test("a depth change does not add to the focus history", async ({
    viewerPage,
  }) => {
    // Decision 28: the back button walks *focus* history, so stepping the
    // depth replaces the URL rather than pushing onto it.
    await openTree(viewerPage, fixtureIds.grandfather);
    await viewerPage.getByRole("button", { name: "More ancestors" }).click();
    await expect(viewerPage).toHaveURL(/up=/);

    await viewerPage.goBack();
    await expect(viewerPage).not.toHaveURL(
      new RegExp(`/tree/${fixtureIds.grandfather}`),
    );
  });
});

test.describe("the card affordances", () => {
  test("Open profile leaves the tree for that person", async ({
    viewerPage,
  }) => {
    await openTree(viewerPage, fixtureIds.grandfather);
    await viewerPage
      .locator(`[data-open-profile="${fixtureIds.viewerPerson}"]`)
      .click();
    await expect(viewerPage).toHaveURL(
      new RegExp(`/person/${fixtureIds.viewerPerson}$`),
    );
  });

  test("every expand affordance says what it does", async ({ viewerPage }) => {
    await openTree(viewerPage, fixtureIds.child, "?up=1&down=0");
    const expands = viewerPage.locator("[data-expand-relation]");
    await expect(expands.first()).toBeVisible({ timeout: 20_000 });

    for (const name of await expands.evaluateAll((nodes) =>
      nodes.map((node) => node.getAttribute("aria-label")),
    )) {
      expect(name).toMatch(
        /^(Show partner|Show more ancestors|Show more descendants)$/,
      );
    }
  });

  test("Show more ancestors draws the generation above", async ({
    viewerPage,
  }) => {
    // Cut off above the parents, so the grandparents are the hidden ones.
    await openTree(viewerPage, fixtureIds.child, "?up=1&down=0");
    await expect(
      viewerPage.locator(`[data-person-id="${fixtureIds.grandfather}"]`),
    ).toHaveCount(0);

    const expand = viewerPage
      .locator(
        `[data-expand-relation="parents"][data-expand-target="${fixtureIds.viewerPerson}"]`,
      )
      .first();
    await expect(expand).toBeVisible({ timeout: 20_000 });
    await expand.click();

    await expect(
      viewerPage.locator(`[data-person-id="${fixtureIds.grandfather}"]`),
    ).toBeVisible({ timeout: 20_000 });
  });

  test("an expansion keeps the focus person and the URL as they were", async ({
    viewerPage,
  }) => {
    await openTree(viewerPage, fixtureIds.child, "?up=1&down=0");
    const before = viewerPage.url();

    const expand = viewerPage.locator("[data-expand-relation]").first();
    await expect(expand).toBeVisible({ timeout: 20_000 });
    await expand.click();
    await expect(
      viewerPage.locator(`[data-person-id="${fixtureIds.child}"]`),
    ).toBeVisible();

    expect(viewerPage.url()).toBe(before);
  });

  /**
   * Regression for #117: the affordance means "there are relatives this
   * window did not draw". Once the expansion has drawn them there is nothing
   * left for it to do, and pressing it again is a no-op — so it must go.
   */
  test("an expanded card's affordance goes away once it is used", async ({
    viewerPage,
  }) => {
    await openTree(viewerPage, fixtureIds.child, "?up=1&down=0");
    const expand = viewerPage.locator(
      `[data-expand-relation="parents"][data-expand-target="${fixtureIds.viewerPerson}"]`,
    );
    await expect(expand.first()).toBeVisible({ timeout: 20_000 });
    await expand.first().click();

    await expect(
      viewerPage.locator(`[data-person-id="${fixtureIds.grandfather}"]`),
    ).toBeVisible({ timeout: 20_000 });
    await expect(expand).toHaveCount(0);
  });

  test("a card carries the person's name and years", async ({ viewerPage }) => {
    await openTree(viewerPage, fixtureIds.grandfather);
    const card = viewerPage.locator(
      `[data-person-id="${fixtureIds.grandfather}"]`,
    );
    await expect(card).toContainText(fixtureNames.grandfather);
    await expect(card).toContainText("1901");
  });
});

/**
 * "Show partner" (#106). `family-chart` attaches spouses only to cards on
 * the descendant side of the root, so the badge can honour its promise on
 * the root and its descendants and nowhere else. The reported case was an
 * ancestor's second marriage: the fetch succeeded, the badge vanished, and
 * no card appeared. The rule now is that the badge is offered only where a
 * press can draw something.
 *
 * Both scenes are built from throwaway people so the shared fixture family
 * is untouched while other workers assert on it.
 */
test.describe("Show partner", () => {
  const scratch = scratchPersons();

  test.afterEach(async () => {
    await scratch.remove();
  });

  /** `parentIds` become the family's partners, `childIds` its children. */
  async function family(
    parentIds: readonly [string, string | null],
    childIds: readonly string[] = [],
  ): Promise<void> {
    const familyId = crypto.randomUUID();
    const inserted = await admin.from("family").insert({
      id: familyId,
      partner1_id: parentIds[0],
      partner2_id: parentIds[1],
      relationship_type: "married",
    });
    if (inserted.error !== null) {
      throw new Error(`family insert failed: ${inserted.error.message}`);
    }
    if (childIds.length > 0) {
      const linked = await admin.from("family_child").insert(
        childIds.map((personId) => ({
          family_id: familyId,
          person_id: personId,
        })),
      );
      if (linked.error !== null) {
        throw new Error(`family_child insert failed: ${linked.error.message}`);
      }
    }
  }

  test("draws a descendant's spouse when pressed", async ({ viewerPage }) => {
    const root = await scratch.create("Rootly", "male");
    const child = await scratch.create("Childly", "female");
    const spouse = await scratch.create("Spousely", "male");
    await family([root, null], [child]);
    await family([spouse, child]);

    await openTree(viewerPage, root, "?up=1&down=1");
    const badge = viewerPage.locator(
      `[data-expand-relation="self"][data-expand-target="${spouse}"]`,
    );
    await expect(badge).toBeVisible({ timeout: 20_000 });
    await expect(
      viewerPage.locator(`[data-person-id="${spouse}"]`),
    ).toHaveCount(0);
    await badge.click();

    await expect(
      viewerPage.locator(`[data-person-id="${spouse}"]`),
      "the resolved partner must be drawn, not just fetched",
    ).toBeVisible({ timeout: 20_000 });
  });

  test("is not offered on an ancestor, whose other marriage the layout cannot draw", async ({
    viewerPage,
  }) => {
    const root = await scratch.create("Rootly", "male");
    const father = await scratch.create("Fatherly", "male");
    const stepmother = await scratch.create("Steply", "female");
    await family([father, null], [root]);
    await family([father, stepmother]);

    await openTree(viewerPage, root, "?up=1&down=1");
    await expect(
      viewerPage.locator(`[data-person-id="${father}"]`),
    ).toBeVisible();
    await expect(
      viewerPage.locator(
        `[data-expand-relation="self"][data-expand-target="${stepmother}"]`,
      ),
      "a badge whose press draws nothing must not be offered",
    ).toHaveCount(0);
  });
});
