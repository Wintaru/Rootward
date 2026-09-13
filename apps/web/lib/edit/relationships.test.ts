import type { UnionFamilySummary } from "@/lib/db/family-edit";
import { describe, expect, it } from "vitest";

import {
  defaultPartnerRoleForSex,
  toPersonRef,
  unionPartnerLabel,
} from "./relationships";

function union(
  overrides: Partial<UnionFamilySummary> = {},
): UnionFamilySummary {
  return {
    familyId: "fam-1",
    familyUpdatedAt: "2020-01-01T00:00:00Z",
    partner1: { id: "p1", name: "Jane Doe", role: "wife" },
    partner2: { id: "p2", name: "John Smith", role: "husband" },
    relationshipType: "married",
    ...overrides,
  };
}

describe("defaultPartnerRoleForSex", () => {
  it("maps male to husband", () => {
    expect(defaultPartnerRoleForSex("male")).toBe("husband");
  });

  it("maps female to wife", () => {
    expect(defaultPartnerRoleForSex("female")).toBe("wife");
  });

  it("maps unknown, other, and null to partner", () => {
    expect(defaultPartnerRoleForSex("unknown")).toBe("partner");
    expect(defaultPartnerRoleForSex("other")).toBe("partner");
    expect(defaultPartnerRoleForSex(null)).toBe("partner");
  });
});

describe("toPersonRef", () => {
  it("passes an existing person id through unchanged", () => {
    expect(toPersonRef({ kind: "existing", personId: "p1" })).toEqual({
      kind: "existing",
      personId: "p1",
    });
  });

  it("normalises a new person's blank name fields to null", () => {
    expect(
      toPersonRef({
        kind: "new",
        givenName: "  ",
        surname: "  ",
        sex: "unknown",
      }),
    ).toEqual({ kind: "new", givenName: null, surname: null, sex: "unknown" });
  });

  it("trims a new person's name fields", () => {
    expect(
      toPersonRef({
        kind: "new",
        givenName: " Ada ",
        surname: " Lovelace ",
        sex: "female",
      }),
    ).toEqual({
      kind: "new",
      givenName: "Ada",
      surname: "Lovelace",
      sex: "female",
    });
  });
});

describe("unionPartnerLabel", () => {
  it("names the other partner when the focus is partner1", () => {
    expect(unionPartnerLabel(union(), "p1")).toBe("Union with John Smith");
  });

  it("names the other partner when the focus is partner2", () => {
    expect(unionPartnerLabel(union(), "p2")).toBe("Union with Jane Doe");
  });

  it("falls back to a bare label for a single-known-parent family", () => {
    expect(unionPartnerLabel(union({ partner2: null }), "p1")).toBe("Union");
  });
});
