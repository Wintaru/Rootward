import { describe, expect, it } from "vitest";

import { extractVisibleRootPersonId } from "./tree-settings";

describe("extractVisibleRootPersonId", () => {
  it("returns the id when the embedded person is visible", () => {
    expect(
      extractVisibleRootPersonId({
        default_root_person: { id: "11111111-1111-1111-1111-111111111111" },
      }),
    ).toBe("11111111-1111-1111-1111-111111111111");
  });

  it("returns null when no root is set, or when RLS hides the root person from the caller (issue #82)", () => {
    // Both cases produce the same wire shape: a `tree_settings` row exists,
    // but the FK-embedded `person` comes back null — either the column is
    // unset, or the join was filtered by the caller's RLS policy. Callers
    // treat them identically: fall through to `getFallbackRootPersonId`.
    expect(extractVisibleRootPersonId({ default_root_person: null })).toBe(
      null,
    );
  });

  it("returns null when the tree_settings row itself is missing", () => {
    expect(extractVisibleRootPersonId(null)).toBe(null);
  });
});
