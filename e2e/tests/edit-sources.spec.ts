import type { Locator, Page } from "@playwright/test";

import { scratchPersons } from "../support/scratch";
import { admin } from "../support/supabase-admin";
import { expect, test } from "../support/test";

/**
 * `?section=sources` — repositories, sources, and citations (SPEC §8.3,
 * §4.5, issue #31).
 *
 * Three independent editors on one screen, each with its own Save, so every
 * locator here is scoped to its panel.
 *
 * Repositories and sources are shared tree-wide reference data, not
 * per-person rows (`getSourcesSectionData` reads both without a person
 * filter). So no test may assume either list is empty, or that its own row
 * is the first one — each looks its own row up by a unique name, and sweeps
 * it afterwards.
 */

const scratch = scratchPersons();

/** Repository and source rows outlive the person they were typed on. */
const createdRepositories: string[] = [];
const createdSources: string[] = [];

function uniqueName(base: string, into: string[]): string {
  const name = `${base} ${crypto.randomUUID().slice(0, 8)}`;
  into.push(name);
  return name;
}

test.afterAll(async () => {
  await scratch.remove();
  if (createdSources.length > 0) {
    const { error } = await admin
      .from("source")
      .delete()
      .in("title", createdSources);
    if (error !== null) {
      throw new Error(`source cleanup failed: ${error.message}`);
    }
  }
  if (createdRepositories.length > 0) {
    const { error } = await admin
      .from("repository")
      .delete()
      .in("name", createdRepositories);
    if (error !== null) {
      throw new Error(`repository cleanup failed: ${error.message}`);
    }
  }
});

async function openSection(page: Page, personId: string): Promise<void> {
  await page.goto(`/person/${personId}/edit?section=sources`);
  await expect(
    page.getByRole("heading", { level: 2, name: "Sources" }),
  ).toBeVisible();
}

/** One of the three panels, told apart by its own heading — each carries its
 * own Save button, so an unscoped `getByRole("button", …)` is ambiguous. */
function panel(page: Page, heading: string): Locator {
  return page
    .getByRole("main")
    .locator("section")
    .filter({ has: page.getByRole("heading", { level: 3, name: heading }) });
}

function rowsIn(section: Locator, page: Page): Locator {
  return section
    .getByRole("listitem")
    .filter({ has: page.getByRole("button", { name: "Remove" }) });
}

/**
 * The row whose `label` field holds `value`.
 *
 * `filter({ hasText })` cannot find it: the text lives in an input's value,
 * not in the element's content, so the rows are scanned by value instead and
 * the match returned by index.
 */
async function rowWhere(
  rows: Locator,
  label: string,
  value: string,
): Promise<Locator> {
  const values = await rows
    .getByLabel(label)
    .evaluateAll((inputs) =>
      inputs.map((input) => (input as HTMLInputElement).value),
    );
  const index = values.indexOf(value);
  expect(index, `no row has ${label} = "${value}"`).toBeGreaterThan(-1);
  return rows.nth(index);
}

test.describe("the Repositories panel", () => {
  test("opens clean, with an Add button and nothing to save", async ({
    moderatorPage,
  }) => {
    const id = await scratch.create("Norepos");
    await openSection(moderatorPage, id);
    const repos = panel(moderatorPage, "Repositories");

    await expect(
      repos.getByRole("button", { name: "Add a repository" }),
    ).toBeVisible();
    await expect(repos.getByRole("button", { name: "Save" })).toBeDisabled();
  });

  test("saves every repository field and reads them back", async ({
    moderatorPage,
  }) => {
    const id = await scratch.create("Makesrepo");
    const name = uniqueName("Qatestsson Archive", createdRepositories);
    await openSection(moderatorPage, id);
    const repos = panel(moderatorPage, "Repositories");

    await repos.getByRole("button", { name: "Add a repository" }).click();
    const row = rowsIn(repos, moderatorPage).last();
    await row.getByLabel("Name").fill(name);
    await row.getByLabel("Address").fill("1 Quay Road");
    await row.getByLabel("Phone").fill("+46 8 000000");
    await row.getByLabel("Email").fill("archive@rootward.test");
    await row.getByLabel("Website").fill("https://example.invalid/archive");
    await repos.getByRole("button", { name: "Save" }).click();
    await expect(repos.getByText("Saved.")).toBeVisible();

    await moderatorPage.reload();
    const saved = await rowWhere(
      rowsIn(panel(moderatorPage, "Repositories"), moderatorPage),
      "Name",
      name,
    );
    await expect(saved.getByLabel("Name")).toHaveValue(name);
    await expect(saved.getByLabel("Address")).toHaveValue("1 Quay Road");
    await expect(saved.getByLabel("Email")).toHaveValue(
      "archive@rootward.test",
    );
  });
});

test.describe("the Sources panel", () => {
  test("opens clean, with an Add button and nothing to save", async ({
    moderatorPage,
  }) => {
    const id = await scratch.create("Nosources");
    await openSection(moderatorPage, id);
    const sources = panel(moderatorPage, "Sources");

    await expect(
      sources.getByRole("button", { name: "Add a source" }),
    ).toBeVisible();
    await expect(sources.getByRole("button", { name: "Save" })).toBeDisabled();
  });

  test("a new source starts with no repository chosen", async ({
    moderatorPage,
  }) => {
    const id = await scratch.create("Needsrepo");
    await openSection(moderatorPage, id);
    const sources = panel(moderatorPage, "Sources");
    await sources.getByRole("button", { name: "Add a source" }).click();

    const row = rowsIn(sources, moderatorPage).last();
    const repository = row.getByLabel("Repository");
    await expect(repository).toHaveValue("");
    await expect(repository.getByRole("option", { name: "None" })).toHaveCount(
      1,
    );
  });

  test("saves a source and links it to a saved repository", async ({
    moderatorPage,
  }) => {
    const id = await scratch.create("Linksrepo");
    const repoName = uniqueName("Qatestsson Library", createdRepositories);
    const sourceTitle = uniqueName("Parish register", createdSources);
    await openSection(moderatorPage, id);

    const repos = panel(moderatorPage, "Repositories");
    await repos.getByRole("button", { name: "Add a repository" }).click();
    await rowsIn(repos, moderatorPage).last().getByLabel("Name").fill(repoName);
    await repos.getByRole("button", { name: "Save" }).click();
    await expect(repos.getByText("Saved.")).toBeVisible();

    const sources = panel(moderatorPage, "Sources");
    await sources.getByRole("button", { name: "Add a source" }).click();
    const row = rowsIn(sources, moderatorPage).last();
    await row.getByLabel("Title").fill(sourceTitle);
    await row.getByLabel("Author").fill("The parish clerk");
    await row.getByLabel("Publication info").fill("Vol. III, 1871");
    await row.getByLabel("Source text").fill("Entry 42, left column.");
    await row.getByLabel("Repository").selectOption({ label: repoName });
    await sources.getByRole("button", { name: "Save" }).click();
    await expect(sources.getByText("Saved.")).toBeVisible();

    await moderatorPage.reload();
    const saved = await rowWhere(
      rowsIn(panel(moderatorPage, "Sources"), moderatorPage),
      "Title",
      sourceTitle,
    );
    await expect(saved.getByLabel("Title")).toHaveValue(sourceTitle);
    await expect(saved.getByLabel("Author")).toHaveValue("The parish clerk");
    await expect(saved.getByLabel("Publication info")).toHaveValue(
      "Vol. III, 1871",
    );
    await expect(saved.getByLabel("Source text")).toHaveValue(
      "Entry 42, left column.",
    );
    await expect(saved.getByLabel("Repository")).not.toHaveValue("");
  });

  test("warns that removing a source takes its citations with it", async ({
    moderatorPage,
  }) => {
    const id = await scratch.create("Warnsremove");
    const sourceTitle = uniqueName("Doomed source", createdSources);
    await openSection(moderatorPage, id);

    const sources = panel(moderatorPage, "Sources");
    await sources.getByRole("button", { name: "Add a source" }).click();
    const row = rowsIn(sources, moderatorPage).last();

    // The warning belongs to a saved source, not a draft one.
    await expect(row.getByText(/also removes every citation/)).toHaveCount(0);

    await row.getByLabel("Title").fill(sourceTitle);
    await sources.getByRole("button", { name: "Save" }).click();
    await expect(sources.getByText("Saved.")).toBeVisible();
    await expect(row.getByText(/also removes every citation/)).toBeVisible();
  });
});

test.describe("the Citations panel", () => {
  test("groups citations by what they are about", async ({ moderatorPage }) => {
    const id = await scratch.create("Citegroups");
    const { error } = await admin.from("event").insert({
      owner_type: "person",
      person_id: id,
      type: "baptism",
    });
    expect(error).toBeNull();

    await openSection(moderatorPage, id);
    const citations = panel(moderatorPage, "Citations");
    await expect(
      citations.getByRole("heading", { name: "About this person" }),
    ).toBeVisible();
    await expect(
      citations.getByRole("heading", { name: "About their Baptism" }),
    ).toBeVisible();
    await expect(
      citations.getByRole("button", { name: "Add a citation" }),
    ).toHaveCount(2);
  });

  test("a citation cannot name a source that is not saved yet", async ({
    moderatorPage,
  }) => {
    const id = await scratch.create("Nocitesource");
    const draftTitle = uniqueName("Unsaved source", createdSources);
    await openSection(moderatorPage, id);

    // Typed but never saved, so it is not a `source` row yet.
    const sources = panel(moderatorPage, "Sources");
    await sources.getByRole("button", { name: "Add a source" }).click();
    await rowsIn(sources, moderatorPage)
      .last()
      .getByLabel("Title")
      .fill(draftTitle);

    const citations = panel(moderatorPage, "Citations");
    await citations.getByRole("button", { name: "Add a citation" }).click();
    const source = rowsIn(citations, moderatorPage).last().getByLabel("Source");
    await expect(source.getByRole("option", { name: draftTitle })).toHaveCount(
      0,
    );
  });

  test("saves a citation against a source and reads it back", async ({
    moderatorPage,
  }) => {
    const id = await scratch.create("Savescite");
    const sourceTitle = uniqueName("Cited register", createdSources);
    await openSection(moderatorPage, id);

    const sources = panel(moderatorPage, "Sources");
    await sources.getByRole("button", { name: "Add a source" }).click();
    await rowsIn(sources, moderatorPage)
      .last()
      .getByLabel("Title")
      .fill(sourceTitle);
    await sources.getByRole("button", { name: "Save" }).click();
    await expect(sources.getByText("Saved.")).toBeVisible();

    const citations = panel(moderatorPage, "Citations");
    await citations.getByRole("button", { name: "Add a citation" }).click();
    const row = rowsIn(citations, moderatorPage).last();
    await row.getByLabel("Source").selectOption({ label: sourceTitle });
    await row.getByLabel("Page").fill("p. 118");
    await row.getByLabel("Date").fill("abt 1871");
    await row
      .getByLabel("Quality")
      .selectOption({ label: "3 — Direct/primary" });
    await row.getByLabel("Data").fill("Left column, third entry");
    await citations.getByRole("button", { name: "Save" }).click();
    await expect(citations.getByText("Saved.")).toBeVisible();

    await moderatorPage.reload();
    const saved = await rowWhere(
      rowsIn(panel(moderatorPage, "Citations"), moderatorPage),
      "Page",
      "p. 118",
    );
    await expect(saved.getByLabel("Page")).toHaveValue("p. 118");
    await expect(saved.getByLabel("Date")).toHaveValue("abt 1871");
    await expect(saved.getByLabel("Quality")).toHaveValue("3");
    await expect(saved.getByLabel("Data")).toHaveValue(
      "Left column, third entry",
    );
  });

  test("the Quality select offers the four GEDCOM levels plus Not set", async ({
    moderatorPage,
  }) => {
    const id = await scratch.create("Qualitylevels");
    await openSection(moderatorPage, id);
    const citations = panel(moderatorPage, "Citations");
    await citations.getByRole("button", { name: "Add a citation" }).click();

    const quality = rowsIn(citations, moderatorPage)
      .last()
      .getByLabel("Quality");
    await expect(quality.getByRole("option")).toHaveCount(5);
    await expect(quality).toHaveValue("");
  });
});
