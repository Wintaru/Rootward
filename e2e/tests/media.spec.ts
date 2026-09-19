import {
  FIXTURE_MEDIA_TITLE,
  fixtureIds,
  fixtureMediaId,
} from "../support/fixture-data";
import { expect, test } from "../support/test";

/**
 * `/media/[mediaId]` — the media viewer (SPEC §8.3, §10 item 34), plus the
 * profile gallery that links into it.
 *
 * The image bytes are served through short-lived signed storage URLs minted
 * with the service role (decision 25), because the `media` bucket's own
 * policy is moderator-only — so "an approved viewer can actually see the
 * picture" is a real thing to check, not a formality.
 */

test.describe("the profile gallery", () => {
  test("shows the attached photo", async ({ viewerPage }) => {
    await viewerPage.goto(`/person/${fixtureIds.grandfather}`);
    await expect(
      viewerPage.getByRole("heading", { name: "Media" }),
    ).toBeVisible();
    await expect(viewerPage.getByText("Primary")).toBeVisible();
    await expect(
      viewerPage.getByText("The only photo of Gideon"),
    ).toBeVisible();
  });

  test("serves the thumbnail, not a broken image", async ({ viewerPage }) => {
    await viewerPage.goto(`/person/${fixtureIds.grandfather}`);
    const thumb = viewerPage.locator(`img[alt="${FIXTURE_MEDIA_TITLE}"]`);
    await expect(thumb).toBeVisible();

    const loaded = await thumb.evaluate(
      (img) => (img as HTMLImageElement).naturalWidth > 0,
    );
    expect(loaded, "the signed thumbnail URL must actually load").toBe(true);
  });

  test("opens the viewer from the gallery", async ({ viewerPage }) => {
    await viewerPage.goto(`/person/${fixtureIds.grandfather}`);
    await viewerPage.locator(`a[href="/media/${fixtureMediaId}"]`).click();
    await expect(viewerPage).toHaveURL(new RegExp(`/media/${fixtureMediaId}`));
  });
});

test.describe("the media viewer", () => {
  test("shows the title and metadata", async ({ viewerPage }) => {
    await viewerPage.goto(`/media/${fixtureMediaId}`);
    await expect(
      viewerPage.getByRole("heading", { level: 1, name: FIXTURE_MEDIA_TITLE }),
    ).toBeVisible();
    await expect(viewerPage.getByText(/image\/png/)).toBeVisible();
  });

  test("renders the image", async ({ viewerPage }) => {
    await viewerPage.goto(`/media/${fixtureMediaId}`);
    const image = viewerPage.locator(`img[alt="${FIXTURE_MEDIA_TITLE}"]`);
    await expect(image).toBeVisible();
    const loaded = await image.evaluate(
      (img) => (img as HTMLImageElement).naturalWidth > 0,
    );
    expect(loaded, "the signed display URL must actually load").toBe(true);
  });

  test("offers the original download", async ({ viewerPage }) => {
    await viewerPage.goto(`/media/${fixtureMediaId}`);
    await expect(
      viewerPage.getByRole("link", { name: "Download original" }),
    ).toBeVisible();
  });

  test("lists the records it is linked to", async ({ viewerPage }) => {
    await viewerPage.goto(`/media/${fixtureMediaId}`);
    await expect(
      viewerPage.getByRole("heading", { name: "Linked records" }),
    ).toBeVisible();
    await expect(
      viewerPage.getByRole("link", { name: /Gideon/ }),
    ).toBeVisible();
  });

  test("404s for a media id that does not exist", async ({ viewerPage }) => {
    const response = await viewerPage.goto(
      "/media/00000000-0000-4000-8000-00000000dead",
    );
    expect(response?.status()).toBe(404);
  });

  test("offers no rotate/crop editor to a viewer", async ({ viewerPage }) => {
    await viewerPage.goto(`/media/${fixtureMediaId}`);
    await expect(
      viewerPage.getByRole("button", { name: /Rotate/ }),
    ).toHaveCount(0);
  });

  test("offers the rotate/crop editor to a moderator", async ({
    moderatorPage,
  }) => {
    await moderatorPage.goto(`/media/${fixtureMediaId}`);
    await expect(
      moderatorPage.getByRole("button", { name: /Rotate/ }).first(),
    ).toBeVisible();
  });
});
