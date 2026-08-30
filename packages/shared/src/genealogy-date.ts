/**
 * Portable genealogy-date parser and formatter (WAYFINDER decision 22, SPEC §4.1).
 *
 * Pure TypeScript — no Node or Deno built-ins — so a C# port stays possible
 * (WAYFINDER decision 8). `packages/gedcom` and the edit-view `DateInput`
 * component (SPEC §8.3) both call these.
 *
 * `parseGenealogyDate` reads a GEDCOM 5.5.1 / 7.0 `DATE` payload into the flat
 * column set that `event`, `fact`, `citation`, and `media` embed. The raw string
 * is kept verbatim and always round-trips; anything the grammar does not cover is
 * stored as a `phrase` and flagged for the user, never rejected. `date_sort_key`
 * is a generated column in Postgres, so it is not produced here.
 *
 * Gregorian and Julian are fully parsed, in both the 5.5.1 escape form
 * (`@#DJULIAN@ 14 FEB 1750`) and the 7.0 keyword form (`JULIAN 14 FEB 1750`).
 * Hebrew and French Republican dates are stored raw with `date_phrase` set and no
 * conversion (WAYFINDER decision 22). A `BCE` / `BC` epoch (GEDCOM 7.0) is not
 * modelled — such a value falls through to `phrase`.
 */

// --- enums (mirror of Postgres types) -------------------------------------
// These two unions copy the `genealogy_date_kind` and `calendar` enums created
// in `supabase/migrations/20260830164537_events_facts_places.sql`. There is no
// cross-package generated-types guard yet (that layer lives in `apps/web`, which
// `packages/shared` must not import). Keep the three copies — SQL, this file, and
// `apps/web/lib/db/database.types.ts` — in step by hand until the edit view adds
// a sync test. Within this file both unions have a compile-time exhaustiveness
// check (`formatGenealogyDate` for the kinds, `calendarNote` for the calendars),
// and the test suite asserts the fixture set exercises every kind.

export const GENEALOGY_DATE_KINDS = [
  "exact",
  "about",
  "estimated",
  "calculated",
  "before",
  "after",
  "between",
  "from_to",
  "interpreted",
  "phrase",
  "unknown",
] as const;

export type GenealogyDateKind = (typeof GENEALOGY_DATE_KINDS)[number];

export const CALENDARS = [
  "gregorian",
  "julian",
  "hebrew",
  "french_republican",
  "unknown",
] as const;

export type Calendar = (typeof CALENDARS)[number];

/**
 * The SPEC §4.1 column set, minus `date_sort_key` (generated in Postgres).
 * `date_value_raw` is the exact input and round-trips byte-for-byte.
 */
export interface GenealogyDateFields {
  readonly date_value_raw: string;
  readonly date_kind: GenealogyDateKind;
  readonly date_year1: number | null;
  readonly date_month1: number | null;
  readonly date_day1: number | null;
  readonly date_year2: number | null;
  readonly date_month2: number | null;
  readonly date_day2: number | null;
  readonly date_calendar: Calendar;
  readonly date_dual_year: boolean;
  readonly date_phrase: string | null;
}

// --- lookup tables -------------------------------------------------------

const MONTHS: Readonly<Record<string, number>> = {
  JAN: 1,
  FEB: 2,
  MAR: 3,
  APR: 4,
  MAY: 5,
  JUN: 6,
  JUL: 7,
  AUG: 8,
  SEP: 9,
  SEPT: 9,
  OCT: 10,
  NOV: 11,
  DEC: 12,
  JANUARY: 1,
  FEBRUARY: 2,
  MARCH: 3,
  APRIL: 4,
  JUNE: 6,
  JULY: 7,
  AUGUST: 8,
  SEPTEMBER: 9,
  OCTOBER: 10,
  NOVEMBER: 11,
  DECEMBER: 12,
};

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

/** GEDCOM 5.5.1 `DATE_CALENDAR_ESCAPE` (`@#DJULIAN@` etc.) to our `calendar` enum. */
const CALENDAR_ESCAPES: Readonly<Record<string, Calendar>> = {
  DGREGORIAN: "gregorian",
  DJULIAN: "julian",
  DHEBREW: "hebrew",
  "DFRENCH R": "french_republican",
  DROMAN: "unknown",
  DUNKNOWN: "unknown",
};

const CALENDAR_ESCAPE_RE = /@#(D[A-Z]+(?: R)?)@/i;

/** GEDCOM 7.0 leading calendar keyword (`JULIAN 14 FEB 1750`) to our enum. */
const CALENDAR_KEYWORDS: Readonly<Record<string, Calendar>> = {
  GREGORIAN: "gregorian",
  JULIAN: "julian",
  HEBREW: "hebrew",
  FRENCH_R: "french_republican",
};

const CALENDAR_KEYWORD_RE =
  /^(?:[A-Z]+\s+)?(GREGORIAN|JULIAN|HEBREW|FRENCH_R)\s/i;

// --- parse -------------------------------------------------------------

/**
 * Parse a raw GEDCOM `DATE` value into the embedded column set. Never throws:
 * unrecognised input becomes `{ date_kind: "phrase" }` with the text preserved.
 */
export function parseGenealogyDate(raw: string): GenealogyDateFields {
  const base = emptyFields(raw);
  const text = raw.trim();

  if (text === "") {
    return { ...base, date_kind: "unknown" };
  }

  // Standalone phrase: `(free text)` with no date in front.
  const phraseOnly = /^\(([^]*)\)$/.exec(text);
  if (phraseOnly !== null) {
    const inner = (phraseOnly[1] ?? "").trim();
    return {
      ...base,
      date_kind: "phrase",
      date_phrase: inner === "" ? text : inner,
    };
  }

  // Interpreted: `INT <date> (<phrase>)`.
  const interpreted = /^INT\s+([^]+?)\s*\(([^)]*)\)\s*$/i.exec(text);
  if (interpreted !== null) {
    const phrase = (interpreted[2] ?? "").trim();
    const expr = parseDateExpr(interpreted[1] ?? "");
    if (expr !== null) {
      return {
        ...fieldsFromExpr(raw, expr),
        date_kind: "interpreted",
        date_phrase: phrase === "" ? null : phrase,
      };
    }
    return { ...base, date_kind: "phrase", date_phrase: text };
  }

  // Hebrew / French Republican / Roman: kept raw, never converted.
  const rawCalendar = nonConvertibleCalendar(text);
  if (rawCalendar !== null) {
    return {
      ...base,
      date_kind: "phrase",
      date_calendar: rawCalendar,
      date_phrase: text,
    };
  }

  const expr = parseDateExpr(text);
  if (expr !== null) {
    return fieldsFromExpr(raw, expr);
  }

  // Unparseable — keep it, flag it (SPEC §8.3), never reject it.
  return { ...base, date_kind: "phrase", date_phrase: text };
}

interface DateExpr {
  readonly kind: GenealogyDateKind;
  readonly year1: number | null;
  readonly month1: number | null;
  readonly day1: number | null;
  readonly year2: number | null;
  readonly month2: number | null;
  readonly day2: number | null;
  readonly calendar: Calendar;
  readonly dualYear: boolean;
}

interface DatePart {
  readonly year: number;
  readonly month: number | null;
  readonly day: number | null;
  readonly dualYear: boolean;
}

/** The qualifier grammar: `ABT`/`CAL`/`EST`, `BEF`/`AFT`, `BET…AND…`, `FROM…TO…`. */
function parseDateExpr(input: string): DateExpr | null {
  const s = input.trim();
  if (s === "") return null;

  const between = /^(?:BET|BETWEEN)\s+([^]+?)\s+AND\s+([^]+)$/i.exec(s);
  if (between !== null) {
    return twoDates("between", between[1], between[2]);
  }

  const fromTo = /^FROM\s+([^]+?)\s+TO\s+([^]+)$/i.exec(s);
  if (fromTo !== null) {
    return twoDates("from_to", fromTo[1], fromTo[2]);
  }

  const from = /^FROM\s+([^]+)$/i.exec(s);
  if (from !== null) return oneDate("from_to", from[1], 1);

  const to = /^TO\s+([^]+)$/i.exec(s);
  if (to !== null) return oneDate("from_to", to[1], 2);

  const before = /^(?:BEF|BEFORE)\s+([^]+)$/i.exec(s);
  if (before !== null) return oneDate("before", before[1], 1);

  const after = /^(?:AFT|AFTER)\s+([^]+)$/i.exec(s);
  if (after !== null) return oneDate("after", after[1], 1);

  // GEDCOM uses `ABT` / `CAL` / `EST`; the long forms let our own formatter
  // output re-parse (the edit view round-trips the display string — SPEC §8.3).
  const approx = /^(ABT|ABOUT|CAL|CALCULATED|EST|ESTIMATED)\s+([^]+)$/i.exec(s);
  if (approx !== null) {
    const keyword = (approx[1] ?? "").toUpperCase();
    const kind: GenealogyDateKind = keyword.startsWith("CAL")
      ? "calculated"
      : keyword.startsWith("EST")
        ? "estimated"
        : "about";
    return oneDate(kind, approx[2], 1);
  }

  return oneDate("exact", s, 1);
}

/** One `DATE` in the given slot (`1` or `2`), with an optional calendar marker. */
function oneDate(
  kind: GenealogyDateKind,
  dateText: string | undefined,
  slot: 1 | 2,
): DateExpr | null {
  if (dateText === undefined) return null;

  const { calendar, rest } = stripLeadingCalendar(dateText);
  const part = parseDatePart(rest);
  if (part === null) return null;

  const resolved: Calendar = part.dualYear ? "julian" : calendar;
  const empty: DateExpr = {
    kind,
    year1: null,
    month1: null,
    day1: null,
    year2: null,
    month2: null,
    day2: null,
    calendar: resolved,
    dualYear: part.dualYear,
  };

  if (slot === 1) {
    return { ...empty, year1: part.year, month1: part.month, day1: part.day };
  }
  return { ...empty, year2: part.year, month2: part.month, day2: part.day };
}

/** Two `DATE`s for `between` / `from_to`. Both sides must parse. */
function twoDates(
  kind: "between" | "from_to",
  left: string | undefined,
  right: string | undefined,
): DateExpr | null {
  const a = oneDate(kind, left, 1);
  const b = oneDate(kind, right, 2);
  if (a === null || b === null) return null;

  return {
    ...a,
    year2: b.year2,
    month2: b.month2,
    day2: b.day2,
    dualYear: a.dualYear || b.dualYear,
    calendar: b.calendar !== "gregorian" ? b.calendar : a.calendar,
  };
}

/** `[day] [month] year`, `year` optionally in `1700/01` dual form. */
function parseDatePart(text: string): DatePart | null {
  const trimmed = text.trim();
  if (trimmed === "") return null;

  const tokens = trimmed.split(/\s+/);
  if (tokens.length < 1 || tokens.length > 3) return null;

  const yearToken = tokens[tokens.length - 1];
  if (yearToken === undefined) return null;
  const year = parseYear(yearToken);
  if (year === null) return null;

  let month: number | null = null;
  if (tokens.length >= 2) {
    const monthToken = tokens[tokens.length - 2];
    if (monthToken === undefined) return null;
    const m = MONTHS[monthToken.toUpperCase()];
    if (m === undefined) return null;
    month = m;
  }

  let day: number | null = null;
  if (tokens.length === 3) {
    const dayToken = tokens[0];
    if (dayToken === undefined || !/^\d{1,2}$/.test(dayToken)) return null;
    const d = Number(dayToken);
    if (d < 1 || d > 31) return null;
    day = d;
  }

  return { year: year.value, month, day, dualYear: year.dual };
}

interface ParsedYear {
  readonly value: number;
  readonly dual: boolean;
}

function parseYear(token: string): ParsedYear | null {
  const dual = /^(\d{1,4})\/\d{2}$/.exec(token);
  if (dual !== null) {
    const head = dual[1];
    if (head === undefined) return null;
    const value = Number(head);
    return isYear(value) ? { value, dual: true } : null;
  }
  if (/^\d{1,4}$/.test(token)) {
    const value = Number(token);
    return isYear(value) ? { value, dual: false } : null;
  }
  return null;
}

function isYear(n: number): boolean {
  return Number.isInteger(n) && n >= 1 && n <= 9999;
}

/**
 * Strip a leading calendar marker — the 5.5.1 escape (`@#DJULIAN@`) or the 7.0
 * keyword (`JULIAN`). Non-convertible calendars are caught earlier by
 * `nonConvertibleCalendar`, so anything else resolves to `gregorian` here.
 */
function stripLeadingCalendar(text: string): {
  readonly calendar: Calendar;
  readonly rest: string;
} {
  const trimmed = text.trim();

  const escape = /^@#(D[A-Z]+(?: R)?)@\s*([^]*)$/i.exec(trimmed);
  if (escape !== null) {
    const key = escape[1];
    const calendar =
      key === undefined
        ? "gregorian"
        : (CALENDAR_ESCAPES[key.toUpperCase()] ?? "gregorian");
    return { calendar, rest: (escape[2] ?? "").trim() };
  }

  const keyword = /^(GREGORIAN|JULIAN|HEBREW|FRENCH_R)\s+([^]+)$/i.exec(
    trimmed,
  );
  if (keyword !== null) {
    const key = (keyword[1] ?? "").toUpperCase();
    return {
      calendar: CALENDAR_KEYWORDS[key] ?? "gregorian",
      rest: (keyword[2] ?? "").trim(),
    };
  }

  return { calendar: "gregorian", rest: trimmed };
}

/**
 * Return `hebrew` / `french_republican` / `unknown` when the value carries a
 * calendar marker we do not convert, else `null` (Gregorian / Julian go through
 * the normal parser). Handles both the 5.5.1 escape and the 7.0 keyword (the
 * latter only after an optional leading qualifier such as `ABT`).
 */
function nonConvertibleCalendar(text: string): Calendar | null {
  const escape = CALENDAR_ESCAPE_RE.exec(text);
  if (escape !== null) {
    const key = escape[1];
    if (key === undefined) return null;
    const calendar = CALENDAR_ESCAPES[key.toUpperCase()] ?? "unknown";
    return isNonConvertible(calendar) ? calendar : null;
  }

  const keyword = CALENDAR_KEYWORD_RE.exec(text.trim());
  if (keyword !== null) {
    const key = (keyword[1] ?? "").toUpperCase();
    const calendar = CALENDAR_KEYWORDS[key] ?? "gregorian";
    return isNonConvertible(calendar) ? calendar : null;
  }

  return null;
}

function isNonConvertible(calendar: Calendar): boolean {
  return (
    calendar === "hebrew" ||
    calendar === "french_republican" ||
    calendar === "unknown"
  );
}

function emptyFields(raw: string): GenealogyDateFields {
  return {
    date_value_raw: raw,
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
}

function fieldsFromExpr(raw: string, expr: DateExpr): GenealogyDateFields {
  return {
    date_value_raw: raw,
    date_kind: expr.kind,
    date_year1: expr.year1,
    date_month1: expr.month1,
    date_day1: expr.day1,
    date_year2: expr.year2,
    date_month2: expr.month2,
    date_day2: expr.day2,
    date_calendar: expr.calendar,
    date_dual_year: expr.dualYear,
    date_phrase: null,
  };
}

// --- format ----------------------------------------------------------

/**
 * A human-readable display string for a stored date. The inverse of the common
 * shorthand — `parseGenealogyDate("ABT 1850")` then `formatGenealogyDate` gives
 * `"About 1850"` — but lossy: `phrase` text and calendar notes are dropped where
 * they cannot be shown. Returns `""` for an unknown date.
 */
export function formatGenealogyDate(fields: GenealogyDateFields): string {
  switch (fields.date_kind) {
    case "unknown":
      return "";
    case "phrase":
      return fields.date_phrase ?? fields.date_value_raw.trim();
    case "interpreted": {
      const shown = formatPart(fields, 1);
      const phrase = fields.date_phrase;
      if (shown !== "" && phrase !== null) return `${shown} (${phrase})`;
      if (shown !== "") return shown;
      return phrase ?? fields.date_value_raw.trim();
    }
    case "exact":
      return formatPart(fields, 1);
    case "about":
      return withPrefix("About", fields);
    case "estimated":
      return withPrefix("Estimated", fields);
    case "calculated":
      return withPrefix("Calculated", fields);
    case "before":
      return withPrefix("Before", fields);
    case "after":
      return withPrefix("After", fields);
    case "between": {
      const a = formatPart(fields, 1);
      const b = formatPart(fields, 2);
      if (a !== "" && b !== "") return `Between ${a} and ${b}`;
      if (a !== "") return `After ${a}`;
      if (b !== "") return `Before ${b}`;
      return "";
    }
    case "from_to": {
      const a = formatPart(fields, 1);
      const b = formatPart(fields, 2);
      if (a !== "" && b !== "") return `From ${a} to ${b}`;
      if (a !== "") return `From ${a}`;
      if (b !== "") return `To ${b}`;
      return "";
    }
    default: {
      const exhaustive: never = fields.date_kind;
      return exhaustive;
    }
  }
}

function withPrefix(label: string, fields: GenealogyDateFields): string {
  const shown = formatPart(fields, 1);
  return shown === "" ? label : `${label} ${shown}`;
}

function formatPart(fields: GenealogyDateFields, which: 1 | 2): string {
  const year = which === 1 ? fields.date_year1 : fields.date_year2;
  if (year === null) return "";

  const month = which === 1 ? fields.date_month1 : fields.date_month2;
  const day = which === 1 ? fields.date_day1 : fields.date_day2;
  const monthName =
    month !== null && month >= 1 && month <= 12
      ? (MONTH_NAMES[month - 1] ?? null)
      : null;

  const yearText =
    fields.date_dual_year && which === 1
      ? `${year}/${String((year + 1) % 100).padStart(2, "0")}`
      : String(year);

  let shown: string;
  if (monthName !== null && day !== null) {
    shown = `${day} ${monthName} ${yearText}`;
  } else if (monthName !== null) {
    shown = `${monthName} ${yearText}`;
  } else {
    shown = yearText;
  }

  // The `1700/01` dual form already signals Julian, so it takes no suffix.
  if (!fields.date_dual_year) {
    shown += calendarNote(fields.date_calendar);
  }
  return shown;
}

/**
 * The parenthetical a display string carries for a non-Gregorian calendar.
 * Exhaustive over `Calendar` so a new enum value fails to compile here.
 */
function calendarNote(calendar: Calendar): string {
  switch (calendar) {
    case "julian":
      return " (Julian)";
    case "gregorian":
    case "hebrew":
    case "french_republican":
    case "unknown":
      return "";
    default: {
      const exhaustive: never = calendar;
      return exhaustive;
    }
  }
}
