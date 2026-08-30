import { describe, expect, it } from "vitest";

import {
  GEDCOM_551,
  GEDCOM_70,
  GEDCOM_EMPTY,
  GEDCOM_NAME_SUBTAGS,
} from "./fixtures";
import {
  CHILD_RELATION_KEYWORD,
  EVENT_TAG_FOR,
  EVENT_TYPES,
  FACT_TAG_FOR,
  FACT_TYPES,
  NAME_TYPE_KEYWORD,
  SEX_KEYWORD,
  mapChildRelation,
  mapNameType,
  mapSex,
} from "./mapping";
import { readGedcom } from "./reader";
import { writeGedcom } from "./writer";
import type { ChildRelation, GedcomReadResult, NameType, Sex } from "./types";

const FIXTURES: ReadonlyArray<readonly [string, string]> = [
  ["GEDCOM 5.5.1", GEDCOM_551],
  ["GEDCOM 7.0", GEDCOM_70],
  ["header-only", GEDCOM_EMPTY],
  ["name sub-tags", GEDCOM_NAME_SUBTAGS],
];

function must<T>(value: T | null | undefined, label: string): T {
  if (value === null || value === undefined) {
    throw new Error(`expected ${label} to be present`);
  }
  return value;
}

describe("writeGedcom — round trip", () => {
  for (const [label, text] of FIXTURES) {
    describe(label, () => {
      const original = readGedcom(text);
      const roundTripped = readGedcom(writeGedcom(original));

      it("re-reads to a structurally equal result", () => {
        expect(roundTripped).toEqual(original);
      });

      it("re-reads without warnings", () => {
        expect(roundTripped.warnings).toEqual([]);
      });

      it("is a fixed point on a second pass", () => {
        const once = writeGedcom(original);
        const twice = writeGedcom(readGedcom(once));
        expect(twice).toBe(once);
      });

      it("is deterministic", () => {
        expect(writeGedcom(original)).toBe(writeGedcom(original));
      });

      it("does not mutate the result it serializes", () => {
        const snapshot: GedcomReadResult = JSON.parse(
          JSON.stringify(original),
        ) as GedcomReadResult;
        writeGedcom(original);
        expect(original).toEqual(snapshot);
      });

      it("emits a HEAD and a TRLR", () => {
        const output = writeGedcom(original);
        expect(output.startsWith("0 HEAD\n")).toBe(true);
        expect(output.endsWith("\n0 TRLR\n")).toBe(true);
      });
    });
  }
});

describe("writeGedcom — cross-reference preservation", () => {
  const result = readGedcom(GEDCOM_551);
  const output = writeGedcom(result);
  const reparsed = readGedcom(output);

  it("keeps every record xref", () => {
    expect(reparsed.persons.map((p) => p.gedcom_xref)).toEqual([
      "@I1@",
      "@I2@",
      "@I3@",
    ]);
    expect(reparsed.families.map((f) => f.gedcom_xref)).toEqual(["@F1@"]);
    expect(reparsed.sources.map((s) => s.gedcom_xref)).toEqual(["@S1@"]);
    expect(reparsed.repositories.map((r) => r.gedcom_xref)).toEqual(["@R1@"]);
    expect(reparsed.media.map((m) => m.gedcom_xref)).toEqual(["@O1@"]);
    expect(reparsed.notes.map((n) => n.gedcom_xref)).toEqual(["@N1@"]);
  });

  it("keeps the cross-record pointers", () => {
    const john = must(
      reparsed.persons.find((p) => p.gedcom_xref === "@I1@"),
      "person @I1@",
    );
    expect(john.notes[0]?.note_xref).toBe("@N1@");
    expect(john.citations[0]?.source_xref).toBe("@S1@");
    expect(john.media_links[0]?.media_xref).toBe("@O1@");

    const family = must(reparsed.families[0], "family");
    expect(family.partner1_xref).toBe("@I1@");
    expect(family.partner2_xref).toBe("@I2@");
    expect(family.children[0]?.person_xref).toBe("@I3@");

    expect(reparsed.sources[0]?.repository_xref).toBe("@R1@");
  });

  it("re-emits _FREL / _MREL from the stored relation, not the source word", () => {
    expect(output).toContain("2 _FREL biological");
    expect(output).toContain("2 _MREL biological");
  });

  it("re-emits DATE lines from date_value_raw", () => {
    expect(output).toContain("2 DATE 12 MAR 1820");
    expect(output).toContain("2 DATE FROM 1840 TO 1885");
  });

  it("keeps unmapped sub-tags", () => {
    expect(output).toContain("1 _CUSTOM private field");
    expect(output).toContain("2 CAUS Old age");
    expect(output).toContain("1 _STATUS Married");
  });
});

describe("writeGedcom — reverse enum tables round-trip", () => {
  // `satisfies Record<Enum, string>` only checks key coverage. These assert the
  // tag / keyword the writer emits actually reads back to the same enum value,
  // for every value the reader can produce.

  it("every reader-reachable event type survives EVENT_TAG_FOR → EVENT_TYPES", () => {
    for (const type of new Set(Object.values(EVENT_TYPES))) {
      expect(EVENT_TYPES[EVENT_TAG_FOR[type]]).toBe(type);
    }
  });

  it("every reader-reachable fact type survives FACT_TAG_FOR → FACT_TYPES", () => {
    for (const type of new Set(Object.values(FACT_TYPES))) {
      expect(FACT_TYPES[FACT_TAG_FOR[type]]).toBe(type);
    }
  });

  it("every reader-reachable name type survives NAME_TYPE_KEYWORD → mapNameType", () => {
    const reachable: readonly NameType[] = [
      "birth",
      "married",
      "maiden",
      "immigrant",
      "religious",
      "nickname",
      "also_known_as",
    ];
    for (const type of reachable) {
      expect(mapNameType(NAME_TYPE_KEYWORD[type])).toBe(type);
    }
  });

  it("every reader-reachable sex survives SEX_KEYWORD → mapSex", () => {
    const reachable: readonly Exclude<Sex, "unknown">[] = [
      "male",
      "female",
      "other",
    ];
    for (const sex of reachable) {
      expect(mapSex(SEX_KEYWORD[sex])).toBe(sex);
    }
  });

  it("every child relation survives CHILD_RELATION_KEYWORD → mapChildRelation", () => {
    const relations: readonly ChildRelation[] = [
      "biological",
      "adopted",
      "step",
      "foster",
      "guardian",
      "sealed",
      "unknown",
    ];
    for (const relation of relations) {
      expect(mapChildRelation(CHILD_RELATION_KEYWORD[relation])).toBe(relation);
    }
  });
});

describe("writeGedcom — version option", () => {
  const result = readGedcom(GEDCOM_551);

  it("overrides HEAD.GEDC.VERS when asked", () => {
    const output = writeGedcom(result, { version: "7.0" });
    expect(readGedcom(output).version).toBe("7.0");
    expect(output).toContain("2 VERS 7.0");
  });

  it("preserves the declared version by default", () => {
    expect(readGedcom(writeGedcom(result)).version).toBe("5.5.1");
  });

  it("synthesizes a GEDC block for a header that has none", () => {
    const bare: GedcomReadResult = { ...result, header: [] };
    const output = writeGedcom(bare, { version: "5.5.1" });
    expect(readGedcom(output).version).toBe("5.5.1");
  });
});
