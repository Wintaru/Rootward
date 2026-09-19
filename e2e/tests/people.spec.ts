import {
  BULK_COUNT,
  BULK_SURNAME,
  FIXTURE_SURNAME,
  fixtureNames,
} from "../support/fixture-data";
import { expect, test } from "../support/test";

/**
 * `/people` — the browse-by-name index (SPEC §8.1, issue #62): sorted by
 * surname then given name, filtered at the source, paginated 50 per page.
 */

test.describe("the people index", () => {
  test("lists people with a total count", async ({ viewerPage }) => {
    await viewerPage.goto("/people");
    await expect(
      viewerPage.getByRole("heading", { level: 1, name: "People" }),
    ).toBeVisible();
    await expect(viewerPage.getByText(/^\d+ (person|people)$/)).toBeVisible();
  });

  test("filters by surname and says what it matched", async ({
    viewerPage,
  }) => {
    await viewerPage.goto("/people");
    await viewerPage.getByLabel("Filter by name").fill(FIXTURE_SURNAME);
    await viewerPage.getByRole("button", { name: "Filter" }).click();
    await expect(viewerPage).toHaveURL(new RegExp(`q=${FIXTURE_SURNAME}`));
    await expect(
      viewerPage.getByText(new RegExp(`matching "${FIXTURE_SURNAME}"`)),
    ).toBeVisible();
    await expect(
      viewerPage.getByRole("link", { name: fixtureNames.grandfather }),
    ).toBeVisible();
  });

  test("sorts by given name within one surname", async ({ viewerPage }) => {
    await viewerPage.goto(`/people?q=${FIXTURE_SURNAME}`);
    const names = await viewerPage
      .getByRole("link", { name: new RegExp(FIXTURE_SURNAME) })
      .allInnerTexts();
    // An empty list would satisfy the ordering check vacuously.
    expect(names.length).toBeGreaterThan(1);

    const given = names.map((name) => name.split(" ")[0] ?? "");
    expect(given).toEqual([...given].sort());
  });

  test("shows a lifespan beside each person", async ({ viewerPage }) => {
    await viewerPage.goto(`/people?q=${FIXTURE_SURNAME}`);
    await expect(viewerPage.getByText("1901–1975")).toBeVisible();
    await expect(viewerPage.getByText("b. 1958")).toBeVisible();
  });

  test("says so when a filter matches nobody", async ({ viewerPage }) => {
    await viewerPage.goto("/people?q=zzzznobodyhasthisname");
    await expect(viewerPage.getByText("No one found.")).toBeVisible();
    await expect(viewerPage.getByText(/^0 people/)).toBeVisible();
  });

  test("opens a person from the list", async ({ viewerPage }) => {
    await viewerPage.goto(`/people?q=${FIXTURE_SURNAME}`);
    await viewerPage
      .getByRole("link", { name: fixtureNames.grandmother })
      .click();
    await expect(
      viewerPage.getByRole("heading", {
        level: 1,
        name: fixtureNames.grandmother,
      }),
    ).toBeVisible();
  });

  test("keeps the filter in the box after submitting", async ({
    viewerPage,
  }) => {
    await viewerPage.goto(`/people?q=${FIXTURE_SURNAME}`);
    await expect(viewerPage.getByLabel("Filter by name")).toHaveValue(
      FIXTURE_SURNAME,
    );
  });

  test("paginates a large unfiltered list", async ({ viewerPage }) => {
    await viewerPage.goto("/people");
    const rows = viewerPage.getByRole("listitem");
    const count = await rows.count();
    expect(count).toBeLessThanOrEqual(50);

    // Unconditional: the bulk fixture guarantees five pages, so a missing
    // pagination control is a regression, not a reason to skip the checks.
    const pagination = viewerPage.getByRole("navigation", {
      name: "Pagination",
    });
    await expect(pagination.getByText(/Page 1 of \d+/)).toBeVisible();

    await pagination.getByRole("link", { name: /Next/ }).click();
    await expect(viewerPage).toHaveURL(/page=2/);
    await expect(
      viewerPage
        .getByRole("navigation", { name: "Pagination" })
        .getByText(/Page 2 of \d+/),
    ).toBeVisible();

    await viewerPage
      .getByRole("navigation", { name: "Pagination" })
      .getByRole("link", { name: /Previous/ })
      .click();
    await expect(viewerPage).not.toHaveURL(/page=2/);
  });

  test("redirects a page past the end back to the last real page", async ({
    viewerPage,
  }) => {
    await viewerPage.goto(`/people?q=${FIXTURE_SURNAME}&page=99`);
    await expect(viewerPage).not.toHaveURL(/page=99/);
    await expect(viewerPage.getByText("No one found.")).toHaveCount(0);
  });

  test("treats a non-numeric page as page 1", async ({ viewerPage }) => {
    await viewerPage.goto(`/people?q=${FIXTURE_SURNAME}&page=abc`);
    await expect(
      viewerPage.getByRole("link", { name: fixtureNames.grandfather }),
    ).toBeVisible();
  });

  test("treats a negative page as page 1", async ({ viewerPage }) => {
    await viewerPage.goto(`/people?q=${FIXTURE_SURNAME}&page=-5`);
    await expect(
      viewerPage.getByRole("link", { name: fixtureNames.grandfather }),
    ).toBeVisible();
  });

  test("does not execute a script injected through the filter", async ({
    viewerPage,
  }) => {
    let dialogFired = false;
    viewerPage.on("dialog", (dialog) => {
      dialogFired = true;
      void dialog.dismiss();
    });
    await viewerPage.goto(
      `/people?q=${encodeURIComponent("<script>alert(1)</script>")}`,
    );
    await expect(viewerPage.getByText("No one found.")).toBeVisible();
    expect(dialogFired).toBe(false);
  });

  test("survives a filter full of PostgREST punctuation", async ({
    viewerPage,
  }) => {
    // `,` `.` `(` `)` are filter grammar to PostgREST — an unescaped value
    // would 400 the request rather than come back empty.
    const response = await viewerPage.goto(
      `/people?q=${encodeURIComponent("Smith, Jr. (the elder)")}`,
    );
    expect(response?.status()).toBe(200);
    await expect(viewerPage.getByText("No one found.")).toBeVisible();
  });

  test("survives a filter of SQL-injection shape", async ({ viewerPage }) => {
    const response = await viewerPage.goto(
      `/people?q=${encodeURIComponent("' OR 1=1 --")}`,
    );
    expect(response?.status()).toBe(200);
    await expect(viewerPage.getByText("No one found.")).toBeVisible();
  });
});

/**
 * BUG-003 regression. A filter is resolved to a list of matching person ids
 * and then re-queried with `.in("id", …)`, so the request URL grows with the
 * match count. Past roughly 209 matches it exceeds the gateway's URI limit,
 * `listPersons` throws, and the page returns HTTP 500 — searching the very
 * surname a family tree is about is the case most likely to trip it.
 */
test.describe("a filter that matches a large family", () => {
  test("does not fail with a server error", async ({ viewerPage }) => {
    const response = await viewerPage.goto(`/people?q=${BULK_SURNAME}`);
    expect(
      response?.status(),
      `filtering by a surname shared by ${BULK_COUNT} people must not 500`,
    ).toBe(200);
  });

  test("pages through the whole family", async ({ viewerPage }) => {
    await viewerPage.goto(`/people?q=${BULK_SURNAME}`);
    await expect(
      viewerPage.getByText(new RegExp(`${BULK_COUNT} people matching`)),
    ).toBeVisible();
    await expect(
      viewerPage
        .getByRole("navigation", { name: "Pagination" })
        .getByText(/Page 1 of 5/),
    ).toBeVisible();
  });
});

/**
 * BUG-005 regression. `escapeLikePattern` escapes `%` and `_` to `\%` / `\_`,
 * but `quotePostgrestValue` then wraps the pattern in double quotes, and
 * PostgREST strips the backslash inside a quoted value — so the wildcard
 * reaches Postgres unescaped and matches every person in the tree.
 */
test.describe("LIKE wildcards in a filter", () => {
  for (const wildcard of ["%", "_"]) {
    test(`"${wildcard}" is matched literally, not as a wildcard`, async ({
      viewerPage,
    }) => {
      const response = await viewerPage.goto(
        `/people?q=${encodeURIComponent(wildcard)}`,
      );
      expect(response?.status()).toBe(200);
      await expect(
        viewerPage.getByText("No one found."),
        `"${wildcard}" is a LIKE wildcard — it must be escaped, not match everyone`,
      ).toBeVisible();
    });
  }
});
