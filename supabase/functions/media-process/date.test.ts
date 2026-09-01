import { assertEquals } from "@std/assert";

import { parseExifDateTaken } from "./date.ts";

Deno.test("parseExifDateTaken: null input", () => {
  assertEquals(parseExifDateTaken(null), null);
});

Deno.test("parseExifDateTaken: valid ISO date", () => {
  assertEquals(parseExifDateTaken("2020-05-14"), {
    date_value_raw: "14 May 2020",
    date_kind: "exact",
    date_year1: 2020,
    date_month1: 5,
    date_day1: 14,
    date_year2: null,
    date_month2: null,
    date_day2: null,
    date_calendar: "gregorian",
    date_dual_year: false,
    date_phrase: null,
  });
});

Deno.test("parseExifDateTaken: single-digit day/month formats correctly", () => {
  const fields = parseExifDateTaken("1999-01-02");
  assertEquals(fields?.date_value_raw, "2 January 1999");
});

Deno.test("parseExifDateTaken: rejects an out-of-range month or day", () => {
  assertEquals(parseExifDateTaken("2020-13-01"), null);
  assertEquals(parseExifDateTaken("2020-00-01"), null);
  assertEquals(parseExifDateTaken("2020-05-00"), null);
});

Deno.test("parseExifDateTaken: rejects malformed strings", () => {
  assertEquals(parseExifDateTaken(""), null);
  assertEquals(parseExifDateTaken("not a date"), null);
  assertEquals(parseExifDateTaken("2020:05:14"), null);
});
