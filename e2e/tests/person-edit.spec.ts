import {
  FIXTURE_SURNAME,
  fixtureIds,
  fixtureNames,
} from "../support/fixture-data";
import { admin } from "../support/supabase-admin";
import { alerts, expect, test } from "../support/test";

/**
 * `/person/[personId]/edit` — the full-screen edit shell and its nine
 * sections (SPEC §8.3, §10 item 26, issues #27–#34).
 *
 * The URL is the state (`?section=`), so section switching is a plain link.
 * Saves are per-section with an `updated_at` concurrency token (decision 26),
 * so a stale save must be refused rather than silently overwrite.
 */

const EDIT_SECTIONS = [
  "Name & Gender",
  "Additional Names",
  "Relationships",
  "Events",
  "Facts",
  "Media",
  "Sources",
  "Notes",
  "Reference Numbers",
];

test.describe("the edit shell", () => {
  test("shows the person and every section in the rail", async ({
    moderatorPage,
  }) => {
    await moderatorPage.goto(`/person/${fixtureIds.grandfather}/edit`);
    await expect(
      moderatorPage.getByRole("heading", {
        level: 1,
        name: fixtureNames.grandfather,
      }),
    ).toBeVisible();

    const rail = moderatorPage.getByRole("navigation", {
      name: "Edit sections",
    });
    for (const label of EDIT_SECTIONS) {
      await expect(rail.getByRole("link", { name: label })).toBeVisible();
    }
  });

  test("opens Name & Gender by default", async ({ moderatorPage }) => {
    await moderatorPage.goto(`/person/${fixtureIds.grandfather}/edit`);
    await expect(
      moderatorPage.getByRole("heading", { level: 2, name: "Name & Gender" }),
    ).toBeVisible();
  });

  for (const label of EDIT_SECTIONS) {
    test(`opens the ${label} section`, async ({ moderatorPage }) => {
      await moderatorPage.goto(`/person/${fixtureIds.grandfather}/edit`);
      await moderatorPage
        .getByRole("navigation", { name: "Edit sections" })
        .getByRole("link", { name: label })
        .click();
      await expect(
        moderatorPage.getByRole("heading", { level: 2, name: label }),
      ).toBeVisible();
      await expect(
        moderatorPage.getByText("This section is not built yet."),
      ).toHaveCount(0);
    });
  }

  test("falls back to the first section for an unknown ?section", async ({
    moderatorPage,
  }) => {
    await moderatorPage.goto(
      `/person/${fixtureIds.grandfather}/edit?section=no-such-section`,
    );
    await expect(
      moderatorPage.getByRole("heading", { level: 2, name: "Name & Gender" }),
    ).toBeVisible();
  });

  test("shows parents above and partners below", async ({ moderatorPage }) => {
    await moderatorPage.goto(`/person/${fixtureIds.viewerPerson}/edit`);
    await expect(moderatorPage.getByText("Parents")).toBeVisible();
    await expect(moderatorPage.getByText("Partners & children")).toBeVisible();
    await expect(
      moderatorPage.getByRole("link", { name: fixtureNames.grandfather }),
    ).toBeVisible();
  });

  test("Done returns to the profile", async ({ moderatorPage }) => {
    await moderatorPage.goto(`/person/${fixtureIds.grandfather}/edit`);
    await moderatorPage.getByRole("link", { name: "Done" }).click();
    await expect(moderatorPage).toHaveURL(
      new RegExp(`/person/${fixtureIds.grandfather}$`),
    );
  });

  test("404s for a person that does not exist", async ({ moderatorPage }) => {
    const response = await moderatorPage.goto(
      "/person/00000000-0000-4000-8000-00000000dead/edit",
    );
    expect(response?.status()).toBe(404);
  });
});

test.describe("the Name & Gender section", () => {
  /**
   * The two saving tests below each get their own person. Sharing one
   * fixture row let them overwrite each other mid-assertion — and a stale
   * `name_prefix` left by one changes the rendered full name the delete
   * confirmation in this file and in `access-control.spec.ts` match on.
   */
  async function makeScratchPerson(slug: string): Promise<string> {
    const id = crypto.randomUUID();
    const { error } = await admin.from("person").insert({
      id,
      given_name: slug,
      surname: FIXTURE_SURNAME,
      sex: "unknown",
      visibility: "everyone_approved",
    });
    if (error !== null) {
      throw new Error(`scratch person insert failed: ${error.message}`);
    }
    scratch.push(id);
    return id;
  }

  const scratch: string[] = [];

  test.afterAll(async () => {
    if (scratch.length > 0) {
      await admin.from("person").delete().in("id", scratch);
    }
  });

  test("keeps Save disabled until something changes", async ({
    moderatorPage,
  }) => {
    await moderatorPage.goto(`/person/${fixtureIds.grandfather}/edit`);
    await expect(
      moderatorPage.getByRole("button", { name: "Save" }),
    ).toBeDisabled();
  });

  test("enables Save once a field is edited", async ({ moderatorPage }) => {
    await moderatorPage.goto(`/person/${fixtureIds.grandfather}/edit`);
    await moderatorPage.getByLabel("Nickname").fill("Gid");
    await expect(
      moderatorPage.getByRole("button", { name: "Save" }),
    ).toBeEnabled();
  });

  test("saves a nickname and reads it back", async ({ moderatorPage }) => {
    const id = await makeScratchPerson("Nicknamed");
    await moderatorPage.goto(`/person/${id}/edit`);
    await moderatorPage.getByLabel("Nickname").fill("E2E Nickname");
    await moderatorPage.getByRole("button", { name: "Save" }).click();
    await expect(moderatorPage.getByText("Saved.")).toBeVisible();

    await moderatorPage.reload();
    await expect(moderatorPage.getByLabel("Nickname")).toHaveValue(
      "E2E Nickname",
    );
  });

  test("offers the visibility ladder", async ({ moderatorPage }) => {
    await moderatorPage.goto(`/person/${fixtureIds.grandfather}/edit`);
    const visibility = moderatorPage.getByLabel("Visibility");
    await expect(visibility).toBeEnabled();
    await expect(visibility.getByRole("option")).toContainText([
      "Everyone approved",
    ]);
  });

  test("locks the visibility control for a close_family person", async ({
    moderatorPage,
  }) => {
    // `close_family` is post-MVP (#43) and has no option in this control, so
    // it is disabled rather than silently downgrading the stored value.
    await moderatorPage.goto(`/person/${fixtureIds.closeFamily}/edit`);
    await expect(moderatorPage.getByLabel("Visibility")).toBeDisabled();
  });

  test("offers computed, living, and deceased", async ({ moderatorPage }) => {
    await moderatorPage.goto(`/person/${fixtureIds.grandfather}/edit`);
    const living = moderatorPage.getByLabel("Living");
    await expect(living.getByRole("option")).toHaveCount(3);
    await expect(living.getByRole("option").first()).toContainText("Computed");
  });

  test("refuses a stale save (decision 26)", async ({ moderatorPage }) => {
    const id = await makeScratchPerson("Stale");
    await moderatorPage.goto(`/person/${id}/edit`);
    await moderatorPage.getByLabel("Nickname").fill("First edit");

    // Another moderator saves while this page is open: the row's `updated_at`
    // moves on, so the open page is now holding a stale token.
    const { error } = await admin
      .from("person")
      .update({ name_prefix: `e2e-${Date.now()}` })
      .eq("id", id);
    expect(error).toBeNull();

    await moderatorPage.getByRole("button", { name: "Save" }).click();
    await expect(alerts(moderatorPage).first()).toContainText(
      /changed while you had it open/i,
    );
  });
});

test.describe("the danger zone", () => {
  test("keeps Delete disabled until the name is typed exactly", async ({
    adminPage,
  }) => {
    await adminPage.goto(`/person/${fixtureIds.loner}/edit`);
    const deleteButton = adminPage.getByRole("button", {
      name: `Delete ${fixtureNames.loner}`,
    });
    await expect(deleteButton).toBeDisabled();

    await adminPage
      .getByLabel(`Type "${fixtureNames.loner}" to confirm`)
      .fill("wrong");
    await expect(deleteButton).toBeDisabled();

    await adminPage
      .getByLabel(`Type "${fixtureNames.loner}" to confirm`)
      .fill(fixtureNames.loner);
    await expect(deleteButton).toBeEnabled();
  });

  test("deletes a person and leaves the tree consistent", async ({
    adminPage,
  }) => {
    const id = crypto.randomUUID();
    const name = `Doomed ${FIXTURE_SURNAME}`;
    const { error } = await admin.from("person").insert({
      id,
      given_name: "Doomed",
      surname: FIXTURE_SURNAME,
      sex: "unknown",
      visibility: "everyone_approved",
    });
    expect(error).toBeNull();

    await adminPage.goto(`/person/${id}/edit`);
    await adminPage.getByLabel(`Type "${name}" to confirm`).fill(name);
    await adminPage.getByRole("button", { name: `Delete ${name}` }).click();

    await adminPage.waitForURL((url) => !url.pathname.includes(id), {
      timeout: 20_000,
    });
    const gone = await adminPage.goto(`/person/${id}`);
    expect(gone?.status()).toBe(404);
    // Deleted by the test itself; the surname sweep in `removeFixtureFamily`
    // catches it if the delete never happened.
  });
});
