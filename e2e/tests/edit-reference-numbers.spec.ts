import type { Page } from "@playwright/test";

import { scratchPersons } from "../support/scratch";
import { admin } from "../support/supabase-admin";
import { expect, test } from "../support/test";

/**
 * `?section=reference-numbers` — the three external-identifier fields
 * (SPEC §8.3, issue #33). A single-record section rather than a list, so it
 * is the simplest case of the shared save lifecycle: dirty → save → clean.
 */

const scratch = scratchPersons();

test.afterAll(async () => {
  await scratch.remove();
});

const FIELDS = [
  "FamilySearch ID",
  "Ancestral File Number",
  "User Reference Number",
];

async function openSection(page: Page, personId: string): Promise<void> {
  await page.goto(`/person/${personId}/edit?section=reference-numbers`);
  await expect(
    page.getByRole("heading", { level: 2, name: "Reference Numbers" }),
  ).toBeVisible();
}

test.describe("the Reference Numbers section", () => {
  test("offers all three fields, empty", async ({ moderatorPage }) => {
    const id = await scratch.create("Norefs");
    await openSection(moderatorPage, id);

    for (const label of FIELDS) {
      await expect(moderatorPage.getByLabel(label)).toHaveValue("");
    }
    await expect(
      moderatorPage.getByRole("button", { name: "Save" }),
    ).toBeDisabled();
  });

  test("typing in any one field enables Save", async ({ moderatorPage }) => {
    const id = await scratch.create("Dirtyref");
    await openSection(moderatorPage, id);
    await moderatorPage.getByLabel("FamilySearch ID").fill("KWZC-1QQ");
    await expect(
      moderatorPage.getByRole("button", { name: "Save" }),
    ).toBeEnabled();
  });

  test("saves all three and reads them back", async ({ moderatorPage }) => {
    const id = await scratch.create("Savesrefs");
    await openSection(moderatorPage, id);

    await moderatorPage.getByLabel("FamilySearch ID").fill("KWZC-1QQ");
    await moderatorPage.getByLabel("Ancestral File Number").fill("1234-AB");
    await moderatorPage.getByLabel("User Reference Number").fill("REFN-99");
    await moderatorPage.getByRole("button", { name: "Save" }).click();
    await expect(moderatorPage.getByText("Saved.")).toBeVisible();

    await moderatorPage.reload();
    await expect(moderatorPage.getByLabel("FamilySearch ID")).toHaveValue(
      "KWZC-1QQ",
    );
    await expect(moderatorPage.getByLabel("Ancestral File Number")).toHaveValue(
      "1234-AB",
    );
    await expect(moderatorPage.getByLabel("User Reference Number")).toHaveValue(
      "REFN-99",
    );
  });

  test("clearing a saved value saves the blank back", async ({
    moderatorPage,
  }) => {
    const id = await scratch.create("Clearsref");
    await openSection(moderatorPage, id);
    await moderatorPage.getByLabel("FamilySearch ID").fill("TEMP-1");
    await moderatorPage.getByRole("button", { name: "Save" }).click();
    await expect(moderatorPage.getByText("Saved.")).toBeVisible();

    await moderatorPage.getByLabel("FamilySearch ID").fill("");
    await moderatorPage.getByRole("button", { name: "Save" }).click();
    await expect(moderatorPage.getByText("Saved.")).toBeVisible();

    await moderatorPage.reload();
    await expect(moderatorPage.getByLabel("FamilySearch ID")).toHaveValue("");
  });

  test("shows the GEDCOM hint on the user reference field", async ({
    moderatorPage,
  }) => {
    const id = await scratch.create("Refhint");
    await openSection(moderatorPage, id);
    await expect(
      moderatorPage.getByLabel("User Reference Number"),
    ).toHaveAttribute("placeholder", "GEDCOM REFN");
  });

  test("offers a conflict choice when the row moved on", async ({
    moderatorPage,
  }) => {
    const id = await scratch.create("Staleref");
    await openSection(moderatorPage, id);
    await moderatorPage.getByLabel("FamilySearch ID").fill("MINE-1");

    const { error } = await admin
      .from("person")
      .update({ familysearch_id: "THEIRS-1" })
      .eq("id", id);
    expect(error).toBeNull();

    await moderatorPage.getByRole("button", { name: "Save" }).click();
    const dialog = moderatorPage.getByRole("alertdialog");
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText("MINE-1")).toBeVisible();
    await expect(dialog.getByText("THEIRS-1")).toBeVisible();

    await dialog.getByRole("button", { name: "Take theirs" }).click();
    await expect(dialog).toBeHidden();
    await expect(moderatorPage.getByLabel("FamilySearch ID")).toHaveValue(
      "THEIRS-1",
    );
  });
});
