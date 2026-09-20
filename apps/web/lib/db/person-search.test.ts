import { describe, expect, it } from "vitest";

import {
  compareBySurnameThenGiven,
  formatLifespan,
  nameIlikeFilter,
  nameQueryFilters,
  personSearchLabel,
  summarizeLifespans,
} from "./person-search";

describe("personSearchLabel", () => {
  it("joins given name and surname", () => {
    expect(
      personSearchLabel({
        given_name: "Jane",
        surname: "Doe",
        nickname: null,
      }),
    ).toBe("Jane Doe");
  });

  it("falls back to nickname when both name parts are empty", () => {
    expect(
      personSearchLabel({ given_name: null, surname: null, nickname: "Bud" }),
    ).toBe("Bud");
  });

  it("falls back to a placeholder when nothing is set", () => {
    expect(
      personSearchLabel({ given_name: null, surname: null, nickname: null }),
    ).toBe("Unnamed person");
  });
});

describe("formatLifespan", () => {
  it("renders a range when both years are known", () => {
    expect(formatLifespan(1806, 1874)).toBe("1806–1874");
  });

  it("renders a birth-only year", () => {
    expect(formatLifespan(1806, null)).toBe("b. 1806");
  });

  it("renders a death-only year", () => {
    expect(formatLifespan(null, 1874)).toBe("d. 1874");
  });

  it("is empty when neither year is known", () => {
    expect(formatLifespan(null, null)).toBe("");
  });
});

describe("nameIlikeFilter", () => {
  it("quotes the pattern so a comma stays inside the operand", () => {
    expect(nameIlikeFilter("%Smith, Jr%")).toBe(
      'given_name.ilike."%Smith, Jr%",surname.ilike."%Smith, Jr%",nickname.ilike."%Smith, Jr%"',
    );
  });

  it("escapes a literal double quote in the pattern", () => {
    expect(nameIlikeFilter('%"Bud"%')).toBe(
      'given_name.ilike."%\\"Bud\\"%",surname.ilike."%\\"Bud\\"%",nickname.ilike."%\\"Bud\\"%"',
    );
  });
});

describe("nameQueryFilters", () => {
  it("returns nothing for an empty or whitespace-only query", () => {
    expect(nameQueryFilters("")).toEqual([]);
    expect(nameQueryFilters("   ")).toEqual([]);
  });

  it("wraps a single word as one substring filter", () => {
    expect(nameQueryFilters("Gideon")).toEqual([nameIlikeFilter("%Gideon%")]);
  });

  it("yields one filter per word so a full name matches across columns", () => {
    expect(nameQueryFilters("  Gideon   Qatestsson ")).toEqual([
      nameIlikeFilter("%Gideon%"),
      nameIlikeFilter("%Qatestsson%"),
    ]);
  });

  it("escapes LIKE wildcards inside each word", () => {
    expect(nameQueryFilters("50% Bud_dy")).toEqual([
      nameIlikeFilter("%50\\%%"),
      nameIlikeFilter("%Bud\\_dy%"),
    ]);
  });
});

describe("compareBySurnameThenGiven", () => {
  it("sorts alphabetically by surname", () => {
    const a = { surname: "Ashby", given_name: "Cornelius" };
    const b = { surname: "Doyle", given_name: "Katherine" };
    expect(compareBySurnameThenGiven(a, b)).toBeLessThan(0);
    expect(compareBySurnameThenGiven(b, a)).toBeGreaterThan(0);
  });

  it("sorts a null (nickname-only) surname after every real surname", () => {
    const nicknameOnly = { surname: null, given_name: null };
    const named = { surname: "Ashby", given_name: "Cornelius" };
    expect(compareBySurnameThenGiven(nicknameOnly, named)).toBeGreaterThan(0);
    expect(compareBySurnameThenGiven(named, nicknameOnly)).toBeLessThan(0);
  });

  it("breaks a surname tie on given name", () => {
    const first = { surname: "Ashby", given_name: "Alice" };
    const second = { surname: "Ashby", given_name: "Bertram" };
    expect(compareBySurnameThenGiven(first, second)).toBeLessThan(0);
  });
});

describe("summarizeLifespans", () => {
  it("picks the earliest birth and death year per person", () => {
    const result = summarizeLifespans(
      ["a", "b"],
      [
        { person_id: "a", type: "birth", date_year1: 1900 },
        { person_id: "a", type: "birth", date_year1: 1899 },
        { person_id: "a", type: "death", date_year1: 1970 },
        { person_id: "b", type: "birth", date_year1: 1920 },
      ],
    );
    expect(result.get("a")).toEqual({ birthYear: 1899, deathYear: 1970 });
    expect(result.get("b")).toEqual({ birthYear: 1920, deathYear: null });
  });

  it("ignores events for ids outside the requested set", () => {
    const result = summarizeLifespans(
      ["a"],
      [{ person_id: "stray", type: "birth", date_year1: 1900 }],
    );
    expect(result.get("a")).toEqual({ birthYear: null, deathYear: null });
    expect(result.has("stray")).toBe(false);
  });

  it("ignores events with no year", () => {
    const result = summarizeLifespans(
      ["a"],
      [{ person_id: "a", type: "birth", date_year1: null }],
    );
    expect(result.get("a")).toEqual({ birthYear: null, deathYear: null });
  });
});
