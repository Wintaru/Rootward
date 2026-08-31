import { describe, expect, it } from "vitest";

import {
  eventTypeLabel,
  factTypeLabel,
  humanizeToken,
  nameTypeLabel,
  sexLabel,
  unionTypeLabel,
} from "./labels";

describe("humanizeToken", () => {
  it("replaces underscores and capitalises the first letter", () => {
    expect(humanizeToken("bar_mitzvah")).toBe("Bar mitzvah");
    expect(humanizeToken("residence")).toBe("Residence");
  });

  it("returns an empty string for an empty token", () => {
    expect(humanizeToken("")).toBe("");
  });
});

describe("sexLabel", () => {
  it("humanises a known value and passes null through", () => {
    expect(sexLabel("male")).toBe("Male");
    expect(sexLabel(null)).toBeNull();
  });
});

describe("nameTypeLabel", () => {
  it("falls back to Name for an unset type", () => {
    expect(nameTypeLabel(null)).toBe("Name");
    expect(nameTypeLabel("maiden")).toBe("Maiden");
  });
});

describe("unionTypeLabel", () => {
  it("hides unknown and null, humanises the rest", () => {
    expect(unionTypeLabel(null)).toBeNull();
    expect(unionTypeLabel("unknown")).toBeNull();
    expect(unionTypeLabel("married")).toBe("Married");
    expect(unionTypeLabel("civil_union")).toBe("Civil union");
  });
});

describe("eventTypeLabel", () => {
  it("uses the override table for acronyms and proper nouns", () => {
    expect(eventTypeLabel("bar_mitzvah", null)).toBe("Bar Mitzvah");
  });

  it("humanises an ordinary type", () => {
    expect(eventTypeLabel("residence", null)).toBe("Residence");
  });

  it("prefers the free-text label for 'other', falling back to 'Event'", () => {
    expect(eventTypeLabel("other", "Family reunion")).toBe("Family reunion");
    expect(eventTypeLabel("other", null)).toBe("Event");
    expect(eventTypeLabel("other", "  ")).toBe("Event");
  });
});

describe("factTypeLabel", () => {
  it("uses the override table for an acronym", () => {
    expect(factTypeLabel("ssn", null)).toBe("Social Security Number");
    expect(factTypeLabel("national_id", null)).toBe("National ID");
  });

  it("prefers the free-text label for 'other', falling back to 'Fact'", () => {
    expect(factTypeLabel("other", "Blood type")).toBe("Blood type");
    expect(factTypeLabel("other", null)).toBe("Fact");
  });
});
