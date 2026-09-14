import { describe, expect, it } from "vitest";

import { collectThumbPaths } from "./primary-photos";

describe("collectThumbPaths", () => {
  it("maps each owner to its primary photo's thumb path", () => {
    expect(
      collectThumbPaths([
        { owner_id: "a", media: { storage_path_thumb: "a/thumb.webp" } },
        { owner_id: "b", media: { storage_path_thumb: "b/thumb.webp" } },
      ]),
    ).toEqual({ a: "a/thumb.webp", b: "b/thumb.webp" });
  });

  it("drops a link whose media has no thumb yet, or whose media row is hidden", () => {
    expect(
      collectThumbPaths([
        { owner_id: "a", media: { storage_path_thumb: null } },
        { owner_id: "b", media: null },
        { owner_id: "c", media: { storage_path_thumb: "c/thumb.webp" } },
      ]),
    ).toEqual({ c: "c/thumb.webp" });
  });

  it("is empty for no rows", () => {
    expect(collectThumbPaths([])).toEqual({});
  });
});
