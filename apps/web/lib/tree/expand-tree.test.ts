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
  type Expansion,
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
    married_surname: null,
    maiden_surname: null,
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
    ended_by: null,
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

/** An expansion from a person the fixtures never include, so the existing
 * merge cases are unaffected by the flag-clearing. */
const ELSEWHERE: Expansion = { anchorId: "elsewhere", relation: "parents" };

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
      ELSEWHERE,
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
      ELSEWHERE,
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
      ELSEWHERE,
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
      ELSEWHERE,
    );
    expect(merged.families).toHaveLength(1);
    expect(merged.families[0]?.child_ids).toEqual(["kid", "kid2"]);
  });

  it("clears the anchor's up flag once its parents are drawn (#117)", () => {
    const base = neighborhood(
      "focus",
      [person("focus", { can_expand_up: true, can_expand_down: true })],
      [],
    );
    const merged = mergeNeighborhoodFragment(
      base,
      fragment([person("dad")]),
      1,
      { anchorId: "focus", relation: "parents" },
    );
    const focus = merged.persons.find((p) => p.id === "focus");
    expect(focus?.can_expand_up).toBe(false);
    expect(focus?.can_expand_down).toBe(true);
  });

  it("clears the anchor's down flag once its children are drawn", () => {
    const base = neighborhood(
      "focus",
      [person("focus", { can_expand_up: true, can_expand_down: true })],
      [],
    );
    const merged = mergeNeighborhoodFragment(
      base,
      fragment([person("kid")]),
      -1,
      { anchorId: "focus", relation: "children" },
    );
    const focus = merged.persons.find((p) => p.id === "focus");
    expect(focus?.can_expand_down).toBe(false);
    expect(focus?.can_expand_up).toBe(true);
  });

  it("leaves both flags alone for a resolved partner", () => {
    const base = neighborhood(
      "focus",
      [person("focus", { can_expand_up: true, can_expand_down: true })],
      [],
    );
    const merged = mergeNeighborhoodFragment(
      base,
      fragment([person("spouse")]),
      0,
      { anchorId: "focus", relation: "self" },
    );
    const focus = merged.persons.find((p) => p.id === "focus");
    expect(focus?.can_expand_up).toBe(true);
    expect(focus?.can_expand_down).toBe(true);
  });

  it("does not mutate the base neighborhood", () => {
    const focus = person("focus", { can_expand_up: true });
    const base = neighborhood("focus", [focus], []);
    mergeNeighborhoodFragment(base, fragment([person("dad")]), 1, {
      anchorId: "focus",
      relation: "parents",
    });
    expect(base.persons).toHaveLength(1);
    expect(focus.can_expand_up).toBe(true);
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
