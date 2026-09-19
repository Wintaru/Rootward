import {
  gedcomFunctionsAvailable,
  SERVE_HINT,
} from "../support/edge-functions";
import { admin } from "../support/supabase-admin";
import { alerts, expect, test } from "../support/test";

/**
 * `/import` — Import / Export, moderator+ (SPEC §8.1, §7, issues #16, #54,
 * #60).
 *
 * The import half is blocked whenever the tree already has people
 * (decision 33: only the first import is a plain load), which is the state a
 * developer box is normally in — so the *blocked* path is what is checked
 * here. The unblocked path needs an empty tree and lives in
 * `tests/destructive/`.
 *
 * Export is safe to run any time: it writes a job row and a file in the
 * separate `exports` bucket, and touches no genealogy data.
 */

test.describe("the import panel", () => {
  test("blocks a second import on a non-empty tree", async ({
    moderatorPage,
  }) => {
    await moderatorPage.goto("/import");
    await expect(
      moderatorPage.getByText("This tree already has data"),
    ).toBeVisible();
    await expect(
      moderatorPage.getByText(/already has [\d,]+ (person|people)/),
    ).toBeVisible();
  });

  test("tells a moderator to ask an admin", async ({ moderatorPage }) => {
    await moderatorPage.goto("/import");
    await expect(
      moderatorPage.getByText(/Ask an admin to wipe the tree first/),
    ).toBeVisible();
    await expect(
      moderatorPage.getByRole("link", { name: /Go to Settings/ }),
    ).toHaveCount(0);
  });

  test("offers an admin the route to wipe the tree", async ({ adminPage }) => {
    await adminPage.goto("/import");
    await expect(adminPage.getByText(/Wipe the tree first/)).toBeVisible();
    await adminPage.getByRole("link", { name: /Go to Settings/ }).click();
    await expect(adminPage).toHaveURL(/\/settings$/);
  });

  test("offers no file picker while the tree is blocked", async ({
    adminPage,
  }) => {
    await adminPage.goto("/import");
    await expect(adminPage.locator('input[type="file"]')).toHaveCount(0);
  });
});

test.describe("the export panel", () => {
  test("describes what the export contains", async ({ moderatorPage }) => {
    await moderatorPage.goto("/import");
    await expect(
      moderatorPage.getByRole("heading", { name: "Export", exact: true }),
    ).toBeVisible();
    await expect(
      moderatorPage.getByRole("button", { name: "Export GEDCOM" }),
    ).toBeVisible();
  });

  test("lists past export jobs", async ({ moderatorPage }) => {
    await moderatorPage.goto("/import");
    await expect(
      moderatorPage.getByRole("heading", { name: "Recent exports" }),
    ).toBeVisible();
  });

  // Only these three invoke the function; the two above read the rendered
  // panel and run anywhere.
  test.describe("running an export", () => {
    test.beforeEach(async () => {
      test.skip(!(await gedcomFunctionsAvailable()), SERVE_HINT);
    });

    test("runs an export to completion and offers the download", async ({
      moderatorPage,
    }) => {
      await moderatorPage.goto("/import");
      await moderatorPage
        .getByRole("button", { name: "Export GEDCOM" })
        .click();

      await expect(moderatorPage.getByText("Export ready")).toBeVisible({
        timeout: 90_000,
      });
      await expect(alerts(moderatorPage)).toHaveCount(0);

      const download = moderatorPage.getByRole("button", { name: /Download/ });
      await expect(download).toBeVisible();
      await expect(
        moderatorPage.getByRole("button", { name: "Export again" }),
      ).toBeVisible();
    });

    test("the finished job appears in the recent list", async ({
      moderatorPage,
    }) => {
      await moderatorPage.goto("/import");
      await moderatorPage
        .getByRole("button", { name: "Export GEDCOM" })
        .click();
      await expect(moderatorPage.getByText("Export ready")).toBeVisible({
        timeout: 90_000,
      });

      // The job row is what the list reads; confirm one really completed.
      const { data } = await admin
        .from("export_job")
        .select("id, status")
        .eq("status", "completed")
        .order("created_at", { ascending: false })
        .limit(1);
      expect(data?.length).toBe(1);
    });

    test("downloads a real GEDCOM file", async ({ moderatorPage }) => {
      await moderatorPage.goto("/import");
      await moderatorPage
        .getByRole("button", { name: "Export GEDCOM" })
        .click();
      await expect(moderatorPage.getByText("Export ready")).toBeVisible({
        timeout: 90_000,
      });

      const [download] = await Promise.all([
        moderatorPage.waitForEvent("download"),
        moderatorPage.getByRole("button", { name: /Download/ }).click(),
      ]);
      expect(download.suggestedFilename()).toMatch(/\.ged(\.gz)?$/);
    });
  });
});
