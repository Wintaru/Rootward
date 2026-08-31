import type { GenealogyDateColumns } from "@/lib/db/genealogy-date";
import type { PersonProfileData } from "@/lib/db/person";
import type { Neighborhood } from "@/lib/db/types";
import { describe, expect, it } from "vitest";

import { buildPersonProfileView } from "./view-model";

const NO_DATE: GenealogyDateColumns = {
  date_value_raw: null,
  date_kind: null,
  date_year1: null,
  date_month1: null,
  date_day1: null,
  date_year2: null,
  date_month2: null,
  date_day2: null,
  date_calendar: "gregorian",
  date_dual_year: null,
  date_phrase: null,
};

function exactDate(year: number): GenealogyDateColumns {
  return {
    ...NO_DATE,
    date_value_raw: String(year),
    date_kind: "exact",
    date_year1: year,
    date_calendar: "gregorian",
  };
}

/**
 * A focus person "p1" (Jane Doe) with parents p2/p3, a sibling p4, a partner p5
 * (married), and children p6/p7 — enough shape to exercise every relationship
 * group and the birth-year sort within each.
 */
function fixtureNeighborhood(): Neighborhood {
  return {
    focus_id: "p1",
    persons: [
      {
        id: "p1",
        given_name: "Jane",
        surname: "Doe",
        name_prefix: null,
        name_suffix: null,
        nickname: null,
        sex: "female",
        is_living: true,
        generation: 0,
        can_expand_up: false,
        can_expand_down: false,
        birth_year: 1930,
        death_year: null,
      },
      {
        id: "p2",
        given_name: "John",
        surname: "Doe",
        name_prefix: null,
        name_suffix: null,
        nickname: null,
        sex: "male",
        is_living: false,
        generation: 1,
        can_expand_up: false,
        can_expand_down: false,
        birth_year: 1900,
        death_year: 1970,
      },
      {
        id: "p3",
        given_name: "Mary",
        surname: "Doe",
        name_prefix: null,
        name_suffix: null,
        nickname: null,
        sex: "female",
        is_living: false,
        generation: 1,
        can_expand_up: false,
        can_expand_down: false,
        birth_year: 1905,
        death_year: 1980,
      },
      {
        id: "p4",
        given_name: "Sam",
        surname: "Doe",
        name_prefix: null,
        name_suffix: null,
        nickname: null,
        sex: "male",
        is_living: false,
        generation: 0,
        can_expand_up: false,
        can_expand_down: false,
        birth_year: 1928,
        death_year: 2000,
      },
      {
        id: "p5",
        given_name: "Alex",
        surname: "Smith",
        name_prefix: null,
        name_suffix: null,
        nickname: null,
        sex: "male",
        is_living: false,
        generation: 0,
        can_expand_up: false,
        can_expand_down: false,
        birth_year: 1929,
        death_year: 1999,
      },
      {
        id: "p6",
        given_name: "Bea",
        surname: "Smith",
        name_prefix: null,
        name_suffix: null,
        nickname: null,
        sex: "female",
        is_living: true,
        generation: -1,
        can_expand_up: false,
        can_expand_down: false,
        birth_year: 1955,
        death_year: null,
      },
      {
        id: "p7",
        given_name: "Carl",
        surname: "Smith",
        name_prefix: null,
        name_suffix: null,
        nickname: null,
        sex: "male",
        is_living: true,
        generation: -1,
        can_expand_up: false,
        can_expand_down: false,
        birth_year: 1952,
        death_year: null,
      },
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

function fixtureData(
  overrides: Partial<PersonProfileData> = {},
): PersonProfileData {
  return {
    person: {
      id: "p1",
      givenName: "Jane",
      surname: "Doe",
      namePrefix: "Dr.",
      nameSuffix: null,
      nickname: "Janie",
      sex: "female",
      isLiving: true,
    },
    names: [],
    events: [],
    facts: [],
    media: [],
    citations: [],
    notes: [],
    relationships: fixtureNeighborhood(),
    ...overrides,
  };
}

describe("buildPersonProfileView", () => {
  it("assembles the full name from prefix, given, surname, and nickname", () => {
    const view = buildPersonProfileView(fixtureData());
    expect(view.fullName).toBe('Dr. Jane Doe "Janie"');
  });

  it("reads the lifespan and living flag from the focus person in the neighborhood", () => {
    const view = buildPersonProfileView(fixtureData());
    expect(view.lifespan).toBe("b. 1930");
    expect(view.isLiving).toBe(true);
  });

  it("links to the tree view centred on this person", () => {
    const view = buildPersonProfileView(fixtureData());
    expect(view.treeHref).toBe("/tree/p1");
  });

  it("orders the timeline by sort_key, undated events last, ties keeping input order", () => {
    const view = buildPersonProfileView(
      fixtureData({
        events: [
          {
            id: "e-undated",
            type: "residence",
            typeOther: null,
            value: null,
            ageText: null,
            sortKey: null,
            placeName: null,
            date: NO_DATE,
          },
          {
            id: "e-death",
            type: "death",
            typeOther: null,
            value: null,
            ageText: null,
            sortKey: "2000",
            placeName: null,
            date: exactDate(2000),
          },
          {
            id: "e-birth",
            type: "birth",
            typeOther: null,
            value: null,
            ageText: null,
            sortKey: "1930",
            placeName: "Springfield",
            date: exactDate(1930),
          },
        ],
      }),
    );

    expect(view.timeline.map((e) => e.id)).toEqual([
      "e-birth",
      "e-death",
      "e-undated",
    ]);
    expect(view.timeline[0]).toMatchObject({
      title: "Birth",
      date: "1930",
      place: "Springfield",
    });
  });

  it("combines an event's value and age into one detail line", () => {
    const view = buildPersonProfileView(
      fixtureData({
        events: [
          {
            id: "e1",
            type: "census",
            typeOther: null,
            value: "Farmer",
            ageText: "30",
            sortKey: "1930",
            placeName: null,
            date: NO_DATE,
          },
        ],
      }),
    );
    expect(view.timeline[0]?.detail).toBe("Farmer · age 30");
  });

  it("labels a fact and flags a restricted or sensitive one", () => {
    const view = buildPersonProfileView(
      fixtureData({
        facts: [
          {
            id: "f-open",
            type: "occupation",
            typeOther: null,
            value: "Farmer",
            isSensitive: false,
            visibility: "everyone_approved",
            placeName: null,
            date: NO_DATE,
          },
          {
            id: "f-restricted",
            type: "medical",
            typeOther: null,
            value: "—",
            isSensitive: false,
            visibility: "moderators_only",
            placeName: null,
            date: NO_DATE,
          },
          {
            id: "f-sensitive",
            type: "ssn",
            typeOther: null,
            value: "000-00-0000",
            isSensitive: true,
            visibility: "everyone_approved",
            placeName: null,
            date: NO_DATE,
          },
        ],
      }),
    );

    expect(view.facts[0]).toMatchObject({
      label: "Occupation",
      value: "Farmer",
      restriction: null,
    });
    expect(view.facts[1]?.restriction).toBe("Moderators only");
    expect(view.facts[2]).toMatchObject({
      label: "Social Security Number",
      restriction: "Sensitive",
    });
  });

  it("splits the neighborhood into parents, siblings, partners, and children", () => {
    const view = buildPersonProfileView(fixtureData());

    expect(view.parents.map((p) => p.name)).toEqual(["John Doe", "Mary Doe"]);
    expect(view.siblings.map((p) => p.name)).toEqual(["Sam Doe"]);
    expect(view.partners).toEqual([
      {
        id: "p5",
        name: "Alex Smith",
        lifespan: "1929–1999",
        detail: "Married",
        href: "/person/p5",
      },
    ]);
    // Birth-year order: Carl (1952) before Bea (1955).
    expect(view.children.map((p) => p.name)).toEqual([
      "Carl Smith",
      "Bea Smith",
    ]);
  });

  it("maps media, sources, and notes", () => {
    const view = buildPersonProfileView(
      fixtureData({
        media: [
          {
            id: "m1",
            title: null,
            filename: "portrait.jpg",
            caption: "Studio portrait",
            isPrimary: true,
          },
        ],
        citations: [
          {
            id: "c1",
            page: "42",
            quality: 3,
            detail: "Household 12",
            sourceTitle: "1930 Census",
            sourceAuthor: "U.S. Census Bureau",
            sourcePublication: null,
            repositoryName: "National Archives",
          },
        ],
        notes: [
          { id: "n1", text: "  " },
          { id: "n2", text: "A family story." },
        ],
      }),
    );

    expect(view.media[0]).toMatchObject({
      label: "portrait.jpg",
      caption: "Studio portrait",
      isPrimary: true,
    });
    expect(view.sources[0]).toMatchObject({
      title: "1930 Census",
      page: "42",
      quality: "Primary evidence",
    });
    expect(view.sources[0]?.meta).toContain("U.S. Census Bureau");
    expect(view.sources[0]?.meta).toContain("National Archives");
    // Blank notes are dropped.
    expect(view.notes).toEqual([{ id: "n2", text: "A family story." }]);
  });

  it("drops an additional name row that has no assembled value", () => {
    const view = buildPersonProfileView(
      fixtureData({
        names: [
          {
            id: "n1",
            type: "maiden",
            givenName: null,
            surname: null,
            prefix: null,
            suffix: null,
            nickname: null,
          },
          {
            id: "n2",
            type: "married",
            givenName: "Jane",
            surname: "Smith",
            prefix: null,
            suffix: null,
            nickname: null,
          },
        ],
      }),
    );
    expect(view.names).toEqual([
      { id: "n2", label: "Married", value: "Jane Smith" },
    ]);
  });
});
