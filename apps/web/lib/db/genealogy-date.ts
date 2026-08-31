import {
  type GenealogyDateFields,
  formatGenealogyDate,
} from "@rootward/shared";

/**
 * Bridge from the flat `date_*` columns that `event`, `fact`, `citation`, and
 * `media` embed (SPEC §4.1) to the portable {@link GenealogyDateFields} shape and
 * its display formatter in `@rootward/shared`.
 *
 * The columns are written by `parseGenealogyDate` at import time; the read views
 * format them back with `formatGenealogyDate`. Date parsing is never
 * re-implemented here (WAYFINDER decision 22).
 */

/** The subset of date columns shared by every dated genealogy row. */
export interface GenealogyDateColumns {
  readonly date_value_raw: string | null;
  readonly date_kind: GenealogyDateFields["date_kind"] | null;
  readonly date_year1: number | null;
  readonly date_month1: number | null;
  readonly date_day1: number | null;
  readonly date_year2: number | null;
  readonly date_month2: number | null;
  readonly date_day2: number | null;
  readonly date_calendar: GenealogyDateFields["date_calendar"];
  readonly date_dual_year: boolean | null;
  readonly date_phrase: string | null;
}

/**
 * Rebuild {@link GenealogyDateFields} from a row's date columns, or `null` when
 * the row carries no date (`date_kind` unset). Coerces the two nullable columns
 * the shared type requires non-null: `date_value_raw` (defaults to empty — only
 * a `phrase` with no `date_phrase` would ever surface it) and `date_dual_year`.
 */
export function toGenealogyDateFields(
  row: GenealogyDateColumns,
): GenealogyDateFields | null {
  if (row.date_kind === null) {
    return null;
  }
  return {
    date_value_raw: row.date_value_raw ?? "",
    date_kind: row.date_kind,
    date_year1: row.date_year1,
    date_month1: row.date_month1,
    date_day1: row.date_day1,
    date_year2: row.date_year2,
    date_month2: row.date_month2,
    date_day2: row.date_day2,
    date_calendar: row.date_calendar,
    date_dual_year: row.date_dual_year ?? false,
    date_phrase: row.date_phrase,
  };
}

/** A row's date as a display string (`"About 1850"`), or `""` when undated. */
export function formatRowDate(row: GenealogyDateColumns): string {
  const fields = toGenealogyDateFields(row);
  return fields === null ? "" : formatGenealogyDate(fields);
}
