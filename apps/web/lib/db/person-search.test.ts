import { describe, expect, it } from "vitest";

import {
  formatLifespan,
  nameQueryWords,
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

describe("nameQueryWords", () => {
  it("returns nothing for an empty or whitespace-only query", () => {
    expect(nameQueryWords("")).toEqual([]);
    expect(nameQueryWords("   ")).toEqual([]);
  });

  it("splits on any run of whitespace and trims the ends", () => {
    expect(nameQueryWords("  Gideon \t Qatestsson ")).toEqual([
      "Gideon",
      "Qatestsson",
    ]);
  });

  it("leaves LIKE wildcards alone — the SQL side escapes them", () => {
    expect(nameQueryWords("50% Bud_dy")).toEqual(["50%", "Bud_dy"]);
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
