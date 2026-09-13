import { describe, expect, it } from "vitest";

import { collectMediaStoragePaths } from "./wipe-tree";

describe("collectMediaStoragePaths", () => {
  it("flattens the three storage columns across every row", () => {
    expect(
      collectMediaStoragePaths([
        {
          storage_path_original: "a/original.jpg",
          storage_path_thumb: "a/thumb.webp",
          storage_path_display: "a/display.webp",
        },
        {
          storage_path_original: "b/original.png",
          storage_path_thumb: null,
          storage_path_display: null,
        },
      ]),
    ).toEqual([
      "a/original.jpg",
      "a/thumb.webp",
      "a/display.webp",
      "b/original.png",
    ]);
  });

  it("is empty for no rows or all-null columns", () => {
    expect(collectMediaStoragePaths([])).toEqual([]);
    expect(
      collectMediaStoragePaths([
        {
          storage_path_original: null,
          storage_path_thumb: null,
          storage_path_display: null,
        },
      ]),
    ).toEqual([]);
  });
});
