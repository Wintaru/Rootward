import { describe, expect, it } from "vitest";

import type { NeighborhoodFamily } from "@/lib/db";

import { endedUnionKeys, readSpouseLinkKey, unionKey } from "./ended-unions";

function family(
  id: string,
  overrides: Partial<NeighborhoodFamily> = {},
): NeighborhoodFamily {
  return {
    id,
    partner1_id: null,
    partner2_id: null,
    partner1_role: null,
    partner2_role: null,
    relationship_type: "married",
    ended_by: null,
    child_ids: [],
    ...overrides,
  };
}

describe("unionKey", () => {
  it("is the same for either partner order", () => {
    expect(unionKey("a", "b")).toBe(unionKey("b", "a"));
  });
});

describe("endedUnionKeys", () => {
  it("keys only two-partner families that ended", () => {
    const keys = endedUnionKeys([
      family("f1", { partner1_id: "a", partner2_id: "b", ended_by: "divorce" }),
      family("f2", { partner1_id: "c", partner2_id: "d" }),
      family("f3", {
        partner1_id: "e",
        partner2_id: null,
        ended_by: "divorce",
      }),
      family("f4", {
        partner1_id: "g",
        partner2_id: "h",
        ended_by: "annulment",
      }),
    ]);
    expect([...keys].sort()).toEqual([unionKey("a", "b"), unionKey("g", "h")]);
  });
});

describe("readSpouseLinkKey", () => {
  it("reads the couple from a family-chart spouse link datum", () => {
    expect(
      readSpouseLinkKey({
        spouse: true,
        source: { data: { id: "b" } },
        target: { data: { id: "a" } },
      }),
    ).toBe(unionKey("a", "b"));
  });

  it("ignores parent-child links and malformed data", () => {
    expect(
      readSpouseLinkKey({
        spouse: false,
        source: [{ data: { id: "a" } }],
        target: { data: { id: "c" } },
      }),
    ).toBeNull();
    expect(readSpouseLinkKey({ spouse: true, source: {} })).toBeNull();
    expect(readSpouseLinkKey(null)).toBeNull();
    expect(readSpouseLinkKey("link")).toBeNull();
  });
});
