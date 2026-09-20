import type { Locator, Page } from "@playwright/test";

import { scratchPersons } from "../support/scratch";
import { admin } from "../support/supabase-admin";
import { expect, test } from "../support/test";

/**
 * `?section=facts` — the Facts list editor (SPEC §8.3, §4.2, issue #30).
 *
 * Facts carry two things events do not: a per-fact visibility control, and a
 * sensitivity rule derived from the type alone (`ssn`, `national_id`,
 * `medical`). Both are clicked here, including the case the control locks
 * itself: a stored visibility outside the two options this view offers.
 */

const scratch = scratchPersons();

test.afterAll(async () => {
  await scratch.remove();
});

function factRows(page: Page): Locator {
  return page
    .getByRole("listitem")
    .filter({ has: page.getByRole("button", { name: "Remove" }) });
}

async function openSection(page: Page, personId: string): Promise<void> {
  await page.goto(`/person/${personId}/edit?section=facts`);
  await expect(
    page.getByRole("heading", { level: 2, name: "Facts" }),
  ).toBeVisible();
}

async function addFact(page: Page): Promise<Locator> {
  await page.getByRole("button", { name: "Add a fact" }).click();
  return factRows(page).last();
}

test.describe("the Facts section", () => {
  test("starts empty and says so", async ({ moderatorPage }) => {
    const id = await scratch.create("Nofacts");
    await openSection(moderatorPage, id);
    await expect(moderatorPage.getByText("No facts recorded.")).toBeVisible();
    await expect(
      moderatorPage.getByRole("button", { name: "Save" }),
    ).toBeDisabled();
  });

  test("Add a fact appends a row with every field", async ({
    moderatorPage,
  }) => {
    const id = await scratch.create("Addsfact");
    await openSection(moderatorPage, id);
    const row = await addFact(moderatorPage);

    for (const label of ["Type", "Date", "Place", "Value", "Visibility"]) {
      await expect(row.getByLabel(label)).toBeVisible();
    }
    await expect(row.getByLabel("Fact name")).toHaveCount(0);
  });

  test("a row with no type chosen is not worth saving", async ({
    moderatorPage,
  }) => {
    const id = await scratch.create("Typeless");
    await openSection(moderatorPage, id);
    const row = await addFact(moderatorPage);
    const save = moderatorPage.getByRole("button", { name: "Save" });

    // `fact.type` is the one not-null column, so a row without it is dropped
    // from the diff rather than rejected by the database (`lib/edit/facts.ts`).
    await row.getByLabel("Value").fill("Hazel");
    await expect(save).toBeDisabled();

    await row.getByLabel("Type").selectOption({ label: "Eye color" });
    await expect(save).toBeEnabled();
  });

  test("choosing Other reveals the free-text fact name", async ({
    moderatorPage,
  }) => {
    const id = await scratch.create("Otherfact");
    await openSection(moderatorPage, id);
    const row = await addFact(moderatorPage);

    await row.getByLabel("Type").selectOption({ label: "Other" });
    await expect(row.getByLabel("Fact name")).toBeVisible();

    await row.getByLabel("Type").selectOption({ label: "Religion" });
    await expect(row.getByLabel("Fact name")).toHaveCount(0);
  });

  test("the Visibility select offers the two in-scope levels", async ({
    moderatorPage,
  }) => {
    const id = await scratch.create("Factvis");
    await openSection(moderatorPage, id);
    const visibility = (await addFact(moderatorPage)).getByLabel("Visibility");

    await expect(visibility).toBeEnabled();
    await expect(visibility.getByRole("option")).toHaveCount(2);
    await expect(visibility).toHaveValue("everyone_approved");
    await visibility.selectOption({ label: "Hidden (moderators only)" });
    await expect(visibility).toHaveValue("hidden");
  });

  for (const label of ["Social Security Number", "National ID", "Medical"]) {
    test(`flags ${label} as sensitive the moment it is chosen`, async ({
      moderatorPage,
    }) => {
      const id = await scratch.create("Sensitive");
      await openSection(moderatorPage, id);
      const row = await addFact(moderatorPage);

      await expect(row.getByText(/^Sensitive —/)).toHaveCount(0);
      await row.getByLabel("Type").selectOption({ label });
      await expect(row.getByText(/^Sensitive —/)).toBeVisible();
    });
  }

  test("does not flag an ordinary fact type as sensitive", async ({
    moderatorPage,
  }) => {
    const id = await scratch.create("Notsensitive");
    await openSection(moderatorPage, id);
    const row = await addFact(moderatorPage);
    await row.getByLabel("Type").selectOption({ label: "Occupation" });
    await expect(row.getByText(/^Sensitive —/)).toHaveCount(0);
  });

  test("saves a filled fact and reads it back", async ({ moderatorPage }) => {
    const id = await scratch.create("Savesfact");
    await openSection(moderatorPage, id);
    const row = await addFact(moderatorPage);

    await row.getByLabel("Type").selectOption({ label: "Occupation" });
    await row.getByLabel("Date").fill("1930");
    await row.getByLabel("Value").fill("Boat builder");
    await row
      .getByLabel("Visibility")
      .selectOption({ label: "Hidden (moderators only)" });
    await moderatorPage.getByRole("button", { name: "Save" }).click();
    await expect(moderatorPage.getByText("Saved.")).toBeVisible();

    await moderatorPage.reload();
    const saved = factRows(moderatorPage).first();
    await expect(saved.getByLabel("Type")).toHaveValue("occupation");
    await expect(saved.getByLabel("Date")).toHaveValue("1930");
    await expect(saved.getByLabel("Value")).toHaveValue("Boat builder");
    await expect(saved.getByLabel("Visibility")).toHaveValue("hidden");
  });

  test("Remove drops a saved fact for good", async ({ moderatorPage }) => {
    const id = await scratch.create("Dropsfact");
    await openSection(moderatorPage, id);
    const row = await addFact(moderatorPage);
    await row.getByLabel("Type").selectOption({ label: "Height" });
    await moderatorPage.getByRole("button", { name: "Save" }).click();
    await expect(moderatorPage.getByText("Saved.")).toBeVisible();

    await moderatorPage.reload();
    await factRows(moderatorPage)
      .first()
      .getByRole("button", { name: "Remove" })
      .click();
    await moderatorPage.getByRole("button", { name: "Save" }).click();
    await expect(moderatorPage.getByText("Saved.")).toBeVisible();

    await moderatorPage.reload();
    await expect(moderatorPage.getByText("No facts recorded.")).toBeVisible();
  });

  /**
   * `close_family` and `moderators_only` are reachable by import or direct
   * SQL but have no option in this control. Left enabled, touching it at all
   * would silently downgrade the stored value, so the control locks instead.
   */
  test("locks Visibility for a level this view cannot set", async ({
    moderatorPage,
  }) => {
    const id = await scratch.create("Outofscope");
    const { error } = await admin.from("fact").insert({
      owner_type: "person",
      person_id: id,
      type: "religion",
      value: "Out of scope",
      visibility: "moderators_only",
    });
    expect(error).toBeNull();

    await openSection(moderatorPage, id);
    const row = factRows(moderatorPage).first();
    await expect(row.getByLabel("Visibility")).toBeDisabled();
    await expect(
      row.getByText(/outside what this view can change/),
    ).toBeVisible();
  });
});
