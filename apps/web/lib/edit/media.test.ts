import { describe, expect, it } from "vitest";

import type { RowConflict } from "@/lib/db/conflict";
import type { MediaEditRow } from "@/lib/db/media-edit";

import {
  describeMediaConflicts,
  diffMediaLinks,
  isMediaDiffEmpty,
  mediaFromLoaded,
  mediaReducer,
  reconcileMediaLinksAfterSave,
} from "./media";

const PERSON_ID = "person-1";

const FIRST: MediaEditRow = {
  id: "link-1",
  updatedAt: "2026-01-01T00:00:00Z",
  mediaId: "media-1",
  ownerType: "person",
  ownerId: PERSON_ID,
  caption: "A photo",
  isPrimary: true,
  sortOrder: 0,
  originalFilename: "photo.jpg",
  mimeType: "image/jpeg",
  title: null,
  storagePathThumb: "media-1/thumb.webp",
  storagePathDisplay: "media-1/display.webp",
};

const SECOND: MediaEditRow = {
  ...FIRST,
  id: "link-2",
  mediaId: "media-2",
  caption: "Another photo",
  isPrimary: false,
  sortOrder: 1,
  originalFilename: "scan.png",
  storagePathThumb: "media-2/thumb.webp",
  storagePathDisplay: "media-2/display.webp",
};

describe("mediaFromLoaded", () => {
  it("carries every field through, defaulting a null caption to an empty string", () => {
    const withoutCaption: MediaEditRow = { ...FIRST, caption: null };
    const [draft] = mediaFromLoaded([withoutCaption]);
    expect(draft).toMatchObject({ id: "link-1", caption: "" });
  });
});

describe("mediaReducer", () => {
  it("appends a freshly processed row", () => {
    const next = mediaReducer([], { type: "row_added", row: FIRST });
    expect(next).toEqual(mediaFromLoaded([FIRST]));
  });

  it("updates a single row's caption", () => {
    const state = mediaFromLoaded([FIRST, SECOND]);
    const next = mediaReducer(state, {
      type: "field_changed",
      id: "link-1",
      caption: "Edited",
    });
    expect(next[0]!.caption).toBe("Edited");
    expect(next[1]!.caption).toBe(SECOND.caption);
  });

  it("swaps adjacent rows on move", () => {
    const state = mediaFromLoaded([FIRST, SECOND]);
    const next = mediaReducer(state, {
      type: "moved",
      id: "link-2",
      direction: "up",
    });
    expect(next.map((row) => row.id)).toEqual(["link-2", "link-1"]);
  });

  it("does nothing moving past either end", () => {
    const state = mediaFromLoaded([FIRST, SECOND]);
    const next = mediaReducer(state, {
      type: "moved",
      id: "link-1",
      direction: "up",
    });
    expect(next.map((row) => row.id)).toEqual(["link-1", "link-2"]);
  });

  it("removes a row", () => {
    const state = mediaFromLoaded([FIRST, SECOND]);
    const next = mediaReducer(state, { type: "removed", id: "link-1" });
    expect(next.map((row) => row.id)).toEqual(["link-2"]);
  });

  it("replaces the whole list on reconciled", () => {
    const state = mediaFromLoaded([FIRST]);
    const replacement = mediaFromLoaded([SECOND]);
    const next = mediaReducer(state, {
      type: "reconciled",
      rows: replacement,
    });
    expect(next).toBe(replacement);
  });

  it("row_reset replaces a row's fields with the server's current row", () => {
    const state = mediaReducer(mediaFromLoaded([FIRST]), {
      type: "field_changed",
      id: "link-1",
      caption: "Edited locally",
    });
    const theirs: MediaEditRow = { ...FIRST, caption: "Their edit" };
    const next = mediaReducer(state, {
      type: "row_reset",
      id: "link-1",
      row: theirs,
    });
    expect(next[0]!.caption).toBe("Their edit");
  });

  it("row_reset restores a row this section had already deleted locally", () => {
    const state = mediaReducer(mediaFromLoaded([FIRST, SECOND]), {
      type: "removed",
      id: "link-1",
    });
    const theirs: MediaEditRow = { ...FIRST, caption: "Their edit" };
    const next = mediaReducer(state, {
      type: "row_reset",
      id: "link-1",
      row: theirs,
    });
    expect(next.map((row) => row.id)).toEqual(["link-2", "link-1"]);
    expect(next.find((row) => row.id === "link-1")!.caption).toBe("Their edit");
  });

  it("row_reset removes the row when it was deleted elsewhere", () => {
    const state = mediaFromLoaded([FIRST, SECOND]);
    const next = mediaReducer(state, {
      type: "row_reset",
      id: "link-1",
      row: null,
    });
    expect(next.map((row) => row.id)).toEqual(["link-2"]);
  });
});

describe("diffMediaLinks", () => {
  it("is empty when nothing changed", () => {
    const loaded = [FIRST, SECOND];
    const current = mediaFromLoaded(loaded);
    expect(isMediaDiffEmpty(diffMediaLinks(loaded, current))).toBe(true);
  });

  it("diffs a changed caption as an update", () => {
    const current = mediaReducer(mediaFromLoaded([FIRST]), {
      type: "field_changed",
      id: "link-1",
      caption: "Changed",
    });
    const diff = diffMediaLinks([FIRST], current);
    expect(diff.updates).toEqual([
      {
        id: "link-1",
        expectedUpdatedAt: "2026-01-01T00:00:00Z",
        patch: { caption: "Changed" },
      },
    ]);
  });

  it("normalises a blanked caption to null", () => {
    const current = mediaReducer(mediaFromLoaded([FIRST]), {
      type: "field_changed",
      id: "link-1",
      caption: "   ",
    });
    const diff = diffMediaLinks([FIRST], current);
    expect(diff.updates).toEqual([
      {
        id: "link-1",
        expectedUpdatedAt: "2026-01-01T00:00:00Z",
        patch: { caption: null },
      },
    ]);
  });

  it("diffs a reorder as sortOrder-only updates", () => {
    const loaded = [FIRST, SECOND];
    const current = mediaReducer(mediaFromLoaded(loaded), {
      type: "moved",
      id: "link-2",
      direction: "up",
    });
    const diff = diffMediaLinks(loaded, current);
    expect(diff.updates).toEqual([
      {
        id: "link-2",
        expectedUpdatedAt: "2026-01-01T00:00:00Z",
        patch: { sortOrder: 0 },
      },
      {
        id: "link-1",
        expectedUpdatedAt: "2026-01-01T00:00:00Z",
        patch: { sortOrder: 1 },
      },
    ]);
  });

  it("never diffs isPrimary", () => {
    // isPrimary changes only through `setPrimaryMedia` + reconciliation
    // (see the module doc), never through this diff — flip it directly on
    // the drafts to confirm diffMediaLinks ignores it regardless of how it
    // came to differ from the loaded baseline.
    const current = mediaFromLoaded([FIRST, SECOND]).map((row) => ({
      ...row,
      isPrimary: !row.isPrimary,
    }));
    const diff = diffMediaLinks([FIRST, SECOND], current);
    expect(isMediaDiffEmpty(diff)).toBe(true);
  });

  it("diffs a removed row as a delete", () => {
    const loaded = [FIRST, SECOND];
    const current = mediaReducer(mediaFromLoaded(loaded), {
      type: "removed",
      id: "link-1",
    });
    const diff = diffMediaLinks(loaded, current);
    expect(diff.deletes).toEqual([
      { id: "link-1", expectedUpdatedAt: "2026-01-01T00:00:00Z" },
    ]);
  });
});

describe("reconcileMediaLinksAfterSave", () => {
  it("adopts the server row for a successful update", () => {
    const current = mediaReducer(mediaFromLoaded([FIRST]), {
      type: "field_changed",
      id: "link-1",
      caption: "Changed",
    });
    const saved: MediaEditRow = {
      ...FIRST,
      caption: "Changed",
      updatedAt: "2026-02-01T00:00:00Z",
    };

    const reconciled = reconcileMediaLinksAfterSave([FIRST], current, {
      updated: [saved],
    });

    expect(reconciled.baseline).toEqual([saved]);
    expect(reconciled.current[0]!.updatedAt).toBe("2026-02-01T00:00:00Z");
  });

  it("keeps the local edit and stale baseline for a row that conflicted", () => {
    const current = mediaReducer(mediaFromLoaded([FIRST]), {
      type: "field_changed",
      id: "link-1",
      caption: "Edited locally",
    });

    const reconciled = reconcileMediaLinksAfterSave([FIRST], current, {
      updated: [],
    });

    expect(reconciled.baseline).toEqual([FIRST]);
    expect(reconciled.current[0]!.caption).toBe("Edited locally");
  });
});

describe("describeMediaConflicts", () => {
  it("titles a conflict from the media's filename", () => {
    const current = mediaFromLoaded([FIRST]);
    const conflict: RowConflict<MediaEditRow> = {
      id: "link-1",
      theirs: { ...FIRST, caption: "Theirs" },
      changedBy: null,
    };
    const [item] = describeMediaConflicts([conflict], current);
    expect(item).toMatchObject({
      id: "link-1",
      title: "photo.jpg",
      deleted: false,
      fields: [{ label: "Caption", yours: "A photo", theirs: "Theirs" }],
    });
  });

  it("marks a conflict deleted when theirs is null", () => {
    const current = mediaFromLoaded([FIRST]);
    const conflict: RowConflict<MediaEditRow> = {
      id: "link-1",
      theirs: null,
      changedBy: null,
    };
    const [item] = describeMediaConflicts([conflict], current);
    expect(item).toMatchObject({ deleted: true, fields: [] });
  });
});
