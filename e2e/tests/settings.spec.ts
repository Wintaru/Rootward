import { alerts, expect, test } from "../support/test";
import { fixtureNames } from "../support/fixture-data";
import {
  deleteTestUser,
  ensureTestUser,
  readTreeSettings,
  restoreTreeSettings,
} from "../support/supabase-admin";

/**
 * `/settings` (SPEC §8.1, §9.4, §10 item 37). Since #80 the route is tabbed
 * — Appearance (every approved member) | Tree | Roles — and the admin gate
 * applies per tab. The two admin surfaces here: the singleton
 * `tree_settings` row (`?tab=tree`) and the account roster (`?tab=roles`).
 *
 * Settings are global, so these run serially and put every value back. The
 * destructive third surface, Wipe tree, lives in `tests/destructive/`.
 */
test.describe.configure({ mode: "serial" });

test.describe("tree settings", () => {
  // `tree_settings` is a singleton every visitor reads, so a test that fails
  // between a change and its inline restore would leave the tree renamed or
  // self-signup flipped for everything after it. Snapshot once and put the
  // whole row back after each test, whatever happened.
  let snapshot: Awaited<ReturnType<typeof readTreeSettings>> | null = null;

  test.beforeAll(async () => {
    snapshot = await readTreeSettings();
  });

  test.afterEach(async () => {
    if (snapshot !== null) {
      await restoreTreeSettings(snapshot);
    }
  });

  test("shows the current values", async ({ adminPage }) => {
    await adminPage.goto("/settings?tab=tree");
    await expect(
      adminPage.getByRole("heading", { name: "Tree settings" }),
    ).toBeVisible();
    await expect(adminPage.getByLabel("Tree name")).toBeVisible();
    await expect(
      adminPage.getByLabel("Living-person threshold (years)"),
    ).toBeVisible();
    await expect(adminPage.getByLabel("Default generations up")).toBeVisible();
    await expect(
      adminPage.getByLabel("Maximum upload size (bytes)"),
    ).toBeVisible();
  });

  test("converts the upload limit to MB as a hint", async ({ adminPage }) => {
    await adminPage.goto("/settings?tab=tree");
    await adminPage.getByLabel("Maximum upload size (bytes)").fill("5242880");
    await expect(adminPage.getByText("≈ 5.0 MB")).toBeVisible();
  });

  test("hides the MB hint for a value that is not a size", async ({
    adminPage,
  }) => {
    await adminPage.goto("/settings?tab=tree");
    await adminPage.getByLabel("Maximum upload size (bytes)").fill("abc");
    await expect(adminPage.getByText(/≈ .* MB/)).toHaveCount(0);
  });

  test("saves a changed tree name and puts it back", async ({ adminPage }) => {
    await adminPage.goto("/settings?tab=tree");
    const field = adminPage.getByLabel("Tree name");
    const original = (await field.inputValue()) || "The Ashby Family (demo)";

    await field.fill("E2E Renamed Tree");
    await adminPage.getByRole("button", { name: "Save settings" }).click();
    await expect(adminPage.getByText("Saved.")).toBeVisible();

    await adminPage.reload();
    await expect(adminPage.getByLabel("Tree name")).toHaveValue(
      "E2E Renamed Tree",
    );

    await adminPage.getByLabel("Tree name").fill(original);
    await adminPage.getByRole("button", { name: "Save settings" }).click();
    await expect(adminPage.getByText("Saved.")).toBeVisible();
  });

  test("refuses a non-numeric generation depth", async ({ adminPage }) => {
    await adminPage.goto("/settings?tab=tree");
    await adminPage.getByLabel("Default generations up").fill("not-a-number");
    await adminPage.getByRole("button", { name: "Save settings" }).click();
    await expect(alerts(adminPage).first()).toBeVisible();
    await expect(adminPage.getByText("Saved.")).toHaveCount(0);
  });

  test("refuses a negative living threshold", async ({ adminPage }) => {
    await adminPage.goto("/settings?tab=tree");
    await adminPage.getByLabel("Living-person threshold (years)").fill("-10");
    await adminPage.getByRole("button", { name: "Save settings" }).click();
    await expect(alerts(adminPage).first()).toBeVisible();
  });

  test("picks a default root person by name (#53)", async ({ adminPage }) => {
    await adminPage.goto("/settings?tab=tree");
    // The picker is a labelled search input; its matches are buttons. It
    // returns 8 rows sorted by surname, so searching the shared surname
    // leaves which 8 arbitrary — the given name is the stable handle.
    await adminPage.getByLabel(/Choose a (different )?person/).fill("Gideon");
    await expect(
      adminPage.getByRole("button", { name: fixtureNames.grandfather }),
    ).toBeVisible();
  });

  test("saves the tree description and reads it back", async ({
    adminPage,
  }) => {
    await adminPage.goto("/settings?tab=tree");
    const field = adminPage.getByLabel("Tree description");
    await field.fill("A description typed by the end-to-end suite.");
    await adminPage.getByRole("button", { name: "Save settings" }).click();
    await expect(adminPage.getByText("Saved.")).toBeVisible();

    await adminPage.reload();
    await expect(adminPage.getByLabel("Tree description")).toHaveValue(
      "A description typed by the end-to-end suite.",
    );
  });

  test("saves the allowed media types list", async ({ adminPage }) => {
    await adminPage.goto("/settings?tab=tree");
    await adminPage
      .getByLabel(/Allowed media types/)
      .fill("image/png\nimage/jpeg");
    await adminPage.getByRole("button", { name: "Save settings" }).click();
    await expect(adminPage.getByText("Saved.")).toBeVisible();

    await adminPage.reload();
    await expect(adminPage.getByLabel(/Allowed media types/)).toHaveValue(
      /image\/png/,
    );
  });

  test("saves both generation depths", async ({ adminPage }) => {
    await adminPage.goto("/settings?tab=tree");
    await adminPage.getByLabel("Default generations up").fill("5");
    await adminPage.getByLabel("Default generations down").fill("4");
    await adminPage.getByRole("button", { name: "Save settings" }).click();
    await expect(adminPage.getByText("Saved.")).toBeVisible();

    await adminPage.reload();
    await expect(adminPage.getByLabel("Default generations up")).toHaveValue(
      "5",
    );
    await expect(adminPage.getByLabel("Default generations down")).toHaveValue(
      "4",
    );
  });

  test("toggles the EXIF GPS stripping box and reads it back", async ({
    adminPage,
  }) => {
    await adminPage.goto("/settings?tab=tree");
    const box = adminPage.getByLabel(/Strip GPS location/);
    const before = await box.isChecked();

    await box.setChecked(!before);
    await adminPage.getByRole("button", { name: "Save settings" }).click();
    await expect(adminPage.getByText("Saved.")).toBeVisible();

    await adminPage.reload();
    await expect(adminPage.getByLabel(/Strip GPS location/)).toBeChecked({
      checked: !before,
    });
  });

  test("sets a default root person and clears it again", async ({
    adminPage,
  }) => {
    await adminPage.goto("/settings?tab=tree");
    // The given name, for the reason given on the picker test above.
    await adminPage.getByLabel(/Choose a (different )?person/).fill("Gideon");
    await adminPage
      .getByRole("button", { name: fixtureNames.grandfather })
      .click();
    // The chosen name and the Clear button share one paragraph, so the
    // name is matched inside it rather than as the whole text node.
    const chosen = adminPage
      .locator("p")
      .filter({ has: adminPage.getByRole("button", { name: "Clear" }) });
    await expect(chosen).toContainText(fixtureNames.grandfather);
    await expect(
      adminPage.getByText("Not set — the tree opens on the earliest person"),
    ).toHaveCount(0);

    await adminPage.getByRole("button", { name: "Clear" }).click();
    await expect(
      adminPage.getByText("Not set — the tree opens on the earliest person"),
    ).toBeVisible();
  });

  test("toggles self-signup and puts it back", async ({ adminPage }) => {
    await adminPage.goto("/settings?tab=tree");
    const box = adminPage.getByLabel(/Allow self-signup/);
    const before = await box.isChecked();

    await box.setChecked(!before);
    await adminPage.getByRole("button", { name: "Save settings" }).click();
    await expect(adminPage.getByText("Saved.")).toBeVisible();

    await adminPage.reload();
    await expect(adminPage.getByLabel(/Allow self-signup/)).toBeChecked({
      checked: !before,
    });

    await adminPage.getByLabel(/Allow self-signup/).setChecked(before);
    await adminPage.getByRole("button", { name: "Save settings" }).click();
    await expect(adminPage.getByText("Saved.")).toBeVisible();
  });
});

/**
 * The typed-phrase gate in front of "Wipe tree" (decision 33, issue #60).
 *
 * Nothing here clicks the button — the wipe itself belongs to the
 * `destructive` project, which only runs behind `E2E_DESTRUCTIVE=1`. These
 * assert the gate that stands between a misclick and every person in the
 * tree, and the confirmation field is cleared again before the test ends.
 */
test.describe("the wipe-tree gate", () => {
  test("keeps the button dead until the phrase is exact", async ({
    adminPage,
  }) => {
    await adminPage.goto("/settings?tab=tree");
    const wipe = adminPage.getByRole("button", { name: "Wipe tree" });
    const confirm = adminPage.getByLabel('Type "WIPE" to confirm');
    await expect(wipe).toBeDisabled();

    for (const wrong of ["wipe", "WIP", "WIPE ", "DELETE"]) {
      await confirm.fill(wrong);
      await expect(wipe).toBeDisabled();
    }

    await confirm.fill("WIPE");
    await expect(wipe).toBeEnabled();

    // Left armed, a stray click would empty the tree for every other spec.
    await confirm.fill("");
    await expect(wipe).toBeDisabled();
  });

  test("offers to skip the automatic backup, and says what that means", async ({
    adminPage,
  }) => {
    await adminPage.goto("/settings?tab=tree");
    const skip = adminPage.getByLabel(/Skip the automatic backup/);
    await expect(skip).not.toBeChecked();
    await expect(
      adminPage.getByText(/A backup GEDCOM \+ media export runs first/),
    ).toBeVisible();

    await skip.check();
    await expect(
      adminPage.getByText("No backup will be made — the tree wipes"),
    ).toBeVisible();

    await skip.uncheck();
    await expect(
      adminPage.getByText(/A backup GEDCOM \+ media export runs first/),
    ).toBeVisible();
  });

  test("is not offered to a moderator at all", async ({ moderatorPage }) => {
    await moderatorPage.goto("/settings?tab=tree");
    // Anchored on the refusal the page actually renders: an expired session
    // redirects to /login, where "no Wipe tree button" is true but tells us
    // nothing.
    await expect(moderatorPage).toHaveURL(/\/settings\?tab=tree$/);
    await expect(
      moderatorPage.getByText(/needs? administrator access/i),
    ).toBeVisible();
    await expect(
      moderatorPage.getByRole("button", { name: "Wipe tree" }),
    ).toHaveCount(0);
  });
});

test.describe("role management", () => {
  test("lists every account", async ({ adminPage }) => {
    await adminPage.goto("/settings?tab=roles");
    await expect(
      adminPage.getByRole("heading", { name: "Accounts" }),
    ).toBeVisible();
    await expect(adminPage.getByText("E2E Viewer")).toBeVisible();
    await expect(adminPage.getByText("E2E Moderator")).toBeVisible();
  });

  test("marks the signed-in admin's own row and locks it", async ({
    adminPage,
  }) => {
    await adminPage.goto("/settings?tab=roles");
    const ownRow = adminPage.locator("li").filter({ hasText: "(you)" });
    await expect(ownRow).toHaveCount(1);
    await expect(ownRow.getByRole("combobox")).toBeDisabled();
    await expect(
      ownRow.getByRole("button", { name: /Suspend/ }),
    ).toBeDisabled();
  });

  test("shows the person a claimed account is linked to", async ({
    adminPage,
  }) => {
    await adminPage.goto("/settings?tab=roles");
    const row = adminPage.locator("li").filter({ hasText: "E2E Viewer" });
    await expect(row).toContainText("linked to");
    await expect(
      row.getByRole("link", { name: fixtureNames.viewerPerson }),
    ).toBeVisible();
  });

  /**
   * These two mutate an account's role and status, which every request reads
   * fresh from the database — so acting on one of the five shared role
   * accounts would elevate or suspend it for the `access-control` and
   * `rls-visibility` specs running on the other workers, and make the suite's
   * own security checks report a leak it caused itself. Each test gets a
   * throwaway account instead.
   */
  const ROLE_TARGET = "e2e-rolechange@rootward.test";
  const STATUS_TARGET = "e2e-statuschange@rootward.test";

  test.afterAll(async () => {
    await deleteTestUser(ROLE_TARGET);
    await deleteTestUser(STATUS_TARGET);
  });

  test("changes a role and reads it back", async ({ adminPage }) => {
    await ensureTestUser({
      email: ROLE_TARGET,
      role: "viewer",
      status: "active",
      displayName: "E2E Role Target",
    });

    await adminPage.goto("/settings?tab=roles");
    const row = adminPage.locator("li").filter({ hasText: "E2E Role Target" });
    await expect(row.getByRole("combobox")).toHaveValue("viewer");

    await row.getByRole("combobox").selectOption("moderator");
    await expect(row.locator('[role="alert"]')).toHaveCount(0);

    await adminPage.reload();
    await expect(
      adminPage
        .locator("li")
        .filter({ hasText: "E2E Role Target" })
        .getByRole("combobox"),
    ).toHaveValue("moderator");
  });

  test("suspends an account and reactivates it", async ({ adminPage }) => {
    await ensureTestUser({
      email: STATUS_TARGET,
      role: "viewer",
      status: "active",
      displayName: "E2E Status Target",
    });

    await adminPage.goto("/settings?tab=roles");
    const row = adminPage
      .locator("li")
      .filter({ hasText: "E2E Status Target" });

    await row.getByRole("button", { name: "Suspend" }).click();
    await expect(row.getByRole("button", { name: "Reactivate" })).toBeVisible();

    await row.getByRole("button", { name: "Reactivate" }).click();
    await expect(row.getByRole("button", { name: "Suspend" })).toBeVisible();
  });
});
