import type { Locator, Page } from "@playwright/test";

import { mediaProcessAvailable, SERVE_HINT } from "../support/edge-functions";
import { ONE_PIXEL_PNG } from "../support/png";
import { scratchMedia, scratchPersons } from "../support/scratch";
import { admin } from "../support/supabase-admin";
import { expect, test } from "../support/test";

/**
 * `?section=media` — upload, caption, reorder, primary, delete (SPEC §8.3,
 * §4.4, issue #34).
 *
 * Two of those write immediately (upload and "set as primary") while the
 * rest batch behind one Save, so each group is asserted the way it actually
 * behaves rather than assuming the section-wide Save covers everything.
 */

const scratch = scratchPersons();
const media = scratchMedia();

test.afterAll(async () => {
  await media.remove();
  await scratch.remove();
});

/** A 1×1 PNG handed straight to the file input — no fixture file on disk. */
const UPLOAD_PNG = {
  name: "e2e-upload.png",
  mimeType: "image/png",
  buffer: ONE_PIXEL_PNG,
};

function mediaCards(page: Page): Locator {
  return page
    .getByRole("listitem")
    .filter({ has: page.getByRole("button", { name: "Move up" }) });
}

async function openSection(page: Page, personId: string): Promise<void> {
  await page.goto(`/person/${personId}/edit?section=media`);
  await expect(
    page.getByRole("heading", { level: 2, name: "Media" }),
  ).toBeVisible();
}

test.describe("the Media section", () => {
  test("starts empty and offers the upload control", async ({
    moderatorPage,
  }) => {
    const id = await scratch.create("Nomedia");
    await openSection(moderatorPage, id);

    await expect(
      moderatorPage.getByText("No media attached yet."),
    ).toBeVisible();
    const upload = moderatorPage.getByLabel("Upload a photo or document");
    await expect(upload).toBeVisible();
    await expect(upload).toHaveAttribute("accept", /image\/jpeg/);
    await expect(upload).toHaveAttribute("accept", /application\/pdf/);
    await expect(
      moderatorPage.getByRole("button", { name: "Save" }),
    ).toBeDisabled();
  });

  test("shows an attached photo with its caption and controls", async ({
    moderatorPage,
  }) => {
    const id = await scratch.create("Hasmedia");
    await media.attach(id, { caption: "On the quay", isPrimary: true });
    await openSection(moderatorPage, id);

    const card = mediaCards(moderatorPage).first();
    await expect(card.getByLabel("Caption")).toHaveValue("On the quay");
    await expect(card.getByRole("img")).toBeVisible();
    await expect(card.getByRole("button", { name: "Primary" })).toBeDisabled();
  });

  test("the thumbnail opens the media viewer", async ({ moderatorPage }) => {
    const id = await scratch.create("Opensviewer");
    const mediaId = await media.attach(id, { caption: "Click me" });
    await openSection(moderatorPage, id);

    await mediaCards(moderatorPage).first().getByRole("link").click();
    await expect(moderatorPage).toHaveURL(new RegExp(`/media/${mediaId}$`));
  });

  test("saves a changed caption and reads it back", async ({
    moderatorPage,
  }) => {
    const id = await scratch.create("Captions");
    await media.attach(id, { caption: "Before" });
    await openSection(moderatorPage, id);

    const save = moderatorPage.getByRole("button", { name: "Save" });
    await expect(save).toBeDisabled();
    await mediaCards(moderatorPage).first().getByLabel("Caption").fill("After");
    await expect(save).toBeEnabled();
    await save.click();
    await expect(moderatorPage.getByText("Saved.")).toBeVisible();

    await moderatorPage.reload();
    await expect(
      mediaCards(moderatorPage).first().getByLabel("Caption"),
    ).toHaveValue("After");
  });

  test("Set as primary takes effect at once, without a Save", async ({
    moderatorPage,
  }) => {
    const id = await scratch.create("Primaries");
    await media.attach(id, { caption: "Was primary", isPrimary: true });
    const promoted = await media.attach(id, {
      caption: "Wants to be primary",
    });
    await openSection(moderatorPage, id);

    const card = mediaCards(moderatorPage).nth(1);
    await card.getByRole("button", { name: "Set as primary" }).click();
    await expect(card.getByRole("button", { name: "Primary" })).toBeDisabled({
      timeout: 15_000,
    });

    // The write is immediate: no Save was clicked, yet the primary moved.
    // Asserted as "the second one is now primary", not "no longer the first"
    // — only one row may be primary at a time, so clearing the old one and
    // failing to set the new one would satisfy a "not the first" check.
    await expect
      .poll(
        async () => {
          const { data } = await admin
            .from("media_link")
            .select("media_id")
            .eq("owner_id", id)
            .eq("is_primary", true)
            .maybeSingle();
          return data?.media_id ?? null;
        },
        { timeout: 15_000 },
      )
      .toBe(promoted);

    // #120: the promotion is a badge, not a move. After a reload the
    // promoted photo is still second, and nothing reads as unsaved.
    await moderatorPage.reload();
    const after = mediaCards(moderatorPage);
    await expect(after).toHaveCount(2);
    await expect(after.nth(1).getByLabel("Caption")).toHaveValue(
      "Wants to be primary",
    );
    await expect(
      after.nth(1).getByRole("button", { name: "Primary" }),
    ).toBeDisabled();
    await expect(
      moderatorPage.getByRole("button", { name: "Save" }),
    ).toBeDisabled();
  });

  test("reorders two photos and keeps the order", async ({ moderatorPage }) => {
    const id = await scratch.create("Reordersmedia");
    await media.attach(id, { caption: "Alpha photo" });
    await media.attach(id, { caption: "Beta photo" });
    await openSection(moderatorPage, id);

    const cards = mediaCards(moderatorPage);
    await expect(cards).toHaveCount(2);
    await expect(
      cards.first().getByRole("button", { name: "Move up" }),
    ).toBeDisabled();
    await expect(
      cards.last().getByRole("button", { name: "Move down" }),
    ).toBeDisabled();

    await cards.first().getByRole("button", { name: "Move down" }).click();
    await expect(cards.first().getByLabel("Caption")).toHaveValue("Beta photo");

    await moderatorPage.getByRole("button", { name: "Save" }).click();
    await expect(moderatorPage.getByText("Saved.")).toBeVisible();
    await moderatorPage.reload();
    await expect(
      mediaCards(moderatorPage).first().getByLabel("Caption"),
    ).toHaveValue("Beta photo");
  });

  test("Remove detaches a photo once saved", async ({ moderatorPage }) => {
    const id = await scratch.create("Detachesmedia");
    await media.attach(id, { caption: "Doomed photo" });
    await openSection(moderatorPage, id);

    await mediaCards(moderatorPage)
      .first()
      .getByRole("button", { name: "Remove" })
      .click();
    await expect(mediaCards(moderatorPage)).toHaveCount(0);
    await moderatorPage.getByRole("button", { name: "Save" }).click();
    await expect(moderatorPage.getByText("Saved.")).toBeVisible();

    await moderatorPage.reload();
    await expect(
      moderatorPage.getByText("No media attached yet."),
    ).toBeVisible();
  });

  test("a removal not yet saved can be abandoned by reloading", async ({
    moderatorPage,
  }) => {
    const id = await scratch.create("Undoesremove");
    await media.attach(id, { caption: "Still here" });
    await openSection(moderatorPage, id);

    await mediaCards(moderatorPage)
      .first()
      .getByRole("button", { name: "Remove" })
      .click();
    await expect(mediaCards(moderatorPage)).toHaveCount(0);

    await moderatorPage.reload();
    await expect(
      mediaCards(moderatorPage).first().getByLabel("Caption"),
    ).toHaveValue("Still here");
  });
});

test.describe("uploading a file", () => {
  test.beforeAll(async () => {
    test.skip(!(await mediaProcessAvailable()), SERVE_HINT);
  });

  /**
   * An upload writes a real `media` row through `media-process`, which this
   * spec never learns the id of up front. Sweeping by owner in `afterAll`
   * rather than inline at the end of each test means a failing assertion
   * still cleans up after itself — the regression test below fails on
   * purpose until #116 is fixed, and left inline its upload leaked on every
   * run.
   */
  const uploadOwners: string[] = [];

  async function personForUpload(slug: string): Promise<string> {
    const id = await scratch.create(slug);
    uploadOwners.push(id);
    return id;
  }

  test.afterAll(async () => {
    if (uploadOwners.length === 0) {
      return;
    }
    const links = await admin
      .from("media_link")
      .select("media_id")
      .in("owner_id", uploadOwners);
    if (links.error !== null) {
      throw new Error(`upload cleanup read failed: ${links.error.message}`);
    }
    const mediaIds = (links.data ?? []).map((row) => row.media_id);

    const unlinked = await admin
      .from("media_link")
      .delete()
      .in("owner_id", uploadOwners);
    if (unlinked.error !== null) {
      throw new Error(`upload cleanup failed: ${unlinked.error.message}`);
    }
    if (mediaIds.length === 0) {
      return;
    }

    // The objects too: `media-process` wrote three of them per upload, and
    // deleting the row is what makes them unreachable.
    const rows = await admin
      .from("media")
      .select("storage_path_original, storage_path_thumb, storage_path_display")
      .in("id", mediaIds);
    if (rows.error !== null) {
      throw new Error(`upload cleanup read failed: ${rows.error.message}`);
    }
    const paths = (rows.data ?? [])
      .flatMap((row) => [
        row.storage_path_original,
        row.storage_path_thumb,
        row.storage_path_display,
      ])
      .filter((path): path is string => path !== null);
    if (paths.length > 0) {
      await admin.storage.from("media").remove(paths);
    }
    const { error } = await admin.from("media").delete().in("id", mediaIds);
    if (error !== null) {
      throw new Error(`upload cleanup failed: ${error.message}`);
    }
  });

  test("attaches the uploaded photo to the person", async ({
    moderatorPage,
  }) => {
    const id = await personForUpload("Uploadsphoto");
    await openSection(moderatorPage, id);

    await moderatorPage
      .getByLabel("Upload a photo or document")
      .setInputFiles(UPLOAD_PNG);

    const card = mediaCards(moderatorPage).first();
    await expect(card).toBeVisible({ timeout: 30_000 });
    await expect(moderatorPage.getByText("No media attached yet.")).toHaveCount(
      0,
    );

    // Owned by the person now — exactly one link, not a stray second row.
    const { data } = await admin
      .from("media_link")
      .select("media_id")
      .eq("owner_id", id);
    expect(data?.length).toBe(1);
  });

  test("the uploaded photo survives a reload", async ({ moderatorPage }) => {
    const id = await personForUpload("Uploadpersists");
    await openSection(moderatorPage, id);
    await moderatorPage
      .getByLabel("Upload a photo or document")
      .setInputFiles(UPLOAD_PNG);
    await expect(mediaCards(moderatorPage).first()).toBeVisible({
      timeout: 30_000,
    });

    await moderatorPage.reload();
    await expect(mediaCards(moderatorPage)).toHaveCount(1);
  });

  /**
   * Regression for the "Save is already enabled" defect: `media-process`
   * inserts `media_link` without a `sort_order`, so the column lands null,
   * and `diffMediaLinks` reads `null !== 0` as a pending reorder. Opening
   * the section on a person with an uploaded photo therefore reports
   * unsaved changes before anything is touched.
   */
  test("leaves the section clean right after an upload", async ({
    moderatorPage,
  }) => {
    const id = await personForUpload("Cleanafterupload");
    await openSection(moderatorPage, id);
    await moderatorPage
      .getByLabel("Upload a photo or document")
      .setInputFiles(UPLOAD_PNG);
    await expect(mediaCards(moderatorPage).first()).toBeVisible({
      timeout: 30_000,
    });

    await moderatorPage.reload();
    await expect(mediaCards(moderatorPage)).toHaveCount(1);
    await expect(
      moderatorPage.getByRole("button", { name: "Save" }),
    ).toBeDisabled();
  });

  test("refuses a file type the tree does not allow", async ({
    moderatorPage,
  }) => {
    const id = await personForUpload("Refusestype");
    await openSection(moderatorPage, id);

    await moderatorPage.getByLabel("Upload a photo or document").setInputFiles({
      name: "notes.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("not a photo", "utf8"),
    });

    await expect(
      moderatorPage.getByText("That file type isn't allowed here."),
    ).toBeVisible({ timeout: 30_000 });
    await expect(
      moderatorPage.getByText("No media attached yet."),
    ).toBeVisible();
  });
});
