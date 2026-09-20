import type { Locator, Page } from "@playwright/test";

import { fixtureIds, fixtureNames } from "../support/fixture-data";
import { scratchPersons } from "../support/scratch";
import { admin } from "../support/supabase-admin";
import { alerts, expect, test } from "../support/test";

/**
 * `?section=events` — the Events list editor and the two shared inputs it
 * carries, `DateInput` and `PlaceInput` (SPEC §8.3, issues #28, #57).
 *
 * A person with no union has exactly one events list, so every locator here
 * resolves without scoping. The union-events group is checked on the fixture
 * couple instead, read-only, since that row is shared with other specs.
 */

const scratch = scratchPersons();

/**
 * `place` is shared reference data, not owned by a person, so a place this
 * spec types into an event outlives the scratch person it was typed on, and
 * the sweep below has to remove it by name.
 *
 * Each name is made unique per test. A fixed set was deleted out from under
 * a still-running test by the `afterAll` of whichever worker finished first
 * — the same shape of cross-worker race the accounts helpers avoid.
 */
const createdPlaces: string[] = [];

/** Registered for cleanup on the way out. A name a test types but never
 * saves has no row to delete, which the sweep treats as nothing to do. */
function placeName(base: string): string {
  const name = `${base} ${crypto.randomUUID().slice(0, 8)}`;
  createdPlaces.push(name);
  return name;
}

test.afterAll(async () => {
  await scratch.remove();
  if (createdPlaces.length === 0) {
    return;
  }
  const { error } = await admin
    .from("place")
    .delete()
    .in("name", createdPlaces);
  if (error !== null) {
    throw new Error(`place cleanup failed: ${error.message}`);
  }
});

function eventRows(page: Page): Locator {
  return page
    .getByRole("listitem")
    .filter({ has: page.getByRole("button", { name: "Remove" }) });
}

async function openSection(page: Page, personId: string): Promise<void> {
  await page.goto(`/person/${personId}/edit?section=events`);
  await expect(
    page.getByRole("heading", { level: 2, name: "Events" }),
  ).toBeVisible();
}

async function addEvent(page: Page): Promise<Locator> {
  await page.getByRole("button", { name: "Add an event" }).click();
  return eventRows(page).last();
}

test.describe("the Events section", () => {
  test("starts empty and says so", async ({ moderatorPage }) => {
    const id = await scratch.create("Noevents");
    await openSection(moderatorPage, id);
    await expect(moderatorPage.getByText("No events recorded.")).toBeVisible();
    await expect(
      moderatorPage.getByRole("button", { name: "Save" }),
    ).toBeDisabled();
  });

  test("Add an event appends a row with every field", async ({
    moderatorPage,
  }) => {
    const id = await scratch.create("Addsevent");
    await openSection(moderatorPage, id);
    const row = await addEvent(moderatorPage);

    for (const label of ["Type", "Date", "Place", "Value", "Age"]) {
      await expect(row.getByLabel(label)).toBeVisible();
    }
    // `Event name` only appears for the `other` type.
    await expect(row.getByLabel("Event name")).toHaveCount(0);
  });

  test("the Type select offers the GEDCOM event types", async ({
    moderatorPage,
  }) => {
    const id = await scratch.create("Eventtypes");
    await openSection(moderatorPage, id);
    const type = (await addEvent(moderatorPage)).getByLabel("Type");

    await expect(type).toHaveValue("");
    for (const label of ["Birth", "Death", "Census", "Bar Mitzvah"]) {
      await expect(type.getByRole("option", { name: label })).toHaveCount(1);
    }
    await type.selectOption({ label: "Census" });
    await expect(type).toHaveValue("census");
  });

  test("choosing Other reveals the free-text event name", async ({
    moderatorPage,
  }) => {
    const id = await scratch.create("Othertype");
    await openSection(moderatorPage, id);
    const row = await addEvent(moderatorPage);

    await row.getByLabel("Type").selectOption({ label: "Other" });
    await expect(row.getByLabel("Event name")).toBeVisible();

    await row.getByLabel("Type").selectOption({ label: "Birth" });
    await expect(row.getByLabel("Event name")).toHaveCount(0);
  });

  test("saves a filled event and reads it back", async ({ moderatorPage }) => {
    const id = await scratch.create("Savesevent");
    await openSection(moderatorPage, id);
    const row = await addEvent(moderatorPage);

    await row.getByLabel("Type").selectOption({ label: "Census" });
    await row.getByLabel("Date").fill("abt 1880");
    const place = placeName("Qatestsshamn, Norrbotten");
    await row.getByLabel("Place").fill(place);
    await row.getByLabel("Value").fill("Roll 42");
    await row.getByLabel("Age").fill("34y");
    await moderatorPage.getByRole("button", { name: "Save" }).click();
    await expect(moderatorPage.getByText("Saved.")).toBeVisible();

    await moderatorPage.reload();
    const saved = eventRows(moderatorPage).first();
    await expect(saved.getByLabel("Type")).toHaveValue("census");
    await expect(saved.getByLabel("Date")).toHaveValue("abt 1880");
    await expect(saved.getByLabel("Place")).toHaveValue(place);
    await expect(saved.getByLabel("Value")).toHaveValue("Roll 42");
    await expect(saved.getByLabel("Age")).toHaveValue("34y");
  });

  test("a saved event shows on the profile timeline", async ({
    moderatorPage,
  }) => {
    const id = await scratch.create("Timelined");
    await openSection(moderatorPage, id);
    const row = await addEvent(moderatorPage);
    await row.getByLabel("Type").selectOption({ label: "Graduation" });
    await row.getByLabel("Date").fill("1922");
    await moderatorPage.getByRole("button", { name: "Save" }).click();
    await expect(moderatorPage.getByText("Saved.")).toBeVisible();

    await moderatorPage.goto(`/person/${id}`);
    await expect(moderatorPage.getByText("Graduation")).toBeVisible();
    await expect(moderatorPage.getByText("1922")).toBeVisible();
  });

  test("Remove drops a saved event for good", async ({ moderatorPage }) => {
    const id = await scratch.create("Dropsevent");
    await openSection(moderatorPage, id);
    const row = await addEvent(moderatorPage);
    await row.getByLabel("Type").selectOption({ label: "Burial" });
    await moderatorPage.getByRole("button", { name: "Save" }).click();
    await expect(moderatorPage.getByText("Saved.")).toBeVisible();

    await moderatorPage.reload();
    await eventRows(moderatorPage)
      .first()
      .getByRole("button", { name: "Remove" })
      .click();
    await moderatorPage.getByRole("button", { name: "Save" }).click();
    await expect(moderatorPage.getByText("Saved.")).toBeVisible();

    await moderatorPage.reload();
    await expect(moderatorPage.getByText("No events recorded.")).toBeVisible();
  });

  test("refuses a stale save (decision 26)", async ({ moderatorPage }) => {
    const id = await scratch.create("Staleevent");
    await openSection(moderatorPage, id);
    const row = await addEvent(moderatorPage);
    await row.getByLabel("Type").selectOption({ label: "Residence" });
    await moderatorPage.getByRole("button", { name: "Save" }).click();
    await expect(moderatorPage.getByText("Saved.")).toBeVisible();

    await moderatorPage.reload();
    await eventRows(moderatorPage).first().getByLabel("Value").fill("Mine");

    // Another moderator edits the same row while this page holds its token.
    const { error } = await admin
      .from("event")
      .update({ value: "Theirs" })
      .eq("person_id", id);
    expect(error).toBeNull();

    await moderatorPage.getByRole("button", { name: "Save" }).click();
    await expect(
      moderatorPage.getByRole("alertdialog", {
        name: /changed while you had (it|them) open/i,
      }),
    ).toBeVisible();
  });

  test("groups a couple's union events under their own heading", async ({
    moderatorPage,
  }) => {
    await moderatorPage.goto(
      `/person/${fixtureIds.viewerPerson}/edit?section=events`,
    );
    await expect(
      moderatorPage.getByRole("heading", {
        level: 3,
        name: new RegExp(fixtureNames.viewerSpouse),
      }),
    ).toBeVisible();
    await expect(
      moderatorPage.getByText("No union events recorded."),
    ).toBeVisible();
  });
});

test.describe("the date field", () => {
  const CASES = [
    ["14 FEB 1750", "14 February 1750"],
    ["abt 1850", "About 1850"],
    ["bef 1900", "Before 1900"],
    ["aft 1900", "After 1900"],
    ["bet 1850 and 1860", "Between 1850 and 1860"],
    ["from 1850 to 1860", "From 1850 to 1860"],
    ["est 1850", "Estimated 1850"],
    ["cal 1850", "Calculated 1850"],
  ] as const;

  test("shows the shorthand hint while it is blank", async ({
    moderatorPage,
  }) => {
    const id = await scratch.create("Datehint");
    await openSection(moderatorPage, id);
    const row = await addEvent(moderatorPage);
    await expect(row.getByText("abt · bef · aft · bet … and …")).toBeVisible();
  });

  for (const [typed, preview] of CASES) {
    test(`interprets "${typed}" as "${preview}"`, async ({ moderatorPage }) => {
      const id = await scratch.create("Datecase");
      await openSection(moderatorPage, id);
      const row = await addEvent(moderatorPage);
      await row.getByLabel("Date").fill(typed);
      await expect(row.getByText(`→ ${preview}`)).toBeVisible();
    });
  }

  test("flags text it cannot parse, and still saves it", async ({
    moderatorPage,
  }) => {
    const id = await scratch.create("Datephrase");
    await openSection(moderatorPage, id);
    const row = await addEvent(moderatorPage);
    await row.getByLabel("Type").selectOption({ label: "Birth" });
    await row.getByLabel("Date").fill("sometime last century");
    await expect(
      row.getByText("Not recognized — will save as free text:"),
    ).toBeVisible();

    await moderatorPage.getByRole("button", { name: "Save" }).click();
    await expect(moderatorPage.getByText("Saved.")).toBeVisible();
    await moderatorPage.reload();
    await expect(
      eventRows(moderatorPage).first().getByLabel("Date"),
    ).toHaveValue("sometime last century");
  });
});

test.describe("the place field", () => {
  /**
   * The suite owns no `place` rows, so this test makes the one it searches
   * for — which also covers the other half of the contract: a place typed
   * free-hand is created at save time (`findOrCreatePlaceId`), not dropped.
   */
  test("creates a typed place, then suggests it next time", async ({
    moderatorPage,
  }) => {
    const place = placeName("Qatestssonhamn, Norrbotten");
    const first = await scratch.create("Placemaker");
    await openSection(moderatorPage, first);
    const row = await addEvent(moderatorPage);
    await row.getByLabel("Type").selectOption({ label: "Residence" });
    await row.getByLabel("Place").fill(place);
    await moderatorPage.getByRole("button", { name: "Save" }).click();
    await expect(moderatorPage.getByText("Saved.")).toBeVisible();

    const second = await scratch.create("Placereader");
    await openSection(moderatorPage, second);
    const next = await addEvent(moderatorPage);
    await next.getByLabel("Place").fill(place);
    // A `<datalist>` option carries its text in `value`, not as content, so
    // the suggestions are read attribute-side rather than by `hasText`.
    await expect
      .poll(
        async () =>
          next
            .locator("datalist option")
            .evaluateAll((options) =>
              options.map((option) => (option as HTMLOptionElement).value),
            ),
        { timeout: 15_000 },
      )
      .toContain(place);
  });

  test("keeps a place that matches nothing", async ({ moderatorPage }) => {
    const id = await scratch.create("Placenew");
    await openSection(moderatorPage, id);
    const row = await addEvent(moderatorPage);
    await row.getByLabel("Type").selectOption({ label: "Residence" });
    const place = placeName("Nowhere-In-Particular, Qatestssonia");
    await row.getByLabel("Place").fill(place);
    await moderatorPage.getByRole("button", { name: "Save" }).click();
    await expect(moderatorPage.getByText("Saved.")).toBeVisible();

    await moderatorPage.reload();
    await expect(
      eventRows(moderatorPage).first().getByLabel("Place"),
    ).toHaveValue(place);
    await expect(alerts(moderatorPage)).toHaveCount(0);
  });
});
