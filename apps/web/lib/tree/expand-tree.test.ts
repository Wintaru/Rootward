import { describe, expect, it } from "vitest";

import type {
  Neighborhood,
  NeighborhoodFamily,
  NeighborhoodFragment,
  NeighborhoodPerson,
} from "@/lib/db";

import {
  expandedGeneration,
  findUnresolvedPartners,
  mergeNeighborhoodFragment,
} from "./expand-tree";

function person(
  id: string,
  overrides: Partial<NeighborhoodPerson> = {},
): NeighborhoodPerson {
  return {
    id,
    given_name: "Given",
    surname: "Sur",
    name_prefix: null,
    name_suffix: null,
    nickname: null,
    sex: "male",
    is_living: false,
    generation: 0,
    birth_year: null,
    death_year: null,
    can_expand_up: false,
    can_expand_down: false,
    ...overrides,
  };
}

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
    child_ids: [],
    ...overrides,
  };
}

function neighborhood(
  focusId: string,
  persons: NeighborhoodPerson[],
  families: NeighborhoodFamily[],
): Neighborhood {
  return { focus_id: focusId, persons, families };
}

function fragment(
  persons: NeighborhoodPerson[],
  families: NeighborhoodFamily[] = [],
): NeighborhoodFragment {
  return { persons, families };
}

describe("expandedGeneration", () => {
  it("is one level up for parents", () => {
    expect(expandedGeneration(1, "parents")).toBe(2);
  });
  it("is one level down for children", () => {
    expect(expandedGeneration(-1, "children")).toBe(-2);
  });
  it("stays at the same tier for self", () => {
    expect(expandedGeneration(0, "self")).toBe(0);
  });
});

describe("mergeNeighborhoodFragment", () => {
  it("adds a new person with the supplied generation", () => {
    const base = neighborhood("focus", [person("focus")], []);
    const merged = mergeNeighborhoodFragment(
      base,
      fragment([person("dad", { generation: 0 })]),
      1,
    );
    const dad = merged.persons.find((p) => p.id === "dad");
    expect(dad?.generation).toBe(1);
  });

  it("leaves an already-known person's real generation untouched", () => {
    const base = neighborhood(
      "focus",
      [person("focus"), person("dad", { generation: 1 })],
      [],
    );
    const merged = mergeNeighborhoodFragment(
      base,
      fragment([person("dad", { generation: 0 })]),
      99,
    );
    expect(merged.persons.filter((p) => p.id === "dad")).toHaveLength(1);
    expect(merged.persons.find((p) => p.id === "dad")?.generation).toBe(1);
  });

  it("adds a new family", () => {
    const base = neighborhood("focus", [person("focus")], []);
    const merged = mergeNeighborhoodFragment(
      base,
      fragment(
        [person("dad"), person("mom", { sex: "female" })],
        [
          family("f1", {
            partner1_id: "dad",
            partner2_id: "mom",
            child_ids: ["focus"],
          }),
        ],
      ),
      1,
    );
    expect(merged.families).toHaveLength(1);
    expect(merged.families[0]?.child_ids).toEqual(["focus"]);
  });

  it("widens an existing family's child_ids instead of duplicating it", () => {
    const base = neighborhood(
      "focus",
      [person("focus"), person("kid")],
      [
        family("f1", {
          partner1_id: "focus",
          partner2_id: "spouse",
          child_ids: ["kid"],
        }),
      ],
    );
    const merged = mergeNeighborhoodFragment(
      base,
      fragment(
        [person("kid"), person("kid2")],
        [
          family("f1", {
            partner1_id: "focus",
            partner2_id: "spouse",
            child_ids: ["kid", "kid2"],
          }),
        ],
      ),
      -1,
    );
    expect(merged.families).toHaveLength(1);
    expect(merged.families[0]?.child_ids).toEqual(["kid", "kid2"]);
  });

  it("does not mutate the base neighborhood", () => {
    const base = neighborhood("focus", [person("focus")], []);
    mergeNeighborhoodFragment(base, fragment([person("dad")]), 1);
    expect(base.persons).toHaveLength(1);
  });
});

describe("findUnresolvedPartners", () => {
  it("maps a known partner to an off-window partner id", () => {
    const nb = neighborhood(
      "in",
      [person("in")],
      [family("f1", { partner1_id: "in", partner2_id: "gone" })],
    );
    expect(findUnresolvedPartners(nb).get("in")).toBe("gone");
  });

  it("returns nothing when both partners are known", () => {
    const nb = neighborhood(
      "a",
      [person("a"), person("b")],
      [family("f1", { partner1_id: "a", partner2_id: "b" })],
    );
    expect(findUnresolvedPartners(nb).size).toBe(0);
  });

  it("returns nothing for a single-parent family (no second partner at all)", () => {
    const nb = neighborhood(
      "a",
      [person("a")],
      [family("f1", { partner1_id: "a", partner2_id: null })],
    );
    expect(findUnresolvedPartners(nb).size).toBe(0);
  });
});
