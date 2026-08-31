import { describe, expect, it } from "vitest";

import {
  DEFAULT_EDIT_SECTION,
  EDIT_SECTIONS,
  editSectionHref,
  resolveEditSection,
} from "./sections";

describe("resolveEditSection", () => {
  it("resolves a known slug", () => {
    expect(resolveEditSection("events")).toBe("events");
  });

  it("falls back to the default for an unrecognised slug", () => {
    expect(resolveEditSection("not-a-section")).toBe(DEFAULT_EDIT_SECTION);
  });

  it("falls back to the default when absent", () => {
    expect(resolveEditSection(undefined)).toBe(DEFAULT_EDIT_SECTION);
  });

  it("reads the first value of a repeated query param", () => {
    expect(resolveEditSection(["facts", "notes"])).toBe("facts");
  });

  it("falls back to the default for an empty repeated query param", () => {
    expect(resolveEditSection([])).toBe(DEFAULT_EDIT_SECTION);
  });
});

describe("editSectionHref", () => {
  it("omits the query string for the default section", () => {
    expect(editSectionHref("p1", DEFAULT_EDIT_SECTION)).toBe("/person/p1/edit");
  });

  it("adds ?section= for a non-default section", () => {
    expect(editSectionHref("p1", "events")).toBe(
      "/person/p1/edit?section=events",
    );
  });
});

describe("EDIT_SECTIONS", () => {
  it("matches SPEC §8.3's v1 panel list, in order", () => {
    expect(EDIT_SECTIONS.map((section) => section.label)).toEqual([
      "Name & Gender",
      "Additional Names",
      "Events",
      "Facts",
      "Media",
      "Sources",
      "Notes",
      "Reference Numbers",
    ]);
  });

  it("has a unique slug per section", () => {
    const slugs = EDIT_SECTIONS.map((section) => section.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });
});
