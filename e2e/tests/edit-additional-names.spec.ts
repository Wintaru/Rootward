import type { Locator, Page } from "@playwright/test";

import { scratchPersons } from "../support/scratch";
import { expect, test } from "../support/test";

/**
 * `?section=additional-names` — every control on the Additional Names
 * section (SPEC §8.3, issue #29).
 *
 * The section is a list editor: add a row, fill six fields, reorder it,
 * remove it, then one Save for the whole list. Each control is clicked here
 * rather than only checked for presence, because the reorder and remove
 * buttons write through a draft reducer that a render-only assertion cannot
 * reach.
 */

const scratch = scratchPersons();

test.afterAll(async () => {
  await scratch.remove();
});

/** The name rows, told apart from the section's other list items by the
 * reorder control every row carries. */
function nameRows(page: Page): Locator {
  return page
    .getByRole("listitem")
    .filter({ has: page.getByRole("button", { name: "Move up" }) });
}

async function openSection(page: Page, personId: string): Promise<void> {
  await page.goto(`/person/${personId}/edit?section=additional-names`);
  await expect(
    page.getByRole("heading", { level: 2, name: "Additional Names" }),
  ).toBeVisible();
}

test.describe("the Additional Names section", () => {
  test("starts empty and says so", async ({ moderatorPage }) => {
    const id = await scratch.create("Unnamedextra");
    await openSection(moderatorPage, id);

    await expect(
      moderatorPage.getByText("No additional names recorded."),
    ).toBeVisible();
    await expect(
      moderatorPage.getByRole("button", { name: "Save" }),
    ).toBeDisabled();
  });

  test("Add a name appends an empty row with every field", async ({
    moderatorPage,
  }) => {
    const id = await scratch.create("Addsarow");
    await openSection(moderatorPage, id);
    await moderatorPage.getByRole("button", { name: "Add a name" }).click();

    const row = nameRows(moderatorPage).first();
    await expect(row).toBeVisible();
    for (const label of [
      "Type",
      "Given name",
      "Surname",
      "Prefix",
      "Suffix",
      "Nickname",
    ]) {
      await expect(row.getByLabel(label)).toBeVisible();
    }
    await expect(
      moderatorPage.getByText("No additional names recorded."),
    ).toHaveCount(0);
  });

  test("an empty row is not worth saving, a filled one is", async ({
    moderatorPage,
  }) => {
    const id = await scratch.create("Dirtiesonadd");
    await openSection(moderatorPage, id);
    const save = moderatorPage.getByRole("button", { name: "Save" });

    // A row added but never filled in is dropped from the diff rather than
    // inserted as an empty `person_name` (`lib/edit/additional-names.ts`),
    // so the section is still clean.
    await moderatorPage.getByRole("button", { name: "Add a name" }).click();
    await expect(save).toBeDisabled();

    await nameRows(moderatorPage)
      .first()
      .getByLabel("Given name")
      .fill("Anyvalue");
    await expect(save).toBeEnabled();
  });

  test("the Type select offers the GEDCOM name types", async ({
    moderatorPage,
  }) => {
    const id = await scratch.create("Typepicker");
    await openSection(moderatorPage, id);
    await moderatorPage.getByRole("button", { name: "Add a name" }).click();

    const type = nameRows(moderatorPage).first().getByLabel("Type");
    await expect(type).toHaveValue("");
    await type.selectOption({ label: "Also known as" });
    await expect(type).toHaveValue("also_known_as");
  });

  test("saves a filled row and reads every field back", async ({
    moderatorPage,
  }) => {
    const id = await scratch.create("Roundtrips");
    await openSection(moderatorPage, id);
    await moderatorPage.getByRole("button", { name: "Add a name" }).click();

    const row = nameRows(moderatorPage).first();
    await row.getByLabel("Type").selectOption({ label: "Also known as" });
    await row.getByLabel("Given name").fill("Gidders");
    await row.getByLabel("Surname").fill("Qatestsson-Hyphen");
    await row.getByLabel("Prefix").fill("Dr");
    await row.getByLabel("Suffix").fill("Jr");
    await row.getByLabel("Nickname").fill("Gid");
    await moderatorPage.getByRole("button", { name: "Save" }).click();
    await expect(moderatorPage.getByText("Saved.")).toBeVisible();

    await moderatorPage.reload();
    const saved = nameRows(moderatorPage).first();
    await expect(saved.getByLabel("Type")).toHaveValue("also_known_as");
    await expect(saved.getByLabel("Given name")).toHaveValue("Gidders");
    await expect(saved.getByLabel("Surname")).toHaveValue("Qatestsson-Hyphen");
    await expect(saved.getByLabel("Prefix")).toHaveValue("Dr");
    await expect(saved.getByLabel("Suffix")).toHaveValue("Jr");
    await expect(saved.getByLabel("Nickname")).toHaveValue("Gid");
  });

  test("Save goes back to disabled once the list is clean", async ({
    moderatorPage,
  }) => {
    const id = await scratch.create("Cleansafter");
    await openSection(moderatorPage, id);
    await moderatorPage.getByRole("button", { name: "Add a name" }).click();
    await nameRows(moderatorPage)
      .first()
      .getByLabel("Given name")
      .fill("Onceonly");
    await moderatorPage.getByRole("button", { name: "Save" }).click();
    await expect(moderatorPage.getByText("Saved.")).toBeVisible();
    await expect(
      moderatorPage.getByRole("button", { name: "Save" }),
    ).toBeDisabled();
  });

  test("the reorder buttons are disabled at the ends of the list", async ({
    moderatorPage,
  }) => {
    const id = await scratch.create("Endstops");
    await openSection(moderatorPage, id);
    const add = moderatorPage.getByRole("button", { name: "Add a name" });
    await add.click();
    await add.click();

    const rows = nameRows(moderatorPage);
    await expect(rows).toHaveCount(2);
    await expect(
      rows.first().getByRole("button", { name: "Move up" }),
    ).toBeDisabled();
    await expect(
      rows.first().getByRole("button", { name: "Move down" }),
    ).toBeEnabled();
    await expect(
      rows.last().getByRole("button", { name: "Move up" }),
    ).toBeEnabled();
    await expect(
      rows.last().getByRole("button", { name: "Move down" }),
    ).toBeDisabled();
  });

  test("Move down swaps two rows, and Move up puts them back", async ({
    moderatorPage,
  }) => {
    const id = await scratch.create("Reorders");
    await openSection(moderatorPage, id);
    const add = moderatorPage.getByRole("button", { name: "Add a name" });
    await add.click();
    await add.click();

    const rows = nameRows(moderatorPage);
    await rows.nth(0).getByLabel("Given name").fill("Firstly");
    await rows.nth(1).getByLabel("Given name").fill("Secondly");

    await rows.nth(0).getByRole("button", { name: "Move down" }).click();
    await expect(rows.nth(0).getByLabel("Given name")).toHaveValue("Secondly");
    await expect(rows.nth(1).getByLabel("Given name")).toHaveValue("Firstly");

    await rows.nth(1).getByRole("button", { name: "Move up" }).click();
    await expect(rows.nth(0).getByLabel("Given name")).toHaveValue("Firstly");
    await expect(rows.nth(1).getByLabel("Given name")).toHaveValue("Secondly");
  });

  test("a saved reorder survives a reload", async ({ moderatorPage }) => {
    const id = await scratch.create("Orderpersists");
    await openSection(moderatorPage, id);
    const add = moderatorPage.getByRole("button", { name: "Add a name" });
    await add.click();
    await add.click();

    const rows = nameRows(moderatorPage);
    await rows.nth(0).getByLabel("Given name").fill("Alpha");
    await rows.nth(1).getByLabel("Given name").fill("Beta");
    await moderatorPage.getByRole("button", { name: "Save" }).click();
    await expect(moderatorPage.getByText("Saved.")).toBeVisible();

    await rows.nth(0).getByRole("button", { name: "Move down" }).click();
    await moderatorPage.getByRole("button", { name: "Save" }).click();
    await expect(moderatorPage.getByText("Saved.")).toBeVisible();

    await moderatorPage.reload();
    await expect(
      nameRows(moderatorPage).nth(0).getByLabel("Given name"),
    ).toHaveValue("Beta");
  });

  test("Remove drops an unsaved row without touching the rest", async ({
    moderatorPage,
  }) => {
    const id = await scratch.create("Removesone");
    await openSection(moderatorPage, id);
    const add = moderatorPage.getByRole("button", { name: "Add a name" });
    await add.click();
    await add.click();

    const rows = nameRows(moderatorPage);
    await rows.nth(0).getByLabel("Given name").fill("Keepme");
    await rows.nth(1).getByLabel("Given name").fill("Dropme");
    await rows.nth(1).getByRole("button", { name: "Remove" }).click();

    await expect(rows).toHaveCount(1);
    await expect(rows.first().getByLabel("Given name")).toHaveValue("Keepme");
  });

  test("Remove deletes a saved row for good", async ({ moderatorPage }) => {
    const id = await scratch.create("Deletesrow");
    await openSection(moderatorPage, id);
    await moderatorPage.getByRole("button", { name: "Add a name" }).click();
    await nameRows(moderatorPage)
      .first()
      .getByLabel("Given name")
      .fill("Doomedname");
    await moderatorPage.getByRole("button", { name: "Save" }).click();
    await expect(moderatorPage.getByText("Saved.")).toBeVisible();

    await moderatorPage.reload();
    await nameRows(moderatorPage)
      .first()
      .getByRole("button", { name: "Remove" })
      .click();
    await moderatorPage.getByRole("button", { name: "Save" }).click();
    await expect(moderatorPage.getByText("Saved.")).toBeVisible();

    await moderatorPage.reload();
    await expect(
      moderatorPage.getByText("No additional names recorded."),
    ).toBeVisible();
  });
});
