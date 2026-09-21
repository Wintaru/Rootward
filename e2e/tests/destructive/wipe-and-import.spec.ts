import {
  gedcomFunctionsAvailable,
  SERVE_HINT,
} from "../../support/edge-functions";
import { resolveGedcomPath, summarizeGedcom } from "../../support/gedcom-file";
import {
  fixtureIds,
  removeFixtureFamily,
  seedFixtureFamily,
  seedFixtureMedia,
} from "../../support/fixture-data";
import { admin, setAccountState } from "../../support/supabase-admin";
import { accounts, alerts, expect, test } from "../../support/test";

/**
 * Wipe tree, then import a GEDCOM into the empty tree it leaves behind
 * (SPEC §7, §8.1, decisions 18 and 33, issues #16 and #60).
 *
 * **This file empties the database.** It runs only when `E2E_DESTRUCTIVE=1`
 * is set — `playwright.config.ts` leaves the `destructive` project out of
 * the list entirely without it, and the guard below repeats the check so a
 * stale config cannot re-open the hole:
 *
 *     E2E_DESTRUCTIVE=1 pnpm test:e2e --project=destructive
 *
 * The tests are one story in order — wipe, then import — so the file is
 * serial and the project runs on a single worker.
 */
test.describe.configure({ mode: "serial" });

test.beforeAll(() => {
  test.skip(
    process.env.E2E_DESTRUCTIVE !== "1",
    "Set E2E_DESTRUCTIVE=1 to allow the suite to wipe this database.",
  );
});

const gedcom = resolveGedcomPath();
const summary = summarizeGedcom(gedcom.path);

test.beforeAll(async () => {
  test.skip(!(await gedcomFunctionsAvailable()), SERVE_HINT);
});

test("an admin wipes the tree, after a backup export", async ({
  adminPage,
}) => {
  await adminPage.goto("/settings?tab=tree");
  const section = adminPage.locator("section").filter({ hasText: "Wipe tree" });
  await expect(section).toBeVisible();

  // The button stays disabled until the phrase is typed exactly.
  const wipe = section.getByRole("button", { name: "Wipe tree" });
  await expect(wipe).toBeDisabled();
  await section.getByLabel('Type "WIPE" to confirm').fill("wipe");
  await expect(wipe).toBeDisabled();
  await section.getByLabel('Type "WIPE" to confirm').fill("WIPE");
  await expect(wipe).toBeEnabled();

  // Decision 33: a non-empty tree is exported first, and the wipe only
  // proceeds once that backup completes.
  await wipe.click();
  await expect(adminPage.getByText("The tree is wiped.")).toBeVisible({
    timeout: 180_000,
  });
  await expect(adminPage.getByText(/A backup was made first/)).toBeVisible();

  const { count } = await admin
    .from("person")
    .select("id", { count: "exact", head: true });
  expect(count).toBe(0);
});

test("the empty tree offers to import or add the first person", async ({
  adminPage,
}) => {
  await adminPage.goto("/tree");
  await expect(
    adminPage.getByRole("link", { name: "Import a GEDCOM" }),
  ).toBeVisible();
  await expect(
    adminPage.getByRole("link", { name: "Add the first person" }),
  ).toBeVisible();
});

test(`an admin imports ${gedcom.label}`, async ({ adminPage }) => {
  await adminPage.goto("/import");

  // With the tree empty, the blocking notice is gone and the picker is back.
  await expect(adminPage.getByText("This tree already has data")).toHaveCount(
    0,
  );

  const picker = adminPage.locator('input[type="file"]');
  await expect(picker).toBeAttached();
  await picker.setInputFiles(gedcom.path);
  await adminPage.getByRole("button", { name: "Start import" }).click();

  // A GedZip is unpacked and every photo processed in the browser before
  // the job even starts (issue #104), then the engine runs in batches: the
  // demo archive's ~870 files take a few minutes end to end.
  await expect(
    adminPage.getByRole("heading", { name: "Import complete" }),
  ).toBeVisible({ timeout: 900_000 });
  await expect(alerts(adminPage)).toHaveCount(0);

  const { count } = await admin
    .from("person")
    .select("id", { count: "exact", head: true });
  expect(count ?? 0).toBeGreaterThan(0);
});

test("every record in the file landed, photos included", async () => {
  // Counted off the file itself, so this holds for whichever GEDCOM
  // `resolveGedcomPath` picked, as long as its media are level-0 OBJE
  // records (an inline OBJE under a person also makes a media row, which
  // this count does not see). For an archive every media row must also
  // have its bytes in storage (`storage_path_original`), which is what
  // "the photos came through" means on the import side.
  const countRows = async (table: "person" | "family" | "media") => {
    const { count, error } = await admin
      .from(table)
      .select("id", { count: "exact", head: true });
    expect(error).toBeNull();
    return count ?? 0;
  };

  expect(await countRows("person")).toBe(summary.individuals);
  expect(await countRows("family")).toBe(summary.families);
  expect(await countRows("media")).toBe(summary.mediaRecords);

  if (summary.isArchive) {
    const stored = await admin
      .from("media")
      .select("id", { count: "exact", head: true })
      .not("storage_path_original", "is", null);
    expect(stored.error).toBeNull();
    expect(stored.count ?? 0).toBe(summary.mediaRecords);
  }
});

test("the imported people are browsable", async ({ adminPage }) => {
  await adminPage.goto("/people");
  await expect(adminPage.getByText(/^\d+ (person|people)$/)).toBeVisible();
  const rows = adminPage.getByRole("listitem");
  expect(await rows.count()).toBeGreaterThan(0);
});

test("the import set a root and the tree opens on it", async ({
  adminPage,
}) => {
  await adminPage.goto("/tree");
  await expect(adminPage).toHaveURL(/\/tree\/[0-9a-f-]{36}/);
  await expect(adminPage.locator("[data-person-id]").first()).toBeVisible();
});

test.afterAll(async () => {
  // The wipe took the fixture family with it; put it back so the `app`
  // project can run again in the same invocation.
  await removeFixtureFamily();
  await seedFixtureFamily();
  await seedFixtureMedia();

  // `account.person_id` is `on delete set null`, so the wipe also unlinked
  // the viewer from their record. Re-seeding the person does not restore
  // that link, and the specs that assert on a claimed account would fail.
  await setAccountState(accounts().viewer.userId, {
    person_id: fixtureIds.viewerPerson,
  });
});

/**
 * A readability check, so a missing or truncated file fails with "this is
 * not a GEDCOM" rather than as a mysterious import error twenty minutes in.
 */
test("the GEDCOM under test is readable", () => {
  expect(summary.gedcomText.startsWith("0 HEAD")).toBe(true);
  expect(summary.individuals).toBeGreaterThan(0);
});
