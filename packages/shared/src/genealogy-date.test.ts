import { describe, expect, it } from "vitest";

import {
  GENEALOGY_DATE_KINDS,
  formatGenealogyDate,
  parseGenealogyDate,
  type GenealogyDateFields,
  type GenealogyDateKind,
} from "./genealogy-date";

/**
 * One row per fixture: the raw GEDCOM value, the fields we expect, and the
 * display string. `expected` lists only the columns that matter for that case;
 * the rest are checked against the defaults.
 */
interface Fixture {
  readonly raw: string;
  readonly expected: Partial<GenealogyDateFields> & {
    date_kind: GenealogyDateKind;
  };
  readonly formatted: string;
}

const DEFAULTS: GenealogyDateFields = {
  date_value_raw: "",
  date_kind: "unknown",
  date_year1: null,
  date_month1: null,
  date_day1: null,
  date_year2: null,
  date_month2: null,
  date_day2: null,
  date_calendar: "gregorian",
  date_dual_year: false,
  date_phrase: null,
};

const FIXTURES: readonly Fixture[] = [
  // exact
  {
    raw: "3 JUN 1875",
    expected: {
      date_kind: "exact",
      date_year1: 1875,
      date_month1: 6,
      date_day1: 3,
    },
    formatted: "3 June 1875",
  },
  {
    raw: "MAR 1900",
    expected: { date_kind: "exact", date_year1: 1900, date_month1: 3 },
    formatted: "March 1900",
  },
  {
    raw: "1850",
    expected: { date_kind: "exact", date_year1: 1850 },
    formatted: "1850",
  },
  // about
  {
    raw: "ABT 1850",
    expected: { date_kind: "about", date_year1: 1850 },
    formatted: "About 1850",
  },
  {
    raw: "ABOUT 12 JAN 1850",
    expected: {
      date_kind: "about",
      date_year1: 1850,
      date_month1: 1,
      date_day1: 12,
    },
    formatted: "About 12 January 1850",
  },
  // estimated
  {
    raw: "EST 1855",
    expected: { date_kind: "estimated", date_year1: 1855 },
    formatted: "Estimated 1855",
  },
  // calculated
  {
    raw: "CAL 1860",
    expected: { date_kind: "calculated", date_year1: 1860 },
    formatted: "Calculated 1860",
  },
  // before
  {
    raw: "BEF 1800",
    expected: { date_kind: "before", date_year1: 1800 },
    formatted: "Before 1800",
  },
  // after
  {
    raw: "AFT 15 APR 1912",
    expected: {
      date_kind: "after",
      date_year1: 1912,
      date_month1: 4,
      date_day1: 15,
    },
    formatted: "After 15 April 1912",
  },
  // between
  {
    raw: "BET 1850 AND 1860",
    expected: { date_kind: "between", date_year1: 1850, date_year2: 1860 },
    formatted: "Between 1850 and 1860",
  },
  {
    raw: "BETWEEN JAN 1850 AND DEC 1850",
    expected: {
      date_kind: "between",
      date_year1: 1850,
      date_month1: 1,
      date_year2: 1850,
      date_month2: 12,
    },
    formatted: "Between January 1850 and December 1850",
  },
  // from_to
  {
    raw: "FROM 1900 TO 1910",
    expected: { date_kind: "from_to", date_year1: 1900, date_year2: 1910 },
    formatted: "From 1900 to 1910",
  },
  {
    raw: "FROM 1900",
    expected: { date_kind: "from_to", date_year1: 1900 },
    formatted: "From 1900",
  },
  {
    raw: "TO 1910",
    expected: { date_kind: "from_to", date_year2: 1910 },
    formatted: "To 1910",
  },
  // interpreted
  {
    raw: "INT 1900 (first son's birth)",
    expected: {
      date_kind: "interpreted",
      date_year1: 1900,
      date_phrase: "first son's birth",
    },
    formatted: "1900 (first son's birth)",
  },
  // phrase
  {
    raw: "(sometime in the spring)",
    expected: { date_kind: "phrase", date_phrase: "sometime in the spring" },
    formatted: "sometime in the spring",
  },
  {
    raw: "circa the war years",
    expected: { date_kind: "phrase", date_phrase: "circa the war years" },
    formatted: "circa the war years",
  },
  // unknown
  {
    raw: "",
    expected: { date_kind: "unknown" },
    formatted: "",
  },
  {
    raw: "   ",
    expected: { date_kind: "unknown" },
    formatted: "",
  },
  // Julian
  {
    raw: "@#DJULIAN@ 14 FEB 1750",
    expected: {
      date_kind: "exact",
      date_year1: 1750,
      date_month1: 2,
      date_day1: 14,
      date_calendar: "julian",
    },
    formatted: "14 February 1750 (Julian)",
  },
  // dual year
  {
    raw: "1700/01",
    expected: {
      date_kind: "exact",
      date_year1: 1700,
      date_calendar: "julian",
      date_dual_year: true,
    },
    formatted: "1700/01",
  },
  {
    raw: "11 FEB 1731/32",
    expected: {
      date_kind: "exact",
      date_year1: 1731,
      date_month1: 2,
      date_day1: 11,
      date_calendar: "julian",
      date_dual_year: true,
    },
    formatted: "11 February 1731/32",
  },
  {
    raw: "1899/00",
    expected: {
      date_kind: "exact",
      date_year1: 1899,
      date_calendar: "julian",
      date_dual_year: true,
    },
    formatted: "1899/00",
  },
  // Hebrew / French Republican — stored raw, never converted
  {
    raw: "@#DHEBREW@ 5000",
    expected: {
      date_kind: "phrase",
      date_calendar: "hebrew",
      date_phrase: "@#DHEBREW@ 5000",
    },
    formatted: "@#DHEBREW@ 5000",
  },
  {
    raw: "@#DFRENCH R@ 1 VEND 1",
    expected: {
      date_kind: "phrase",
      date_calendar: "french_republican",
      date_phrase: "@#DFRENCH R@ 1 VEND 1",
    },
    formatted: "@#DFRENCH R@ 1 VEND 1",
  },
  // GEDCOM 7.0 leading calendar keyword
  {
    raw: "JULIAN 14 FEB 1750",
    expected: {
      date_kind: "exact",
      date_year1: 1750,
      date_month1: 2,
      date_day1: 14,
      date_calendar: "julian",
    },
    formatted: "14 February 1750 (Julian)",
  },
  {
    raw: "ABT JULIAN 1700",
    expected: {
      date_kind: "about",
      date_year1: 1700,
      date_calendar: "julian",
    },
    formatted: "About 1700 (Julian)",
  },
  {
    raw: "HEBREW 5 TSH 5000",
    expected: {
      date_kind: "phrase",
      date_calendar: "hebrew",
      date_phrase: "HEBREW 5 TSH 5000",
    },
    formatted: "HEBREW 5 TSH 5000",
  },
];

describe("parseGenealogyDate", () => {
  for (const { raw, expected } of FIXTURES) {
    it(`parses ${JSON.stringify(raw)} as ${expected.date_kind}`, () => {
      const fields = parseGenealogyDate(raw);
      expect(fields).toStrictEqual({
        ...DEFAULTS,
        ...expected,
        date_value_raw: raw,
      });
    });
  }

  it("keeps date_value_raw byte-for-byte, including surrounding whitespace", () => {
    for (const raw of [
      "3 JUN 1875",
      "  ABT 1850  ",
      "\tBET 1850 AND 1860\n",
      "(a phrase)",
      "",
    ]) {
      expect(parseGenealogyDate(raw).date_value_raw).toBe(raw);
    }
  });

  it("parses shorthand regardless of surrounding whitespace and case", () => {
    expect(parseGenealogyDate("  abt 1850 ").date_kind).toBe("about");
    expect(parseGenealogyDate("Bef 1800").date_kind).toBe("before");
  });

  it("falls back to phrase when only one side of a range parses", () => {
    const fields = parseGenealogyDate("BET 1850 AND sometime later");
    expect(fields.date_kind).toBe("phrase");
    expect(fields.date_phrase).toBe("BET 1850 AND sometime later");
  });

  it("rejects an out-of-range day and keeps the value as a phrase", () => {
    const fields = parseGenealogyDate("35 JAN 1900");
    expect(fields.date_kind).toBe("phrase");
    expect(fields.date_phrase).toBe("35 JAN 1900");
  });

  it("treats an unknown-calendar escape as an unconverted phrase", () => {
    const fields = parseGenealogyDate("@#DROMAN@ 754 AUC");
    expect(fields.date_kind).toBe("phrase");
    expect(fields.date_calendar).toBe("unknown");
    expect(fields.date_phrase).toBe("@#DROMAN@ 754 AUC");
  });
});

describe("formatGenealogyDate", () => {
  for (const { raw, formatted } of FIXTURES) {
    it(`formats ${JSON.stringify(raw)} as ${JSON.stringify(formatted)}`, () => {
      expect(formatGenealogyDate(parseGenealogyDate(raw))).toBe(formatted);
    });
  }
});

describe("round trip", () => {
  // The clean, fully-structured kinds re-parse from their own display string to
  // the same structure. Lossy on purpose: `phrase` / `interpreted` free text,
  // and the " (Julian)" display note (kept only when the year is not dual).
  const STABLE = FIXTURES.filter(
    (f) =>
      f.raw.trim() !== "" &&
      f.expected.date_kind !== "phrase" &&
      f.expected.date_kind !== "interpreted" &&
      f.expected.date_calendar !== "hebrew" &&
      f.expected.date_calendar !== "french_republican" &&
      !(f.expected.date_calendar === "julian" && !f.expected.date_dual_year),
  );

  for (const { raw } of STABLE) {
    it(`parse → format → parse is stable for ${JSON.stringify(raw)}`, () => {
      const once = parseGenealogyDate(raw);
      const twice = parseGenealogyDate(formatGenealogyDate(once));
      expect({ ...twice, date_value_raw: "" }).toStrictEqual({
        ...once,
        date_value_raw: "",
      });
    });
  }

  it("exercises every GENEALOGY_DATE_KINDS member", () => {
    const covered = new Set(FIXTURES.map((f) => f.expected.date_kind));
    expect([...covered].sort()).toStrictEqual([...GENEALOGY_DATE_KINDS].sort());
  });
});
