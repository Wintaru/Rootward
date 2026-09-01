/**
 * "Date taken" from EXIF into the flat `date_*` column set (SPEC §4.1, decision
 * 25 -- "keep date taken as a media-date hint"). `exif.ts` normalizes whatever
 * EXIF's own naive-datetime format holds into a plain `YYYY-MM-DD` string
 * before it reaches here, so this stays a small, purely testable parser
 * rather than a second copy of `@rootward/shared`'s GEDCOM-string parser
 * (EXIF dates aren't GEDCOM syntax, so `parseGenealogyDate` doesn't apply).
 */

import type { GenealogyDateFields } from "@rootward/shared";

const ISO_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

/** `null` for a missing or unparseable "date taken" -- never throws. */
export function parseExifDateTaken(
  iso: string | null,
): GenealogyDateFields | null {
  if (iso === null) {
    return null;
  }
  const m = ISO_DATE_RE.exec(iso.trim());
  if (m === null) {
    return null;
  }
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) {
    return null;
  }
  return {
    date_value_raw: `${day} ${MONTH_NAMES[month - 1]} ${year}`,
    date_kind: "exact",
    date_year1: year,
    date_month1: month,
    date_day1: day,
    date_year2: null,
    date_month2: null,
    date_day2: null,
    date_calendar: "gregorian",
    date_dual_year: false,
    date_phrase: null,
  };
}
