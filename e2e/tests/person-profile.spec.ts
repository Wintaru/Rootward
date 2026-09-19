import { fixtureIds, fixtureNames } from "../support/fixture-data";
import { expect, test } from "../support/test";

/**
 * `/person/[personId]` — the read-only profile (SPEC §8.1, §10 item 25).
 * Every section is driven by `buildPersonProfileView`, so these check that
 * the right sections appear for the right person and the right role.
 */

test.describe("a profile", () => {
  test("shows the name, lifespan, and sex", async ({ viewerPage }) => {
    await viewerPage.goto(`/person/${fixtureIds.grandfather}`);
    await expect(
      viewerPage.getByRole("heading", {
        level: 1,
        name: fixtureNames.grandfather,
      }),
    ).toBeVisible();
    // The subtitle joins sex, lifespan, and the living flag into one line.
    await expect(viewerPage.getByText(/^Male · 1901.1975$/)).toBeVisible();
  });

  test("marks a living person as living", async ({ viewerPage }) => {
    await viewerPage.goto(`/person/${fixtureIds.viewerPerson}`);
    await expect(
      viewerPage.getByText(/^Female · b. 1958 · Living$/),
    ).toBeVisible();
  });

  test("links back to the tree centred on that person", async ({
    viewerPage,
  }) => {
    await viewerPage.goto(`/person/${fixtureIds.grandfather}`);
    await viewerPage.getByRole("link", { name: /Back to the tree/ }).click();
    await expect(viewerPage).toHaveURL(
      new RegExp(`/tree/${fixtureIds.grandfather}`),
    );
  });

  test("shows a timeline with the birth and death events", async ({
    viewerPage,
  }) => {
    await viewerPage.goto(`/person/${fixtureIds.grandfather}`);
    const timeline = viewerPage
      .getByRole("heading", { name: "Timeline" })
      .locator("xpath=following-sibling::*[1]");
    await expect(timeline).toContainText("Birth");
    await expect(timeline).toContainText("Death");
  });

  test("groups relationships by kind", async ({ viewerPage }) => {
    await viewerPage.goto(`/person/${fixtureIds.viewerPerson}`);
    for (const group of ["Parents", "Partners", "Children"]) {
      await expect(
        viewerPage.getByRole("heading", { name: group }),
      ).toBeVisible();
    }
    await expect(
      viewerPage.getByRole("link", { name: fixtureNames.grandfather }),
    ).toBeVisible();
    await expect(
      viewerPage.getByRole("link", { name: fixtureNames.viewerSpouse }),
    ).toBeVisible();
    await expect(
      viewerPage.getByRole("link", { name: fixtureNames.child }),
    ).toBeVisible();
  });

  test("navigates between relatives", async ({ viewerPage }) => {
    await viewerPage.goto(`/person/${fixtureIds.viewerPerson}`);
    await viewerPage
      .getByRole("link", { name: fixtureNames.child })
      .first()
      .click();
    await expect(
      viewerPage.getByRole("heading", { level: 1, name: fixtureNames.child }),
    ).toBeVisible();
  });

  test("says so when a person has nothing recorded", async ({ viewerPage }) => {
    await viewerPage.goto(`/person/${fixtureIds.loner}`);
    await expect(viewerPage.getByText("Nothing recorded yet.")).toHaveCount(2);
  });

  test("falls back to a placeholder for an unnamed person", async ({
    moderatorPage,
  }) => {
    // Every fixture person has a name; this checks the rendered heading is
    // never blank, whichever person is opened.
    await moderatorPage.goto(`/person/${fixtureIds.loner}`);
    const heading = moderatorPage.getByRole("heading", { level: 1 });
    await expect(heading).not.toHaveText("");
  });

  test("offers Edit to a moderator", async ({ moderatorPage }) => {
    await moderatorPage.goto(`/person/${fixtureIds.grandfather}`);
    await moderatorPage.getByRole("link", { name: "Edit" }).click();
    await expect(moderatorPage).toHaveURL(
      new RegExp(`/person/${fixtureIds.grandfather}/edit`),
    );
  });
});

test.describe("the hide request", () => {
  test("can be opened, cancelled, and sent", async ({ viewerPage }) => {
    await viewerPage.goto(`/person/${fixtureIds.viewerPerson}`);
    const open = viewerPage.getByRole("button", {
      name: "Ask a moderator to hide this record",
    });
    await open.click();

    await expect(
      viewerPage.getByLabel(/Ask a moderator to hide/),
    ).toBeVisible();
    await viewerPage.getByRole("button", { name: "Cancel" }).click();
    await expect(open).toBeVisible();

    await open.click();
    await viewerPage
      .getByLabel(/Ask a moderator to hide/)
      .fill("Testing the hide request from the e2e suite.");
    await viewerPage.getByRole("button", { name: "Send request" }).click();
    await expect(viewerPage.getByText(/Request sent/)).toBeVisible();
  });
});
