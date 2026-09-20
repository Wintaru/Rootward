import type { Locator, Page } from "@playwright/test";

import { scratchPersons } from "../support/scratch";
import { admin } from "../support/supabase-admin";
import { expect, test } from "../support/test";

/**
 * `?section=notes` — the Notes editor (SPEC §8.3, issue #32).
 *
 * Notes are grouped by what they are about: the person, then one group per
 * event. Each group has its own Add button but they share a single Save, so
 * the grouping and the save lifecycle are both exercised here.
 */

const scratch = scratchPersons();

test.afterAll(async () => {
  await scratch.remove();
});

function noteRows(page: Page): Locator {
  return page
    .getByRole("listitem")
    .filter({ has: page.getByRole("button", { name: "Move up" }) });
}

async function openSection(page: Page, personId: string): Promise<void> {
  await page.goto(`/person/${personId}/edit?section=notes`);
  await expect(
    page.getByRole("heading", { level: 2, name: "Notes" }),
  ).toBeVisible();
}

test.describe("the Notes section", () => {
  test("starts on an empty About this person group", async ({
    moderatorPage,
  }) => {
    const id = await scratch.create("Nonotes");
    await openSection(moderatorPage, id);

    await expect(
      moderatorPage.getByRole("heading", { name: "About this person" }),
    ).toBeVisible();
    await expect(moderatorPage.getByText("No notes recorded.")).toBeVisible();
    await expect(
      moderatorPage.getByRole("button", { name: "Save" }),
    ).toBeDisabled();
  });

  test("Add a note appends an editable note box", async ({ moderatorPage }) => {
    const id = await scratch.create("Addsnote");
    await openSection(moderatorPage, id);
    await moderatorPage.getByRole("button", { name: "Add a note" }).click();

    const row = noteRows(moderatorPage).first();
    await expect(row.getByLabel("Note")).toBeVisible();
    await expect(row.getByLabel("Note")).toHaveValue("");
  });

  test("an empty note is not worth saving, a typed one is", async ({
    moderatorPage,
  }) => {
    const id = await scratch.create("Blanknote");
    await openSection(moderatorPage, id);
    const save = moderatorPage.getByRole("button", { name: "Save" });

    await moderatorPage.getByRole("button", { name: "Add a note" }).click();
    await expect(save).toBeDisabled();

    await noteRows(moderatorPage).first().getByLabel("Note").fill("Something");
    await expect(save).toBeEnabled();
  });

  test("saves a note and reads it back", async ({ moderatorPage }) => {
    const id = await scratch.create("Savesnote");
    await openSection(moderatorPage, id);
    await moderatorPage.getByRole("button", { name: "Add a note" }).click();
    await noteRows(moderatorPage)
      .first()
      .getByLabel("Note")
      .fill("Kept the lighthouse at Qatestsshamn for thirty years.");
    await moderatorPage.getByRole("button", { name: "Save" }).click();
    await expect(moderatorPage.getByText("Saved.")).toBeVisible();

    await moderatorPage.reload();
    await expect(
      noteRows(moderatorPage).first().getByLabel("Note"),
    ).toHaveValue("Kept the lighthouse at Qatestsshamn for thirty years.");
  });

  test("a saved note shows on the profile", async ({ moderatorPage }) => {
    const id = await scratch.create("Shownnote");
    await openSection(moderatorPage, id);
    await moderatorPage.getByRole("button", { name: "Add a note" }).click();
    await noteRows(moderatorPage)
      .first()
      .getByLabel("Note")
      .fill("A note the profile must show.");
    await moderatorPage.getByRole("button", { name: "Save" }).click();
    await expect(moderatorPage.getByText("Saved.")).toBeVisible();

    await moderatorPage.goto(`/person/${id}`);
    await expect(
      moderatorPage.getByText("A note the profile must show."),
    ).toBeVisible();
  });

  test("reorders two notes and keeps the new order", async ({
    moderatorPage,
  }) => {
    const id = await scratch.create("Ordersnotes");
    await openSection(moderatorPage, id);
    const add = moderatorPage.getByRole("button", { name: "Add a note" });
    await add.click();
    await add.click();

    const rows = noteRows(moderatorPage);
    await rows.nth(0).getByLabel("Note").fill("First note");
    await rows.nth(1).getByLabel("Note").fill("Second note");
    await expect(
      rows.nth(0).getByRole("button", { name: "Move up" }),
    ).toBeDisabled();
    await expect(
      rows.nth(1).getByRole("button", { name: "Move down" }),
    ).toBeDisabled();

    await moderatorPage.getByRole("button", { name: "Save" }).click();
    await expect(moderatorPage.getByText("Saved.")).toBeVisible();

    await rows.nth(1).getByRole("button", { name: "Move up" }).click();
    await moderatorPage.getByRole("button", { name: "Save" }).click();
    await expect(moderatorPage.getByText("Saved.")).toBeVisible();

    await moderatorPage.reload();
    await expect(noteRows(moderatorPage).nth(0).getByLabel("Note")).toHaveValue(
      "Second note",
    );
  });

  test("Remove deletes a saved note for good", async ({ moderatorPage }) => {
    const id = await scratch.create("Dropsnote");
    await openSection(moderatorPage, id);
    await moderatorPage.getByRole("button", { name: "Add a note" }).click();
    await noteRows(moderatorPage).first().getByLabel("Note").fill("Doomed");
    await moderatorPage.getByRole("button", { name: "Save" }).click();
    await expect(moderatorPage.getByText("Saved.")).toBeVisible();

    await moderatorPage.reload();
    await noteRows(moderatorPage)
      .first()
      .getByRole("button", { name: "Remove" })
      .click();
    await moderatorPage.getByRole("button", { name: "Save" }).click();
    await expect(moderatorPage.getByText("Saved.")).toBeVisible();

    await moderatorPage.reload();
    await expect(moderatorPage.getByText("No notes recorded.")).toBeVisible();
  });

  test("gives each event its own note group", async ({ moderatorPage }) => {
    const id = await scratch.create("Eventnotes");
    const { error } = await admin.from("event").insert({
      owner_type: "person",
      person_id: id,
      type: "immigration",
    });
    expect(error).toBeNull();

    await openSection(moderatorPage, id);
    await expect(
      moderatorPage.getByRole("heading", { name: "About their Immigration" }),
    ).toBeVisible();

    // Each group adds into itself, not into the person's list.
    const group = moderatorPage
      .locator("div")
      .filter({
        has: moderatorPage.getByRole("heading", {
          name: "About their Immigration",
        }),
      })
      .last();
    await group.getByRole("button", { name: "Add a note" }).click();
    await group.getByLabel("Note").fill("Sailed from Gothenburg.");
    await moderatorPage.getByRole("button", { name: "Save" }).click();
    await expect(moderatorPage.getByText("Saved.")).toBeVisible();

    await moderatorPage.reload();
    await expect(
      moderatorPage.getByRole("heading", { name: "About this person" }),
    ).toBeVisible();
    await expect(moderatorPage.getByText("No notes recorded.")).toHaveCount(1);
    await expect(
      noteRows(moderatorPage).first().getByLabel("Note"),
    ).toHaveValue("Sailed from Gothenburg.");
  });
});
