import type { Locator, Page } from "@playwright/test";

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

  /**
   * Only these three invoke the function; the two above read the rendered
   * panel and run anywhere.
   *
   * Serial, and for a reason: each one writes a real `export_job` row into a
   * queue every other test in the block can see. Run in parallel, one
   * worker's cleanup sweep deletes the row another worker is still asserting
   * on.
   */
  test.describe.serial("running an export", () => {
    test.beforeEach(async () => {
      test.skip(!(await gedcomFunctionsAvailable()), SERVE_HINT);
    });

    /**
     * The just-finished export's own card. Every row in "Recent exports"
     * carries a Download button too, and the whole panel is itself a
     * `<section>`, so the innermost match is the card — `.last()` in
     * document order.
     */
    function readyCard(page: Page): Locator {
      return page
        .locator("section")
        .filter({ has: page.getByRole("heading", { name: "Export ready" }) })
        .last();
    }

    /**
     * Each run of these tests writes a real `export_job` row and a real file
     * in the `exports` bucket. Left behind they pile up in "Recent exports"
     * on every later run — and the suite's contract is that the database
     * comes out as it went in.
     *
     * The sweep is keyed on the id of the job each test started, read back
     * from the finished card. "Everything that appeared since this block
     * began" was the first shape and it was wrong: it also claimed a job a
     * developer kicked off in the browser, or a wipe-tree backup.
     */
    const startedJobs: string[] = [];

    test.afterAll(async () => {
      if (startedJobs.length === 0) {
        return;
      }
      const rows = await admin
        .from("export_job")
        .select("storage_path")
        .in("id", startedJobs);
      if (rows.error !== null) {
        throw new Error(`export_job read failed: ${rows.error.message}`);
      }
      const paths = (rows.data ?? [])
        .map((row) => row.storage_path)
        .filter((path): path is string => path !== null);
      if (paths.length > 0) {
        const removed = await admin.storage.from("exports").remove(paths);
        if (removed.error !== null) {
          throw new Error(
            `export file cleanup failed: ${removed.error.message}`,
          );
        }
      }
      const { error } = await admin
        .from("export_job")
        .delete()
        .in("id", startedJobs);
      if (error !== null) {
        throw new Error(`export_job cleanup failed: ${error.message}`);
      }
      startedJobs.length = 0;
    });

    /**
     * Runs one export and returns the job it created.
     *
     * The id comes from the newest `completed` row rather than from the page
     * — the finished card names the file, not the job — so the three tests
     * are serial (see the describe above) and only one export is in flight
     * at a time.
     */
    async function runExport(page: Page): Promise<string> {
      await page.goto("/import");
      await page.getByRole("button", { name: "Export GEDCOM" }).click();
      await expect(page.getByText("Export ready")).toBeVisible({
        timeout: 90_000,
      });

      const { data, error } = await admin
        .from("export_job")
        .select("id")
        .eq("status", "completed")
        .order("created_at", { ascending: false })
        .limit(1)
        .single();
      if (error !== null) {
        throw new Error(`export_job read failed: ${error.message}`);
      }
      startedJobs.push(data.id);
      return data.id;
    }

    test("runs an export to completion and offers the download", async ({
      moderatorPage,
    }) => {
      await runExport(moderatorPage);
      await expect(alerts(moderatorPage)).toHaveCount(0);

      const card = readyCard(moderatorPage);
      await expect(
        card.getByRole("button", { name: "Download" }),
      ).toBeVisible();
      await expect(
        card.getByRole("button", { name: "Export again" }),
      ).toBeVisible();
    });

    test("the finished job appears in the recent list", async ({
      moderatorPage,
    }) => {
      const jobId = await runExport(moderatorPage);

      // Scoped to the job this test started. "Some row says Completed"
      // passes on a developer's stack that already holds one, even if this
      // export never finished.
      const { data } = await admin
        .from("export_job")
        .select("size_bytes")
        .eq("id", jobId)
        .single();
      expect(data?.size_bytes ?? 0).toBeGreaterThan(0);

      const recent = moderatorPage
        .locator("section")
        .filter({
          has: moderatorPage.getByRole("heading", { name: "Recent exports" }),
        })
        .last();
      await expect(
        recent.getByRole("listitem").filter({ hasText: "Completed" }).first(),
      ).toBeVisible({ timeout: 15_000 });
    });

    test("downloads a real GEDCOM file", async ({ moderatorPage }) => {
      await runExport(moderatorPage);

      const [download] = await Promise.all([
        moderatorPage.waitForEvent("download"),
        readyCard(moderatorPage)
          .getByRole("button", { name: "Download" })
          .click(),
      ]);
      expect(download.suggestedFilename()).toMatch(/\.ged(\.gz)?$/);
    });
  });
});
