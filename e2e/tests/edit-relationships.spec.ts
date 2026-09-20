import type { Locator, Page } from "@playwright/test";

import { fixtureNames, SCRATCH_SURNAME } from "../support/fixture-data";
import { removeEmptiedFamilies, scratchPersons } from "../support/scratch";
import { admin } from "../support/supabase-admin";
import { alerts, expect, test } from "../support/test";

/**
 * `?section=relationships` — the Relationships editor (SPEC §8.3, issues
 * #34, #56).
 *
 * Unlike the other sections this one has no Save button: every control
 * writes straight through a server action and the page re-renders. So each
 * test here asserts the tree afterwards, not a "Saved." line.
 *
 * `PersonPickerOrCreate` is the entry point for all four "add" paths, so its
 * two modes — pick an existing person, or create one inline — are covered
 * once each and then reused.
 */

const scratch = scratchPersons();

/** Every person this spec creates through the picker, so they can be swept
 * even though the picker never hands back an id. */
const inlineNames: string[] = [];

function inlineName(base: string): string {
  const name = `${base}${crypto.randomUUID().slice(0, 8)}`;
  inlineNames.push(name);
  return name;
}

test.afterAll(async () => {
  if (inlineNames.length > 0) {
    const created = await admin
      .from("person")
      .select("id")
      .in("given_name", inlineNames);
    if (created.error !== null) {
      throw new Error(`inline person read failed: ${created.error.message}`);
    }
    await removeEmptiedFamilies((created.data ?? []).map((row) => row.id));

    const removed = await admin
      .from("person")
      .delete()
      .in("given_name", inlineNames);
    if (removed.error !== null) {
      throw new Error(`inline person delete failed: ${removed.error.message}`);
    }
    inlineNames.length = 0;
  }
  await scratch.remove();
});

async function openSection(page: Page, personId: string): Promise<void> {
  await page.goto(`/person/${personId}/edit?section=relationships`);
  await expect(
    page.getByRole("heading", { level: 2, name: "Relationships" }),
  ).toBeVisible();
}

/**
 * The edit shell itself lists a person's parents, partners and children in
 * its header and footer strips, with the same names and the same "No parents
 * recorded." copy the section uses. Every locator below is scoped to `main`
 * so it reads the editable controls and never those read-only strips.
 */
function editor(page: Page): Locator {
  return page.getByRole("main");
}

/** Fills `PersonPickerOrCreate`'s inline create form and submits it. */
async function createInlinePerson(
  page: Page,
  openLabel: string,
  givenName: string,
  sex: "Male" | "Female" | "Unknown",
): Promise<void> {
  const main = page.getByRole("main");
  await main.getByRole("button", { name: openLabel, exact: true }).click();
  await main.getByRole("button", { name: "Or create a new person" }).click();
  await main.getByLabel("Given name").fill(givenName);
  await main.getByLabel("Surname").fill(SCRATCH_SURNAME);
  await main.getByLabel("Sex").selectOption({ label: sex });
  await main
    .getByRole("button", { name: openLabel, exact: true })
    .last()
    .click();
}

function unionsPanel(page: Page): Locator {
  return editor(page)
    .locator("section")
    .filter({
      has: page.getByRole("heading", { name: "Partners & children" }),
    });
}

function parentsPanel(page: Page): Locator {
  return editor(page)
    .locator("section")
    .filter({ has: page.getByRole("heading", { name: "Parents" }) });
}

test.describe("the Relationships section", () => {
  test("says so when a person has no relatives at all", async ({
    moderatorPage,
  }) => {
    const id = await scratch.create("Norelatives");
    await openSection(moderatorPage, id);

    await expect(
      editor(moderatorPage).getByText("No parents recorded."),
    ).toBeVisible();
    await expect(
      editor(moderatorPage).getByText("No partners recorded."),
    ).toBeVisible();
    await expect(
      editor(moderatorPage).getByRole("button", { name: "Add a parent" }),
    ).toBeVisible();
    await expect(
      editor(moderatorPage).getByRole("button", { name: "Start a new union" }),
    ).toBeVisible();
  });

  test("the picker offers a create form and a way back out", async ({
    moderatorPage,
  }) => {
    const id = await scratch.create("Cancelspicker");
    await openSection(moderatorPage, id);

    const main = editor(moderatorPage);
    await main
      .getByRole("button", { name: "Add a parent", exact: true })
      .click();
    await expect(main.getByLabel("Add a parent")).toBeVisible();

    await main.getByRole("button", { name: "Or create a new person" }).click();
    for (const label of ["Given name", "Surname", "Sex"]) {
      await expect(main.getByLabel(label)).toBeVisible();
    }

    await main.getByRole("button", { name: "Cancel" }).click();
    await expect(main.getByLabel("Add a parent")).toBeVisible();
    await expect(main.getByLabel("Given name")).toHaveCount(0);
  });

  test("the picker finds an existing person by name", async ({
    moderatorPage,
  }) => {
    const id = await scratch.create("Findsexisting");
    await openSection(moderatorPage, id);
    const main = editor(moderatorPage);
    await main
      .getByRole("button", { name: "Add a parent", exact: true })
      .click();
    await main.getByLabel("Add a parent").fill("Gideon");

    await expect(
      main.getByRole("button", { name: fixtureNames.grandfather }),
    ).toBeVisible({ timeout: 10_000 });
  });

  test("adds a parent by creating one inline", async ({ moderatorPage }) => {
    const id = await scratch.create("Getsaparent");
    const parent = inlineName("Newparent");
    await openSection(moderatorPage, id);
    await createInlinePerson(moderatorPage, "Add a parent", parent, "Female");

    const card = parentsPanel(moderatorPage);
    await expect(card.getByText(`${parent} ${SCRATCH_SURNAME}`)).toBeVisible({
      timeout: 15_000,
    });
    await expect(
      editor(moderatorPage).getByText("No parents recorded."),
    ).toHaveCount(0);
  });

  test("a new parent shows on the profile as a parent", async ({
    moderatorPage,
  }) => {
    const id = await scratch.create("Profileparent");
    const parent = inlineName("Shownparent");
    await openSection(moderatorPage, id);
    await createInlinePerson(moderatorPage, "Add a parent", parent, "Male");
    await expect(
      parentsPanel(moderatorPage).getByText(`${parent} ${SCRATCH_SURNAME}`),
    ).toBeVisible({ timeout: 15_000 });

    await moderatorPage.goto(`/person/${id}`);
    await expect(
      moderatorPage.getByRole("heading", { name: "Parents" }),
    ).toBeVisible();
    await expect(
      moderatorPage.getByRole("link", {
        name: `${parent} ${SCRATCH_SURNAME}`,
      }),
    ).toBeVisible();
  });

  test("the second parent slot fills into the same family", async ({
    moderatorPage,
  }) => {
    const id = await scratch.create("Twoparents");
    const first = inlineName("Parentone");
    const second = inlineName("Parenttwo");
    await openSection(moderatorPage, id);
    await createInlinePerson(moderatorPage, "Add a parent", first, "Female");
    await expect(
      parentsPanel(moderatorPage).getByText(`${first} ${SCRATCH_SURNAME}`),
    ).toBeVisible({ timeout: 15_000 });

    await createInlinePerson(moderatorPage, "Add parent", second, "Male");
    const panel = parentsPanel(moderatorPage);
    await expect(panel.getByText(`${second} ${SCRATCH_SURNAME}`)).toBeVisible({
      timeout: 15_000,
    });
    await expect(
      editor(moderatorPage).getByText("Both parents are set."),
    ).toBeVisible();
  });

  test("Remove from this family detaches the child again", async ({
    moderatorPage,
  }) => {
    const id = await scratch.create("Detaches");
    const parent = inlineName("Droppedparent");
    await openSection(moderatorPage, id);
    await createInlinePerson(moderatorPage, "Add a parent", parent, "Female");
    await expect(
      parentsPanel(moderatorPage).getByText(`${parent} ${SCRATCH_SURNAME}`),
    ).toBeVisible({ timeout: 15_000 });

    await moderatorPage
      .getByRole("main")
      .getByRole("button", { name: "Remove from this family" })
      .click();
    await expect(
      editor(moderatorPage).getByText("No parents recorded."),
    ).toBeVisible({
      timeout: 15_000,
    });
  });

  test("starts a union, sets its type, and adds a child", async ({
    moderatorPage,
  }) => {
    const id = await scratch.create("Makesunion", "male");
    const partner = inlineName("Newpartner");
    const child = inlineName("Newchild");
    await openSection(moderatorPage, id);

    await createInlinePerson(
      moderatorPage,
      "Start a new union",
      partner,
      "Female",
    );
    const panel = unionsPanel(moderatorPage);
    await expect(panel.getByText(`${partner} ${SCRATCH_SURNAME}`)).toBeVisible({
      timeout: 15_000,
    });

    const unionType = editor(moderatorPage).getByLabel("Union type");
    await expect(unionType).toHaveValue("");
    await unionType.selectOption({ label: "Married" });
    await expect(unionType).toHaveValue("married", { timeout: 15_000 });

    await expect(
      editor(moderatorPage).getByText("No children recorded."),
    ).toBeVisible();
    await createInlinePerson(moderatorPage, "Add a child", child, "Unknown");
    await expect(
      unionsPanel(moderatorPage).getByText(`${child} ${SCRATCH_SURNAME}`),
    ).toBeVisible({ timeout: 15_000 });
    await expect(
      editor(moderatorPage).getByText("No children recorded."),
    ).toHaveCount(0);
  });

  test("a union's partner role can be changed and removed", async ({
    moderatorPage,
  }) => {
    const id = await scratch.create("Rolechanger", "male");
    const partner = inlineName("Rolepartner");
    await openSection(moderatorPage, id);
    await createInlinePerson(
      moderatorPage,
      "Start a new union",
      partner,
      "Female",
    );
    const panel = unionsPanel(moderatorPage);
    await expect(panel.getByText(`${partner} ${SCRATCH_SURNAME}`)).toBeVisible({
      timeout: 15_000,
    });

    // Each role select defaults from that person's sex — the focus person is
    // male, so slot one is husband; the partner chosen above is female, so
    // slot two starts as wife before it is changed below.
    const roles = panel.getByRole("combobox");
    await expect(roles.first()).toHaveValue("husband");
    await roles.nth(1).selectOption({ label: "Partner" });
    await expect(roles.nth(1)).toHaveValue("partner", { timeout: 15_000 });

    await panel.getByRole("button", { name: "Remove" }).last().click();
    await expect(panel.getByText(`${partner} ${SCRATCH_SURNAME}`)).toHaveCount(
      0,
      { timeout: 15_000 },
    );
    // One slot is the focus person's own; only the emptied slot reopens.
    await expect(
      panel.getByRole("button", { name: "Add partner" }),
    ).toHaveCount(1);
  });

  test("children reorder, and the end stops are disabled", async ({
    moderatorPage,
  }) => {
    const id = await scratch.create("OrdersKids", "male");
    const partner = inlineName("Kidspartner");
    const elder = inlineName("Elderkid");
    const younger = inlineName("Youngerkid");
    await openSection(moderatorPage, id);
    await createInlinePerson(
      moderatorPage,
      "Start a new union",
      partner,
      "Female",
    );
    await expect(
      unionsPanel(moderatorPage).getByText(`${partner} ${SCRATCH_SURNAME}`),
    ).toBeVisible({ timeout: 15_000 });

    for (const name of [elder, younger]) {
      await createInlinePerson(moderatorPage, "Add a child", name, "Unknown");
      await expect(
        unionsPanel(moderatorPage).getByText(`${name} ${SCRATCH_SURNAME}`),
      ).toBeVisible({ timeout: 15_000 });
    }

    const elderFull = `${elder} ${SCRATCH_SURNAME}`;
    const youngerFull = `${younger} ${SCRATCH_SURNAME}`;
    await expect(
      editor(moderatorPage).getByRole("button", {
        name: `Move ${elderFull} up`,
      }),
    ).toBeDisabled();
    await expect(
      editor(moderatorPage).getByRole("button", {
        name: `Move ${youngerFull} down`,
      }),
    ).toBeDisabled();

    await editor(moderatorPage)
      .getByRole("button", { name: `Move ${youngerFull} up` })
      .click();
    await expect(
      editor(moderatorPage).getByRole("button", {
        name: `Move ${youngerFull} up`,
      }),
    ).toBeDisabled({ timeout: 15_000 });
    await expect(alerts(moderatorPage)).toHaveCount(0);
  });

  test("a child's relation to each partner is its own control", async ({
    moderatorPage,
  }) => {
    const id = await scratch.create("Relationkid", "male");
    const partner = inlineName("Relpartner");
    const child = inlineName("Relchild");
    await openSection(moderatorPage, id);
    await createInlinePerson(
      moderatorPage,
      "Start a new union",
      partner,
      "Female",
    );
    await expect(
      unionsPanel(moderatorPage).getByText(`${partner} ${SCRATCH_SURNAME}`),
    ).toBeVisible({ timeout: 15_000 });
    await createInlinePerson(moderatorPage, "Add a child", child, "Unknown");

    const childRow = editor(moderatorPage)
      .getByRole("listitem")
      .filter({ hasText: `${child} ${SCRATCH_SURNAME}` })
      .last();
    await expect(childRow).toBeVisible({ timeout: 15_000 });
    const relations = childRow.getByRole("combobox");
    await expect(relations).toHaveCount(2);

    await relations.first().selectOption({ label: "Adopted" });
    await expect(relations.first()).toHaveValue("adopted", {
      timeout: 15_000,
    });
    await expect(relations.nth(1)).toHaveValue("");
  });

  test("a child can be removed from the family", async ({ moderatorPage }) => {
    const id = await scratch.create("Dropskid", "male");
    const partner = inlineName("Droppartner");
    const child = inlineName("Dropchild");
    await openSection(moderatorPage, id);
    await createInlinePerson(
      moderatorPage,
      "Start a new union",
      partner,
      "Female",
    );
    await expect(
      unionsPanel(moderatorPage).getByText(`${partner} ${SCRATCH_SURNAME}`),
    ).toBeVisible({ timeout: 15_000 });
    await createInlinePerson(moderatorPage, "Add a child", child, "Unknown");

    const childRow = editor(moderatorPage)
      .getByRole("listitem")
      .filter({ hasText: `${child} ${SCRATCH_SURNAME}` })
      .last();
    await expect(childRow).toBeVisible({ timeout: 15_000 });
    await childRow.getByRole("button", { name: "Remove" }).click();
    await expect(
      editor(moderatorPage).getByText("No children recorded."),
    ).toBeVisible({
      timeout: 15_000,
    });
  });
});
