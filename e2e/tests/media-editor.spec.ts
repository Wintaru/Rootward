import type { Page } from "@playwright/test";

import { solidPng } from "../support/png";
import { scratchMedia, scratchPersons } from "../support/scratch";
import { admin } from "../support/supabase-admin";
import { alerts, expect, test } from "../support/test";

/**
 * `/media/[mediaId]` — the moderator-only rotate/crop editor (SPEC §8.3,
 * issue #35).
 *
 * The editor decodes the original in the browser and repaints a canvas, so
 * every test here works on a real image big enough to drag a crop box over,
 * not the single pixel the rest of the suite uses.
 */

const scratch = scratchPersons();
const media = scratchMedia();

test.afterAll(async () => {
  await media.remove();
  await scratch.remove();
});

const EDITABLE_IMAGE = solidPng(160, 120);

async function openEditableMedia(page: Page, slug: string): Promise<string> {
  const personId = await scratch.create(slug);
  const mediaId = await media.attach(personId, { image: EDITABLE_IMAGE });
  await page.goto(`/media/${mediaId}`);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  return mediaId;
}

/** Opens the editor and waits for the original to finish decoding — every
 * control stays disabled until it has. */
async function openEditor(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Rotate or crop" }).click();
  await expect(page.getByRole("button", { name: "Rotate left" })).toBeEnabled({
    timeout: 30_000,
  });
}

test.describe("the rotate and crop editor", () => {
  test("is offered to a moderator and hidden from a viewer", async ({
    moderatorPage,
    viewerPage,
  }) => {
    const mediaId = await openEditableMedia(moderatorPage, "Editorgate");
    await expect(
      moderatorPage.getByRole("button", { name: "Rotate or crop" }),
    ).toBeVisible();

    // Anchored on the viewer actually having the page: a 404 or a dead
    // session would satisfy "no editor button" just as well.
    const response = await viewerPage.goto(`/media/${mediaId}`);
    expect(response?.status()).toBe(200);
    await expect(viewerPage.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(
      viewerPage.getByRole("button", { name: "Rotate or crop" }),
    ).toHaveCount(0);
  });

  test("opens to a preview and the full control set", async ({
    moderatorPage,
  }) => {
    await openEditableMedia(moderatorPage, "Editoropens");
    await openEditor(moderatorPage);

    const editor = moderatorPage.getByRole("region", {
      name: "Rotate or crop",
    });
    await expect(editor.getByLabel("Preview")).toBeVisible();
    for (const label of [
      "Rotate left",
      "Rotate right",
      "Clear crop",
      "Reset to original",
      "Cancel",
      "Save",
    ]) {
      await expect(editor.getByRole("button", { name: label })).toBeVisible();
    }
    await expect(
      editor.getByText("Drag on the photo to crop it."),
    ).toBeVisible();
  });

  test("Save stays disabled until something actually changes", async ({
    moderatorPage,
  }) => {
    await openEditableMedia(moderatorPage, "Editordirty");
    await openEditor(moderatorPage);
    const editor = moderatorPage.getByRole("region", {
      name: "Rotate or crop",
    });

    await expect(editor.getByRole("button", { name: "Save" })).toBeDisabled();
    await editor.getByRole("button", { name: "Rotate right" }).click();
    await expect(editor.getByRole("button", { name: "Save" })).toBeEnabled();
  });

  test("Rotate right turns the preview on its side", async ({
    moderatorPage,
  }) => {
    await openEditableMedia(moderatorPage, "Editorrotates");
    await openEditor(moderatorPage);
    const preview = moderatorPage.getByLabel("Preview");

    await expect(preview).toHaveAttribute("width", "160");
    await expect(preview).toHaveAttribute("height", "120");

    await moderatorPage.getByRole("button", { name: "Rotate right" }).click();
    await expect(preview).toHaveAttribute("width", "120");
    await expect(preview).toHaveAttribute("height", "160");
  });

  test("four rotations return to the original, and Save turns off", async ({
    moderatorPage,
  }) => {
    await openEditableMedia(moderatorPage, "Editorfullturn");
    await openEditor(moderatorPage);
    const editor = moderatorPage.getByRole("region", {
      name: "Rotate or crop",
    });

    for (let turn = 0; turn < 4; turn += 1) {
      await editor.getByRole("button", { name: "Rotate left" }).click();
    }
    await expect(moderatorPage.getByLabel("Preview")).toHaveAttribute(
      "width",
      "160",
    );
    await expect(editor.getByRole("button", { name: "Save" })).toBeDisabled();
  });

  test("Reset to original undoes a rotation", async ({ moderatorPage }) => {
    await openEditableMedia(moderatorPage, "Editorresets");
    await openEditor(moderatorPage);
    const editor = moderatorPage.getByRole("region", {
      name: "Rotate or crop",
    });

    await editor.getByRole("button", { name: "Rotate right" }).click();
    await expect(editor.getByRole("button", { name: "Save" })).toBeEnabled();

    await editor.getByRole("button", { name: "Reset to original" }).click();
    await expect(moderatorPage.getByLabel("Preview")).toHaveAttribute(
      "width",
      "160",
    );
    await expect(editor.getByRole("button", { name: "Save" })).toBeDisabled();
  });

  test("Clear crop only wakes up once a crop is drawn", async ({
    moderatorPage,
  }) => {
    await openEditableMedia(moderatorPage, "Editorcrops");
    await openEditor(moderatorPage);
    const editor = moderatorPage.getByRole("region", {
      name: "Rotate or crop",
    });
    const clear = editor.getByRole("button", { name: "Clear crop" });
    await expect(clear).toBeDisabled();

    await dragCrop(moderatorPage);
    await expect(clear).toBeEnabled();

    await clear.click();
    await expect(clear).toBeDisabled();
  });

  test("a drawn crop makes the change saveable", async ({ moderatorPage }) => {
    await openEditableMedia(moderatorPage, "Editorcropsaves");
    await openEditor(moderatorPage);
    const editor = moderatorPage.getByRole("region", {
      name: "Rotate or crop",
    });

    await dragCrop(moderatorPage);
    await expect(editor.getByRole("button", { name: "Save" })).toBeEnabled();
  });

  test("Cancel closes the editor and keeps the photo as it was", async ({
    moderatorPage,
  }) => {
    const mediaId = await openEditableMedia(moderatorPage, "Editorcancels");
    await openEditor(moderatorPage);

    await moderatorPage.getByRole("button", { name: "Rotate right" }).click();
    await moderatorPage.getByRole("button", { name: "Cancel" }).click();

    await expect(
      moderatorPage.getByRole("button", { name: "Rotate or crop" }),
    ).toBeVisible();
    const { data } = await admin
      .from("media")
      .select("rotation")
      .eq("id", mediaId)
      .single();
    expect(data?.rotation ?? 0).toBe(0);
  });

  test("Save stores the rotation and closes the editor", async ({
    moderatorPage,
  }) => {
    const mediaId = await openEditableMedia(moderatorPage, "Editorsaves");
    await openEditor(moderatorPage);

    await moderatorPage.getByRole("button", { name: "Rotate right" }).click();
    await moderatorPage.getByRole("button", { name: "Save" }).click();

    await expect(
      moderatorPage.getByRole("button", { name: "Rotate or crop" }),
    ).toBeVisible({ timeout: 30_000 });
    await expect(alerts(moderatorPage)).toHaveCount(0);

    await expect
      .poll(
        async () => {
          const { data } = await admin
            .from("media")
            .select("rotation")
            .eq("id", mediaId)
            .single();
          return data?.rotation ?? 0;
        },
        { timeout: 20_000 },
      )
      .toBe(90);
  });

  test("a saved rotation is still there on the next visit", async ({
    moderatorPage,
  }) => {
    const mediaId = await openEditableMedia(moderatorPage, "Editorpersists");
    await openEditor(moderatorPage);
    await moderatorPage.getByRole("button", { name: "Rotate left" }).click();
    await moderatorPage.getByRole("button", { name: "Save" }).click();
    await expect(
      moderatorPage.getByRole("button", { name: "Rotate or crop" }),
    ).toBeVisible({ timeout: 30_000 });

    await moderatorPage.goto(`/media/${mediaId}`);
    await openEditor(moderatorPage);
    // Reopened at the stored rotation, so it is not a fresh change to save.
    await expect(
      moderatorPage
        .getByRole("region", { name: "Rotate or crop" })
        .getByRole("button", { name: "Save" }),
    ).toBeDisabled();
  });
});

/** Drags a box across the middle of the preview — `react-image-crop` tracks
 * pointer movement over the image, so this is the only way to produce a real
 * crop selection. */
async function dragCrop(page: Page): Promise<void> {
  const preview = page.getByLabel("Preview");
  // The editor sits below the photo, so on a 720-tall viewport the canvas
  // starts at the very bottom edge and the drag would leave the viewport
  // entirely — the pointer events never reach the crop container.
  await preview.scrollIntoViewIfNeeded();
  const box = await preview.boundingBox();
  expect(box, "the preview canvas has no layout box").not.toBeNull();
  if (box === null) {
    return;
  }

  await page.mouse.move(box.x + box.width * 0.2, box.y + box.height * 0.2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.5, {
    steps: 10,
  });
  await page.mouse.move(box.x + box.width * 0.8, box.y + box.height * 0.8, {
    steps: 10,
  });
  await page.mouse.up();
}
