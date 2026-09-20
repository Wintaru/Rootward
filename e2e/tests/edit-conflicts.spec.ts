import type { Locator, Page } from "@playwright/test";

import { scratchPersons } from "../support/scratch";
import { admin } from "../support/supabase-admin";
import { expect, test } from "../support/test";

/**
 * The shared `ConflictDialog` (SPEC §8.3, WAYFINDER decision 26, issue #31).
 *
 * Every list section funnels a rejected save into the same dialog, so its
 * three buttons are exercised once, here, against the Events section. What
 * matters is not that the dialog appears — `edit-events.spec.ts` covers that
 * — but that each choice leaves the right value in the database afterwards.
 */

const scratch = scratchPersons();

test.afterAll(async () => {
  await scratch.remove();
});

function eventRows(page: Page): Locator {
  return page
    .getByRole("listitem")
    .filter({ has: page.getByRole("button", { name: "Remove" }) });
}

/** Stands in for another moderator saving the same row. A silent no-op here
 * would read as "no conflict dialog appeared" rather than "the setup never
 * happened", so the result is checked. */
async function otherModeratorSets(
  personId: string,
  value: string,
): Promise<void> {
  const { error } = await admin
    .from("event")
    .update({ value })
    .eq("person_id", personId);
  if (error !== null) {
    throw new Error(`concurrent update failed: ${error.message}`);
  }
}

async function otherModeratorDeletes(personId: string): Promise<void> {
  const { error } = await admin
    .from("event")
    .delete()
    .eq("person_id", personId);
  if (error !== null) {
    throw new Error(`concurrent delete failed: ${error.message}`);
  }
}

/** A person with one saved event, opened at the Events section with a local
 * edit already typed into it — the state every case below starts from. */
async function personWithPendingEdit(
  page: Page,
  slug: string,
  mine: string,
): Promise<string> {
  const id = await scratch.create(slug);
  const { error } = await admin.from("event").insert({
    owner_type: "person",
    person_id: id,
    type: "residence",
    value: "Original",
  });
  if (error !== null) {
    throw new Error(`event insert failed: ${error.message}`);
  }

  await page.goto(`/person/${id}/edit?section=events`);
  await expect(
    page.getByRole("heading", { level: 2, name: "Events" }),
  ).toBeVisible();
  await eventRows(page).first().getByLabel("Value").fill(mine);
  return id;
}

async function storedValue(personId: string): Promise<string | null> {
  const { data, error } = await admin
    .from("event")
    .select("value")
    .eq("person_id", personId)
    .maybeSingle();
  if (error !== null) {
    throw new Error(`event read failed: ${error.message}`);
  }
  return data?.value ?? null;
}

test.describe("a save that lost a race", () => {
  test("Keep mine re-saves the local edit over theirs", async ({
    moderatorPage,
  }) => {
    const id = await personWithPendingEdit(moderatorPage, "Keepsmine", "Mine");
    await otherModeratorSets(id, "Theirs");

    await moderatorPage.getByRole("button", { name: "Save" }).click();
    const dialog = moderatorPage.getByRole("alertdialog");
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Keep mine" }).click();

    await expect(dialog).toBeHidden();
    await expect
      .poll(async () => storedValue(id), { timeout: 10_000 })
      .toBe("Mine");
  });

  test("Take theirs drops the local edit", async ({ moderatorPage }) => {
    const id = await personWithPendingEdit(
      moderatorPage,
      "Takestheirs",
      "Mine",
    );
    await otherModeratorSets(id, "Theirs");

    await moderatorPage.getByRole("button", { name: "Save" }).click();
    const dialog = moderatorPage.getByRole("alertdialog");
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Take theirs" }).click();

    await expect(dialog).toBeHidden();
    await expect(
      eventRows(moderatorPage).first().getByLabel("Value"),
    ).toHaveValue("Theirs");
    expect(await storedValue(id)).toBe("Theirs");
  });

  test("names both versions side by side before the choice", async ({
    moderatorPage,
  }) => {
    // Values that cannot collide with the dialog's own "Yours"/"Theirs"
    // column headers.
    const id = await personWithPendingEdit(
      moderatorPage,
      "Showsboth",
      "Myversion",
    );
    await otherModeratorSets(id, "Otherversion");

    await moderatorPage.getByRole("button", { name: "Save" }).click();
    const dialog = moderatorPage.getByRole("alertdialog");
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText("Yours")).toBeVisible();
    await expect(dialog.getByText("Theirs", { exact: true })).toBeVisible();
    await expect(dialog.getByText("Myversion")).toBeVisible();
    await expect(dialog.getByText("Otherversion")).toBeVisible();
    await expect(
      dialog.getByText("Changed while you had it open."),
    ).toBeVisible();
  });

  test("offers only Discard when the row was deleted meanwhile", async ({
    moderatorPage,
  }) => {
    const id = await personWithPendingEdit(moderatorPage, "Wasdeleted", "Mine");
    await otherModeratorDeletes(id);

    await moderatorPage.getByRole("button", { name: "Save" }).click();
    const dialog = moderatorPage.getByRole("alertdialog");
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText(/was deleted/i)).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Keep mine" })).toHaveCount(
      0,
    );

    await dialog.getByRole("button", { name: "Discard my change" }).click();
    await expect(dialog).toBeHidden();
    await expect(moderatorPage.getByText("No events recorded.")).toBeVisible();
    expect(await storedValue(id)).toBeNull();
  });

  test("the dialog blocks the page until it is answered", async ({
    moderatorPage,
  }) => {
    const id = await personWithPendingEdit(moderatorPage, "Blocking", "Mine");
    await otherModeratorSets(id, "Theirs");

    await moderatorPage.getByRole("button", { name: "Save" }).click();
    const dialog = moderatorPage.getByRole("alertdialog");
    await expect(dialog).toBeVisible();
    await expect(dialog).toHaveAttribute("aria-modal", "true");
    await expect(
      moderatorPage.getByRole("heading", {
        name: /changed while you had (it|them) open/i,
      }),
    ).toBeVisible();
  });
});
