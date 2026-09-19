import {
  fixtureIds,
  fixtureNames,
  FIXTURE_SURNAME,
} from "../support/fixture-data";
import { expect, test } from "../support/test";

/**
 * The visibility ladder (SPEC §5), read through the app rather than through
 * the database, because that is where a leak would actually hurt.
 *
 * The MVP ladder makes a person visible to an approved caller when the row is
 * `everyone_approved`, the caller is a moderator, or the caller's own linked
 * person **is** that row. `close_family` is a post-MVP rung (decision 43), so
 * today it behaves like `moderators_only` — asserted here as written, so
 * building #43 makes this test fail on purpose rather than pass silently.
 *
 * A hidden person and an absent one must be indistinguishable: both 404.
 * A test that only checked "the name is not on the page" would pass on a
 * page that leaked the person's existence through a different error.
 */

const RESTRICTED = [
  { key: "hidden", id: fixtureIds.hidden, name: fixtureNames.hidden },
  {
    key: "moderators_only",
    id: fixtureIds.moderatorsOnly,
    name: fixtureNames.moderatorsOnly,
  },
  {
    key: "close_family (post-MVP, so moderator-only today)",
    id: fixtureIds.closeFamily,
    name: fixtureNames.closeFamily,
  },
];

test.describe("a viewer", () => {
  for (const person of RESTRICTED) {
    test(`gets a 404 for a ${person.key} person`, async ({ viewerPage }) => {
      const response = await viewerPage.goto(`/person/${person.id}`);
      expect(response?.status()).toBe(404);
      await expect(viewerPage.getByText(person.name)).toHaveCount(0);
    });

    test(`cannot reach the tree centred on a ${person.key} person`, async ({
      viewerPage,
    }) => {
      const response = await viewerPage.goto(`/tree/${person.id}`);
      expect(response?.status()).toBe(404);
    });

    test(`does not see a ${person.key} person in /people`, async ({
      viewerPage,
    }) => {
      await viewerPage.goto(`/people?q=${FIXTURE_SURNAME}`);
      // Anchor on a person who *should* be listed first: a pure absence
      // assertion also passes on an error page that lists nobody at all.
      await expect(
        viewerPage.getByRole("link", { name: fixtureNames.grandfather }),
      ).toBeVisible();
      await expect(viewerPage.getByText(person.name)).toHaveCount(0);
    });
  }

  test("sees an unknown person id exactly as it sees a hidden one", async ({
    viewerPage,
  }) => {
    const absent = await viewerPage.goto(
      "/person/00000000-0000-4000-8000-00000000dead",
    );
    const hiddenBody = await viewerPage.goto(`/person/${fixtureIds.hidden}`);
    expect(absent?.status()).toBe(hiddenBody?.status());
  });

  test("sees the everyone_approved relatives", async ({ viewerPage }) => {
    await viewerPage.goto(`/people?q=${FIXTURE_SURNAME}`);
    for (const name of [
      fixtureNames.grandfather,
      fixtureNames.grandmother,
      fixtureNames.viewerPerson,
      fixtureNames.child,
    ]) {
      await expect(viewerPage.getByRole("link", { name })).toBeVisible();
    }
  });

  test("sees no restricted sibling on a visible parent's profile", async ({
    viewerPage,
  }) => {
    await viewerPage.goto(`/person/${fixtureIds.grandfather}`);
    await expect(
      viewerPage.getByRole("heading", { name: "Relationships" }),
    ).toBeVisible();
    for (const person of RESTRICTED) {
      await expect(viewerPage.getByText(person.name)).toHaveCount(0);
    }
  });
});

test.describe("a moderator", () => {
  for (const person of RESTRICTED) {
    test(`can open a ${person.key} person`, async ({ moderatorPage }) => {
      const response = await moderatorPage.goto(`/person/${person.id}`);
      expect(response?.status()).toBe(200);
      await expect(
        moderatorPage.getByRole("heading", { level: 1, name: person.name }),
      ).toBeVisible();
    });
  }

  test("sees every fixture sibling in /people", async ({ moderatorPage }) => {
    await moderatorPage.goto(`/people?q=${FIXTURE_SURNAME}`);
    for (const person of RESTRICTED) {
      await expect(
        moderatorPage.getByRole("link", { name: person.name }),
      ).toBeVisible();
    }
  });
});

test.describe("a viewer's own record", () => {
  test("is reachable from the header's My record link", async ({
    viewerPage,
  }) => {
    await viewerPage.goto("/people");
    await viewerPage
      .getByRole("navigation", { name: "Main" })
      .getByRole("link", { name: "My record" })
      .first()
      .click();
    await expect(
      viewerPage.getByRole("heading", {
        level: 1,
        name: fixtureNames.viewerPerson,
      }),
    ).toBeVisible();
  });

  test("offers the hide request only on their own record", async ({
    viewerPage,
  }) => {
    await viewerPage.goto(`/person/${fixtureIds.viewerPerson}`);
    await expect(
      viewerPage.getByRole("button", {
        name: "Ask a moderator to hide this record",
      }),
    ).toBeVisible();

    await viewerPage.goto(`/person/${fixtureIds.grandmother}`);
    await expect(
      viewerPage.getByRole("button", {
        name: "Ask a moderator to hide this record",
      }),
    ).toHaveCount(0);
  });

  test("offers the hide request on a child's record (decision 14)", async ({
    viewerPage,
  }) => {
    await viewerPage.goto(`/person/${fixtureIds.child}`);
    await expect(
      viewerPage.getByRole("button", {
        name: "Ask a moderator to hide this record",
      }),
    ).toBeVisible();
  });
});

test.describe("moderator-only affordances", () => {
  test("a moderator sees Invite to claim on an unclaimed person", async ({
    moderatorPage,
  }) => {
    await moderatorPage.goto(`/person/${fixtureIds.grandfather}`);
    await expect(
      moderatorPage.getByRole("link", { name: "Invite to claim" }),
    ).toBeVisible();
  });

  test("a moderator sees no Invite to claim on a claimed person", async ({
    moderatorPage,
  }) => {
    await moderatorPage.goto(`/person/${fixtureIds.viewerPerson}`);
    await expect(
      moderatorPage.getByRole("link", { name: "Invite to claim" }),
    ).toHaveCount(0);
  });

  test("the invite link preselects that person in the moderation form", async ({
    moderatorPage,
  }) => {
    await moderatorPage.goto(`/person/${fixtureIds.grandfather}`);
    await moderatorPage.getByRole("link", { name: "Invite to claim" }).click();
    await expect(moderatorPage).toHaveURL(/\/moderation\?/);
    await expect(moderatorPage.getByLabel("Person ID")).toHaveValue(
      fixtureIds.grandfather,
    );
  });
});
