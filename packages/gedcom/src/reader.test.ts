import { describe, expect, it } from "vitest";

import {
  GEDCOM_551,
  GEDCOM_70,
  GEDCOM_EMPTY,
  GEDCOM_NAME_SUBTAGS,
} from "./fixtures";
import { readGedcom } from "./reader";
import type { GedcomReadResult, ParsedFamily, ParsedPerson } from "./types";

function must<T>(value: T | null | undefined, label: string): T {
  if (value === null || value === undefined) {
    throw new Error(`expected ${label} to be present`);
  }
  return value;
}

function person(result: GedcomReadResult, xref: string): ParsedPerson {
  return must(
    result.persons.find((candidate) => candidate.gedcom_xref === xref),
    `person ${xref}`,
  );
}

function family(result: GedcomReadResult, xref: string): ParsedFamily {
  return must(
    result.families.find((candidate) => candidate.gedcom_xref === xref),
    `family ${xref}`,
  );
}

describe("readGedcom — GEDCOM 5.5.1 fixture", () => {
  const result = readGedcom(GEDCOM_551);

  it("detects the version and parses cleanly", () => {
    expect(result.version).toBe("5.5.1");
    expect(result.warnings).toEqual([]);
    expect(result.persons.map((p) => p.gedcom_xref)).toEqual([
      "@I1@",
      "@I2@",
      "@I3@",
    ]);
  });

  it("keeps the HEAD block and SUBM records instead of dropping them", () => {
    expect(result.header).toContainEqual({
      tag: "COPR",
      value: "(c) 2024 Smith Family",
    });
    expect(result.submitters).toEqual([
      {
        tag: "SUBM",
        xref: "@U1@",
        children: [{ tag: "NAME", value: "Josh D" }],
      },
    ]);
  });

  it("maps the first NAME onto the person and the rest to person_name", () => {
    const john = person(result, "@I1@");
    expect(john.given_name).toBe("John Fitzgerald");
    expect(john.surname).toBe("Smith");
    expect(john.nickname).toBe("Jack");
    expect(john.sex).toBe("male");

    expect(john.additional_names).toHaveLength(1);
    const aka = must(john.additional_names[0], "aka name");
    expect(aka.type).toBe("also_known_as");
    expect(aka.surname).toBe("Smyth");
    expect(aka.sort_order).toBe(0);
  });

  it("maps typed events, parses their dates, and records places", () => {
    const john = person(result, "@I1@");
    expect(john.events.map((event) => event.type)).toEqual([
      "birth",
      "death",
      "residence",
    ]);

    const birth = must(john.events[0], "birth event");
    expect(birth.date?.date_kind).toBe("exact");
    expect(birth.date?.date_year1).toBe(1820);
    expect(birth.date?.date_month1).toBe(3);
    expect(birth.place_name).toBe("Boston, Suffolk, Massachusetts, USA");
  });

  it("maps attribute tags to facts, not events", () => {
    const john = person(result, "@I1@");
    expect(john.events.map((event) => event.type)).not.toContain("occupation");

    expect(john.facts).toHaveLength(1);
    const occupation = must(john.facts[0], "occupation fact");
    expect(occupation.type).toBe("occupation");
    expect(occupation.value).toBe("Blacksmith");
    expect(occupation.date?.date_kind).toBe("from_to");
    expect(occupation.date?.date_year1).toBe(1840);
    expect(occupation.date?.date_year2).toBe(1885);
  });

  it("maps reference numbers, note pointers, citations, and media links", () => {
    const john = person(result, "@I1@");
    expect(john.user_reference_number).toBe("SMITH-001");
    expect(john.familysearch_id).toBe("LZ99-ABC");

    expect(john.notes).toEqual([
      { gedcom_xref: null, text: null, note_xref: "@N1@", raw_gedcom: [] },
    ]);
    expect(john.citations[0]).toMatchObject({
      source_xref: "@S1@",
      page: "p. 42",
      quality: 3,
    });
    expect(john.media_links[0]).toMatchObject({
      media_xref: "@O1@",
      is_primary: true,
    });
  });

  it("keeps every unmapped sub-tag in the parent record's raw_gedcom", () => {
    const john = person(result, "@I1@");
    expect(john.raw_gedcom).toContainEqual({
      tag: "_CUSTOM",
      value: "private field",
    });

    const birth = must(john.events[0], "birth event");
    expect(birth.raw_gedcom).toContainEqual({
      tag: "_MYTAG",
      value: "keep me",
    });

    const death = must(john.events[1], "death event");
    expect(death.raw_gedcom).toContainEqual({ tag: "CAUS", value: "Old age" });

    const william = person(result, "@I3@");
    expect(william.raw_gedcom).toContainEqual({
      tag: "FAMC",
      pointer: "@F1@",
    });
  });

  it("maps the family, its partners, children, and marriage", () => {
    const smiths = family(result, "@F1@");
    expect(smiths.partner1_xref).toBe("@I1@");
    expect(smiths.partner1_role).toBe("husband");
    expect(smiths.partner2_xref).toBe("@I2@");
    expect(smiths.partner2_role).toBe("wife");
    expect(smiths.relationship_type).toBe("married");

    expect(smiths.children).toHaveLength(1);
    const child = must(smiths.children[0], "family child");
    expect(child.person_xref).toBe("@I3@");
    expect(child.relation_to_partner1).toBe("biological");
    expect(child.relation_to_partner2).toBe("biological");

    expect(smiths.events.map((event) => event.type)).toEqual(["marriage"]);
    expect(smiths.raw_gedcom).toContainEqual({
      tag: "_STATUS",
      value: "Married",
    });
  });

  it("maps sources, repositories, and the source→repository link", () => {
    const source = must(result.sources[0], "source");
    expect(source).toMatchObject({
      gedcom_xref: "@S1@",
      title: "Massachusetts Vital Records",
      author: "Commonwealth of Massachusetts",
      publication_info: "Boston, 1901",
      repository_xref: "@R1@",
    });
    expect(source.raw_gedcom).toContainEqual({ tag: "_APID", value: "1,2:3" });

    const repository = must(result.repositories[0], "repository");
    expect(repository).toMatchObject({
      gedcom_xref: "@R1@",
      name: "Boston Public Library",
      address: "700 Boylston St",
      phone: "617-555-0100",
      website: "https://www.bpl.org",
    });
    expect(repository.raw_gedcom).toContainEqual({
      tag: "ADDR",
      children: [
        { tag: "CITY", value: "Boston" },
        { tag: "CTRY", value: "USA" },
      ],
    });
    // A repeated PHON is not a legal single column — the extra one is kept.
    expect(repository.raw_gedcom).toContainEqual({
      tag: "PHON",
      value: "617-555-0199",
    });
  });

  it("resolves shared NOTE records and media records", () => {
    expect(result.notes).toEqual([
      {
        gedcom_xref: "@N1@",
        text: "This family emigrated from Ireland in the 1840s.",
        note_xref: null,
        raw_gedcom: [],
      },
    ]);

    const media = must(result.media[0], "media");
    expect(media).toMatchObject({
      gedcom_xref: "@O1@",
      original_filename: "john-smith-portrait.jpg",
      mime_type: "jpeg",
      title: "John Smith, c. 1875",
    });
  });

  it("dedupes places on their normalized form", () => {
    expect(result.places).toEqual([
      {
        name: "Boston, Suffolk, Massachusetts, USA",
        normalized_name: "boston suffolk massachusetts usa",
      },
      {
        name: "New York, New York, USA",
        normalized_name: "new york new york usa",
      },
    ]);
  });
});

describe("readGedcom — GEDCOM 7.0 fixture", () => {
  const result = readGedcom(GEDCOM_70);

  it("detects the version", () => {
    expect(result.version).toBe("7.0");
    expect(result.warnings).toEqual([]);
  });

  it("treats the first TYPE-tagged NAME as the primary name", () => {
    const jane = person(result, "@I1@");
    expect(jane.given_name).toBe("Jane");
    expect(jane.surname).toBe("Doe");
    expect(jane.additional_names).toEqual([]);
  });

  it("parses a 7.0 leading-keyword calendar through the shared date parser", () => {
    const jane = person(result, "@I1@");
    const death = must(
      jane.events.find((event) => event.type === "death"),
      "death event",
    );
    expect(death.date?.date_calendar).toBe("julian");
    expect(death.date?.date_year1).toBe(1750);
    expect(death.date?.date_day1).toBe(14);
  });

  it("reads an inline NOTE and a media FORM nested under FILE", () => {
    const jane = person(result, "@I1@");
    expect(jane.notes[0]?.text).toBe("She kept a detailed diary.");

    const media = must(result.media[0], "media");
    expect(media.mime_type).toBe("image/jpeg");
    expect(media.title).toBe("Jane Doe");
  });

  it("keeps a 7.0-only custom tag in raw_gedcom", () => {
    const jane = person(result, "@I1@");
    expect(jane.raw_gedcom).toContainEqual({
      tag: "_NEW",
      value: "custom seven-oh tag",
    });
  });
});

describe("readGedcom — primary NAME sub-tags", () => {
  const result = readGedcom(GEDCOM_NAME_SUBTAGS);
  const ada = person(result, "@I1@");

  it("keeps name-level sub-tags on primary_name_raw_gedcom, not on the person", () => {
    expect(ada.citations).toEqual([]);
    expect(ada.notes).toEqual([]);
    expect(ada.primary_name_raw_gedcom).toContainEqual({
      tag: "SOUR",
      pointer: "@S1@",
      children: [{ tag: "PAGE", value: "birth register" }],
    });
    expect(ada.primary_name_raw_gedcom).toContainEqual({
      tag: "_NAMESRC",
      value: "parish",
    });
  });

  it("keeps person-level sub-tags on the person's own raw_gedcom", () => {
    expect(ada.raw_gedcom).toContainEqual({
      tag: "_CUSTOM",
      value: "person-level tag",
    });
    expect(ada.raw_gedcom).not.toContainEqual({ tag: "SOUR", pointer: "@S1@" });
  });
});

describe("readGedcom — edge cases", () => {
  it("reads a header-only file without persons or warnings", () => {
    const result = readGedcom(GEDCOM_EMPTY);
    expect(result.version).toBe("5.5.1");
    expect(result.persons).toEqual([]);
    expect(result.families).toEqual([]);
    expect(result.warnings).toEqual([]);
  });

  it("never throws and reports a malformed line as a warning", () => {
    const result = readGedcom(
      "0 HEAD\ngarbage\n0 @I1@ INDI\n1 NAME A /B/\n0 TRLR\n",
    );
    expect(result.persons).toHaveLength(1);
    expect(result.warnings).toHaveLength(1);
    expect(must(result.warnings[0], "warning")).toContain("Line 2");
  });

  it("warns about an unmapped level-0 record but keeps going", () => {
    const result = readGedcom("0 HEAD\n0 @X1@ _CUSTOMREC\n1 FOO bar\n0 TRLR\n");
    expect(result.warnings).toEqual([
      "Unmapped level-0 record @X1@ _CUSTOMREC",
    ]);
  });

  it("is pure — two reads of the same input are deeply equal, not shared", () => {
    const first = readGedcom(GEDCOM_551);
    const second = readGedcom(GEDCOM_551);
    expect(first).toEqual(second);
    expect(first).not.toBe(second);
    expect(first.persons[0]).not.toBe(second.persons[0]);
  });
});
