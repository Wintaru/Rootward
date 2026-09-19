import { FIXTURE_SURNAME } from "../support/fixture-data";
import { admin } from "../support/supabase-admin";
import { alerts, expect, test } from "../support/test";

/**
 * `/person/new` — create a person outside the importer (SPEC §8.1, §8.3,
 * issue #55). Name and sex are all optional: a placeholder person with no
 * name at all is normal in genealogy, so "create with everything blank" is a
 * supported path, not an edge case.
 */

const created: string[] = [];

test.afterAll(async () => {
  if (created.length > 0) {
    await admin.from("person").delete().in("id", created);
  }
});

/** Pull the new person's id out of the edit URL the form redirects to. */
function idFromEditUrl(url: string): string {
  const match = /\/person\/([0-9a-f-]{36})\/edit/.exec(url);
  if (match?.[1] === undefined) {
    throw new Error(`No person id in ${url}`);
  }
  return match[1];
}

test.describe("the new-person form", () => {
  test("offers given name, surname, and sex", async ({ moderatorPage }) => {
    await moderatorPage.goto("/person/new");
    await expect(moderatorPage.getByLabel("Given name")).toBeVisible();
    await expect(moderatorPage.getByLabel("Surname")).toBeVisible();
    await expect(moderatorPage.getByLabel("Sex")).toBeVisible();
    await expect(
      moderatorPage.getByRole("button", { name: "Create person" }),
    ).toBeVisible();
  });

  test("defaults sex to unknown", async ({ moderatorPage }) => {
    await moderatorPage.goto("/person/new");
    await expect(moderatorPage.getByLabel("Sex")).toHaveValue("unknown");
  });

  test("creates a person and opens its edit view", async ({
    moderatorPage,
  }) => {
    await moderatorPage.goto("/person/new");
    await moderatorPage.getByLabel("Given name").fill("Newton");
    await moderatorPage.getByLabel("Surname").fill(FIXTURE_SURNAME);
    await moderatorPage.getByLabel("Sex").selectOption("male");
    await moderatorPage.getByRole("button", { name: "Create person" }).click();

    await moderatorPage.waitForURL(/\/person\/[0-9a-f-]{36}\/edit/);
    created.push(idFromEditUrl(moderatorPage.url()));
    await expect(
      moderatorPage.getByRole("heading", {
        level: 1,
        name: `Newton ${FIXTURE_SURNAME}`,
      }),
    ).toBeVisible();
  });

  test("creates a placeholder with no name at all", async ({
    moderatorPage,
  }) => {
    await moderatorPage.goto("/person/new");
    await moderatorPage.getByRole("button", { name: "Create person" }).click();

    await moderatorPage.waitForURL(/\/person\/[0-9a-f-]{36}\/edit/);
    created.push(idFromEditUrl(moderatorPage.url()));
    await expect(alerts(moderatorPage)).toHaveCount(0);
    const heading = moderatorPage.getByRole("heading", { level: 1 });
    await expect(heading).not.toHaveText("");
  });

  test("the new person is findable afterwards", async ({ moderatorPage }) => {
    await moderatorPage.goto("/person/new");
    await moderatorPage.getByLabel("Given name").fill("Findable");
    await moderatorPage.getByLabel("Surname").fill(FIXTURE_SURNAME);
    await moderatorPage.getByRole("button", { name: "Create person" }).click();
    await moderatorPage.waitForURL(/\/person\/[0-9a-f-]{36}\/edit/);
    created.push(idFromEditUrl(moderatorPage.url()));

    await moderatorPage.goto("/people?q=Findable");
    await expect(
      moderatorPage.getByRole("link", { name: `Findable ${FIXTURE_SURNAME}` }),
    ).toBeVisible();
  });

  test("trims whitespace around a name", async ({ moderatorPage }) => {
    await moderatorPage.goto("/person/new");
    await moderatorPage.getByLabel("Given name").fill("   Spacey   ");
    await moderatorPage.getByLabel("Surname").fill(`  ${FIXTURE_SURNAME} `);
    await moderatorPage.getByRole("button", { name: "Create person" }).click();
    await moderatorPage.waitForURL(/\/person\/[0-9a-f-]{36}\/edit/);
    const id = idFromEditUrl(moderatorPage.url());
    created.push(id);

    const { data } = await admin
      .from("person")
      .select("given_name, surname")
      .eq("id", id)
      .single();
    expect(data?.given_name).toBe("Spacey");
    expect(data?.surname).toBe(FIXTURE_SURNAME);
  });

  test("stores a name with an apostrophe unchanged", async ({
    moderatorPage,
  }) => {
    await moderatorPage.goto("/person/new");
    await moderatorPage.getByLabel("Given name").fill("Seán");
    await moderatorPage.getByLabel("Surname").fill(`O'${FIXTURE_SURNAME}`);
    await moderatorPage.getByRole("button", { name: "Create person" }).click();
    await moderatorPage.waitForURL(/\/person\/[0-9a-f-]{36}\/edit/);
    const id = idFromEditUrl(moderatorPage.url());
    created.push(id);

    const { data } = await admin
      .from("person")
      .select("given_name, surname")
      .eq("id", id)
      .single();
    expect(data?.surname).toBe(`O'${FIXTURE_SURNAME}`);
  });

  test("does not render a name as markup", async ({ moderatorPage }) => {
    let dialogFired = false;
    moderatorPage.on("dialog", (dialog) => {
      dialogFired = true;
      void dialog.dismiss();
    });

    await moderatorPage.goto("/person/new");
    await moderatorPage
      .getByLabel("Given name")
      .fill('<img src=x onerror="alert(1)">');
    await moderatorPage.getByLabel("Surname").fill(FIXTURE_SURNAME);
    await moderatorPage.getByRole("button", { name: "Create person" }).click();
    await moderatorPage.waitForURL(/\/person\/[0-9a-f-]{36}\/edit/);
    const id = idFromEditUrl(moderatorPage.url());
    created.push(id);

    // The tree card builds its HTML as a string, so this is the path that
    // would break if escaping regressed.
    await moderatorPage.goto(`/tree/${id}`);
    await expect(
      moderatorPage.locator(`[data-person-id="${id}"]`),
    ).toBeVisible();
    expect(dialogFired).toBe(false);
  });
});
