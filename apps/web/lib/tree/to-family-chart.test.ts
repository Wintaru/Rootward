import { describe, expect, it } from "vitest";

import type {
  Neighborhood,
  NeighborhoodFamily,
  NeighborhoodPerson,
} from "@/lib/db";

import { toFamilyChartData } from "./to-family-chart";

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

const datumById = (tree: ReturnType<typeof toFamilyChartData>, id: string) => {
  const found = tree.data.find((d) => d.id === id);
  if (found === undefined) {
    throw new Error(`no datum ${id}`);
  }
  return found;
};

describe("toFamilyChartData", () => {
  it("carries the focus id through as mainId", () => {
    const tree = toFamilyChartData(neighborhood("p1", [person("p1")], []));
    expect(tree.mainId).toBe("p1");
  });

  it("returns an empty data array for an empty neighborhood", () => {
    const tree = toFamilyChartData(neighborhood("p1", [], []));
    expect(tree.data).toEqual([]);
  });

  it("builds spouse and parent/child links from a family", () => {
    const tree = toFamilyChartData(
      neighborhood(
        "child",
        [
          person("dad", { sex: "male" }),
          person("mom", { sex: "female" }),
          person("child"),
        ],
        [
          family("f1", {
            partner1_id: "dad",
            partner2_id: "mom",
            child_ids: ["child"],
          }),
        ],
      ),
    );

    expect(datumById(tree, "dad").rels).toEqual({
      parents: [],
      spouses: ["mom"],
      children: ["child"],
    });
    expect(datumById(tree, "mom").rels.spouses).toEqual(["dad"]);
    expect(datumById(tree, "child").rels.parents).toEqual(["dad", "mom"]);
  });

  it("ignores partners and children outside the neighborhood", () => {
    const tree = toFamilyChartData(
      neighborhood(
        "in",
        [person("in")],
        [
          family("f1", {
            partner1_id: "in",
            partner2_id: "gone",
            child_ids: ["also-gone"],
          }),
        ],
      ),
    );
    expect(datumById(tree, "in").rels).toEqual({
      parents: [],
      spouses: [],
      children: [],
    });
  });

  it("maps male to M and everything else to F for layout, with the real tint", () => {
    const tree = toFamilyChartData(
      neighborhood(
        "a",
        [
          person("a", { sex: "male" }),
          person("b", { sex: "female" }),
          person("c", { sex: "unknown" }),
          person("d", { sex: null }),
        ],
        [],
      ),
    );
    expect(datumById(tree, "a").data).toMatchObject({
      gender: "M",
      sex: "male",
    });
    expect(datumById(tree, "b").data).toMatchObject({
      gender: "F",
      sex: "female",
    });
    expect(datumById(tree, "c").data).toMatchObject({
      gender: "F",
      sex: "neutral",
    });
    expect(datumById(tree, "d").data).toMatchObject({
      gender: "F",
      sex: "neutral",
    });
  });

  it("projects the card fields", () => {
    const tree = toFamilyChartData(
      neighborhood(
        "a",
        [
          person("a", {
            given_name: "Samuel",
            surname: "Ashby",
            nickname: "Sam",
            birth_year: 1830,
            death_year: 1901,
            is_living: false,
          }),
        ],
        [],
      ),
    );
    expect(datumById(tree, "a").data).toEqual({
      gender: "M",
      sex: "male",
      givenName: "Samuel",
      surname: "Ashby",
      nickname: "Sam",
      birthYear: 1830,
      deathYear: 1901,
      isLiving: false,
      avatarUrl: null,
    });
  });

  it("handles a repeated ancestor (pedigree collapse) without duplicating ids", () => {
    // A cousin marriage: g1/g2's two children each parent one of the focus's
    // parents, so g1 + g2 are reachable through both of the focus's lines.
    const tree = toFamilyChartData(
      neighborhood(
        "focus",
        [
          person("g1", { sex: "male" }),
          person("g2", { sex: "female" }),
          person("pa", { sex: "male" }),
          person("ma", { sex: "female" }),
          person("focus"),
        ],
        [
          family("gf", {
            partner1_id: "g1",
            partner2_id: "g2",
            child_ids: ["pa", "ma"],
          }),
          family("pf", {
            partner1_id: "pa",
            partner2_id: "ma",
            child_ids: ["focus"],
          }),
        ],
      ),
    );

    const ids = tree.data.map((d) => d.id);
    expect(ids).toHaveLength(new Set(ids).size); // every id once
    expect(datumById(tree, "g1").rels.children.sort()).toEqual(["ma", "pa"]);
    expect(datumById(tree, "pa").rels.parents).toEqual(["g1", "g2"]);
    expect(datumById(tree, "ma").rels.parents).toEqual(["g1", "g2"]);
  });

  it("never makes a person their own parent or child", () => {
    const tree = toFamilyChartData(
      neighborhood(
        "x",
        [person("x"), person("y", { sex: "female" })],
        [
          family("f1", {
            partner1_id: "x",
            partner2_id: "y",
            child_ids: ["x"],
          }),
        ],
      ),
    );
    expect(datumById(tree, "x").rels.parents).not.toContain("x");
    expect(datumById(tree, "x").rels.children).not.toContain("x");
  });

  it("de-duplicates a person who appears as a child in two families", () => {
    const tree = toFamilyChartData(
      neighborhood(
        "kid",
        [
          person("bio1", { sex: "male" }),
          person("bio2", { sex: "female" }),
          person("kid"),
        ],
        [
          family("f1", { partner1_id: "bio1", child_ids: ["kid"] }),
          family("f2", { partner1_id: "bio2", child_ids: ["kid"] }),
          family("f3", {
            partner1_id: "bio1",
            partner2_id: "bio2",
            child_ids: ["kid"],
          }),
        ],
      ),
    );
    expect(datumById(tree, "kid").rels.parents).toEqual(["bio1", "bio2"]);
  });
});
