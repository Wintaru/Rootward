import type { GenealogyDateColumns } from "@/lib/db/genealogy-date";
import type { MediaDetail } from "@/lib/db/media";
import { describe, expect, it } from "vitest";

import { buildMediaDetailView } from "./view-model";

const NO_DATE: GenealogyDateColumns = {
  date_value_raw: null,
  date_kind: null,
  date_year1: null,
  date_month1: null,
  date_day1: null,
  date_year2: null,
  date_month2: null,
  date_day2: null,
  date_calendar: "gregorian",
  date_dual_year: null,
  date_phrase: null,
};

function fixture(overrides: Partial<MediaDetail> = {}): MediaDetail {
  return {
    id: "media-1",
    title: null,
    originalFilename: "photo.jpg",
    mimeType: "image/jpeg",
    sizeBytes: 2048,
    date: NO_DATE,
    storagePathDisplay: "media-1/display.webp",
    storagePathOriginal: "media-1/original.jpg",
    links: [],
    ...overrides,
  };
}

describe("buildMediaDetailView", () => {
  it("falls back to the filename when there is no title", () => {
    const view = buildMediaDetailView(fixture(), "display-url", "original-url");
    expect(view.title).toBe("photo.jpg");
  });

  it("prefers the display derivative when one exists", () => {
    const view = buildMediaDetailView(fixture(), "display-url", "original-url");
    expect(view.imageUrl).toBe("display-url");
  });

  it("falls back to the original for a natively renderable MIME with no derivative", () => {
    const view = buildMediaDetailView(
      fixture({ mimeType: "image/gif", storagePathDisplay: null }),
      null,
      "original-url",
    );
    expect(view.imageUrl).toBe("original-url");
  });

  it("offers no inline image for a non-renderable MIME with no derivative", () => {
    const view = buildMediaDetailView(
      fixture({ mimeType: "application/pdf", storagePathDisplay: null }),
      null,
      "original-url",
    );
    expect(view.imageUrl).toBeNull();
    expect(view.downloadUrl).toBe("original-url");
  });

  it("formats byte sizes across the three magnitudes", () => {
    expect(
      buildMediaDetailView(fixture({ sizeBytes: 512 }), null, null).sizeLabel,
    ).toBe("512 B");
    expect(
      buildMediaDetailView(fixture({ sizeBytes: 20_480 }), null, null)
        .sizeLabel,
    ).toBe("20 KB");
    expect(
      buildMediaDetailView(fixture({ sizeBytes: 5_242_880 }), null, null)
        .sizeLabel,
    ).toBe("5.0 MB");
  });

  it("links a person-owned attachment to their profile", () => {
    const view = buildMediaDetailView(
      fixture({
        links: [
          {
            id: "link-1",
            ownerType: "person",
            ownerId: "person-1",
            isPrimary: true,
            caption: "A caption",
            personName: "Jane Doe",
          },
        ],
      }),
      null,
      null,
    );
    expect(view.links).toEqual([
      {
        id: "link-1",
        label: "Jane Doe",
        href: "/person/person-1",
        isPrimary: true,
        caption: "A caption",
      },
    ]);
  });

  it("labels a non-person attachment generically with no href", () => {
    const view = buildMediaDetailView(
      fixture({
        links: [
          {
            id: "link-2",
            ownerType: "source",
            ownerId: "source-1",
            isPrimary: false,
            caption: null,
            personName: null,
          },
        ],
      }),
      null,
      null,
    );
    expect(view.links).toEqual([
      {
        id: "link-2",
        label: "A source",
        href: null,
        isPrimary: false,
        caption: null,
      },
    ]);
  });
});
