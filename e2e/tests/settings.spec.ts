import { alerts, expect, test } from "../support/test";
import { fixtureNames, FIXTURE_SURNAME } from "../support/fixture-data";
import {
  deleteTestUser,
  ensureTestUser,
  readTreeSettings,
  restoreTreeSettings,
} from "../support/supabase-admin";

/**
 * `/settings` — admin only (SPEC §8.1, §9.4, §10 item 37). Two surfaces: the
 * singleton `tree_settings` row and the account roster.
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
    await adminPage.goto("/settings");
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
    await adminPage.goto("/settings");
    await adminPage.getByLabel("Maximum upload size (bytes)").fill("5242880");
    await expect(adminPage.getByText("≈ 5.0 MB")).toBeVisible();
  });

  test("hides the MB hint for a value that is not a size", async ({
    adminPage,
  }) => {
    await adminPage.goto("/settings");
    await adminPage.getByLabel("Maximum upload size (bytes)").fill("abc");
    await expect(adminPage.getByText(/≈ .* MB/)).toHaveCount(0);
  });

  test("saves a changed tree name and puts it back", async ({ adminPage }) => {
    await adminPage.goto("/settings");
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
    await adminPage.goto("/settings");
    await adminPage.getByLabel("Default generations up").fill("not-a-number");
    await adminPage.getByRole("button", { name: "Save settings" }).click();
    await expect(alerts(adminPage).first()).toBeVisible();
    await expect(adminPage.getByText("Saved.")).toHaveCount(0);
  });

  test("refuses a negative living threshold", async ({ adminPage }) => {
    await adminPage.goto("/settings");
    await adminPage.getByLabel("Living-person threshold (years)").fill("-10");
    await adminPage.getByRole("button", { name: "Save settings" }).click();
    await expect(alerts(adminPage).first()).toBeVisible();
  });

  test("picks a default root person by name (#53)", async ({ adminPage }) => {
    await adminPage.goto("/settings");
    // The picker is a labelled search input; its matches are buttons.
    await adminPage
      .getByLabel(/Choose a (different )?person/)
      .fill(FIXTURE_SURNAME);
    await expect(
      adminPage.getByRole("button", { name: fixtureNames.grandfather }),
    ).toBeVisible();
  });

  test("toggles self-signup and puts it back", async ({ adminPage }) => {
    await adminPage.goto("/settings");
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

test.describe("role management", () => {
  test("lists every account", async ({ adminPage }) => {
    await adminPage.goto("/settings");
    await expect(
      adminPage.getByRole("heading", { name: "Accounts" }),
    ).toBeVisible();
    await expect(adminPage.getByText("E2E Viewer")).toBeVisible();
    await expect(adminPage.getByText("E2E Moderator")).toBeVisible();
  });

  test("marks the signed-in admin's own row and locks it", async ({
    adminPage,
  }) => {
    await adminPage.goto("/settings");
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
    await adminPage.goto("/settings");
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

  test("changes a role and puts it back", async ({ adminPage }) => {
    await ensureTestUser({
      email: ROLE_TARGET,
      role: "viewer",
      status: "active",
      displayName: "E2E Role Target",
    });

    await adminPage.goto("/settings");
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

    await adminPage.goto("/settings");
    const row = adminPage
      .locator("li")
      .filter({ hasText: "E2E Status Target" });

    await row.getByRole("button", { name: "Suspend" }).click();
    await expect(row.getByRole("button", { name: "Reactivate" })).toBeVisible();

    await row.getByRole("button", { name: "Reactivate" }).click();
    await expect(row.getByRole("button", { name: "Suspend" })).toBeVisible();
  });
});
