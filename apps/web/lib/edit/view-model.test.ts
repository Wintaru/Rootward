import type { PersonEditShellData } from "@/lib/db/person";
import type { Neighborhood } from "@/lib/db/types";
import { describe, expect, it } from "vitest";

import { buildEditShellView } from "./view-model";

/**
 * A focus person "p1" (Jane Doe) with parents p2/p3, a sibling p4, a partner
 * p5 (married), and children p6/p7 — the same shape as
 * `lib/person/view-model.test.ts`'s fixture, since `resolveRelationships` is
 * shared, but built directly here so this file does not depend on a sibling
 * test file's internals.
 */
function fixtureNeighborhood(): Neighborhood {
  return {
    focus_id: "p1",
    persons: [
      person("p1", "Jane", "Doe", 0, 1930, null),
      person("p2", "John", "Doe", 1, 1900, 1970),
      person("p3", "Mary", "Doe", 1, 1905, 1980),
      person("p4", "Sam", "Doe", 0, 1928, 2000),
      person("p5", "Alex", "Smith", 0, 1929, 1999),
      person("p6", "Bea", "Smith", -1, 1955, null),
      person("p7", "Carl", "Smith", -1, 1952, null),
    ],
    families: [
      {
        id: "fam-parents",
        partner1_id: "p2",
        partner2_id: "p3",
        partner1_role: "husband",
        partner2_role: "wife",
        relationship_type: "married",
        child_ids: ["p1", "p4"],
      },
      {
        id: "fam-own",
        partner1_id: "p1",
        partner2_id: "p5",
        partner1_role: "wife",
        partner2_role: "husband",
        relationship_type: "married",
        child_ids: ["p6", "p7"],
      },
    ],
  };
}

function person(
  id: string,
  givenName: string,
  surname: string,
  generation: number,
  birthYear: number | null,
  deathYear: number | null,
): Neighborhood["persons"][number] {
  return {
    id,
    given_name: givenName,
    surname,
    name_prefix: null,
    name_suffix: null,
    nickname: null,
    sex: null,
    is_living: deathYear === null,
    generation,
    can_expand_up: false,
    can_expand_down: false,
    birth_year: birthYear,
    death_year: deathYear,
  };
}

function fixtureData(): PersonEditShellData {
  return {
    person: {
      id: "p1",
      givenName: "Jane",
      surname: "Doe",
      namePrefix: null,
      nameSuffix: null,
      nickname: null,
      sex: "female",
      isLiving: true,
    },
    relationships: fixtureNeighborhood(),
  };
}

describe("buildEditShellView", () => {
  it("assembles the display name and subtitle", () => {
    const view = buildEditShellView(fixtureData());
    expect(view.displayName).toBe("Jane Doe");
    expect(view.subtitle).toBe("Female · b. 1930");
  });

  it("falls back to a placeholder name when every part is blank", () => {
    const data = fixtureData();
    const view = buildEditShellView({
      ...data,
      person: {
        ...data.person,
        givenName: null,
        surname: null,
        nickname: null,
      },
    });
    expect(view.displayName).toBe("Unnamed person");
  });

  it("links back to the read-only profile", () => {
    expect(buildEditShellView(fixtureData()).profileHref).toBe("/person/p1");
  });

  it("puts only parents in the top strip, sorted by birth year", () => {
    const view = buildEditShellView(fixtureData());
    expect(view.parents.map((p) => p.id)).toEqual(["p2", "p3"]);
    expect(view.parents.every((p) => p.href.endsWith("/edit"))).toBe(true);
  });

  it("excludes siblings from every strip", () => {
    const view = buildEditShellView(fixtureData());
    const allIds = [
      ...view.parents.map((p) => p.id),
      ...view.partnersAndChildren.map((p) => p.id),
    ];
    expect(allIds).not.toContain("p4");
  });

  it("combines partners and children into the bottom strip, partners first", () => {
    const view = buildEditShellView(fixtureData());
    expect(view.partnersAndChildren.map((p) => p.id)).toEqual([
      "p5",
      "p7",
      "p6",
    ]);
    expect(view.partnersAndChildren[0]?.detail).toBe("Married");
  });

  it("defaults to the first section and marks it active", () => {
    const view = buildEditShellView(fixtureData());
    expect(view.activeSection.slug).toBe("name-gender");
    expect(view.sections.filter((s) => s.isActive)).toHaveLength(1);
    expect(view.sections[0]?.isActive).toBe(true);
  });

  it("marks the requested section active instead", () => {
    const view = buildEditShellView(fixtureData(), "events");
    expect(view.activeSection.slug).toBe("events");
    expect(view.sections.find((s) => s.slug === "events")?.isActive).toBe(true);
    expect(view.sections.find((s) => s.slug === "name-gender")?.isActive).toBe(
      false,
    );
  });
});
