import type { SupabaseClient } from "@supabase/supabase-js";

import { escapeLikePattern } from "./place";
import type { Database } from "./database.types";
import type { Sex } from "./types";

type Db = SupabaseClient<Database>;

/**
 * Name search shared by every `PersonPicker` (`/moderation`, `/settings`,
 * the edit view's Relationships section) and, generalized here, the header
 * search box and `/people` index (issue #62, SPEC §8.1). Originally
 * `searchPersonsForModeration` in `moderation.ts` — moved and renamed when
 * it grew a second, richer consumer.
 */

export interface PersonSearchOption {
  readonly id: string;
  readonly name: string;
  /** Carried through so a `PersonPicker` caller that needs it (the
   * Relationships section's role default, decision 36, issue #56) doesn't pay
   * a second round trip — every other caller just ignores it. */
  readonly sex: Sex | null;
}

/** A search result enriched with birth/death years, for the header search box
 * and `/people` — a plain `PersonSearchOption` has no use for them and every
 * `PersonPicker` caller would otherwise pay for a lifespan lookup it never
 * shows. */
export interface PersonSearchResult extends PersonSearchOption {
  readonly birthYear: number | null;
  readonly deathYear: number | null;
}

const PERSON_SEARCH_LIMIT = 8;
export const HEADER_SEARCH_LIMIT = 20;
export const PEOPLE_PAGE_SIZE = 50;

/** The name a `PersonSearchOption` carries — given + surname, else nickname.
 * Shared with `tree-settings.ts` so the stored default root reads exactly as
 * the picker's options do (issue #53). */
export function personSearchLabel(row: {
  given_name: string | null;
  surname: string | null;
  nickname: string | null;
}): string {
  const full = [row.given_name, row.surname]
    .map((part) => part?.trim() ?? "")
    .filter((part) => part !== "")
    .join(" ");
  return full || row.nickname?.trim() || "Unnamed person";
}

/** `1806–1874` · `b. 1806` · `d. 1874` · `""` when neither year is known.
 * `lib/person/relatives.ts` and `lib/tree/person-card.ts` each carry a
 * lookalike keyed to their own row shape (view-model, tree-card data); this
 * one is kept local to the two consumers below rather than adding a fourth
 * shape to reconcile. */
export function formatLifespan(
  birthYear: number | null,
  deathYear: number | null,
): string {
  if (birthYear !== null && deathYear !== null) {
    return `${birthYear}–${deathYear}`;
  }
  if (birthYear !== null) return `b. ${birthYear}`;
  if (deathYear !== null) return `d. ${deathYear}`;
  return "";
}

/** PostgREST reads `,` `.` `(` `)` as filter-grammar punctuation inside an
 * `.or()`/`.and()` combinator — a name containing one ("Smith, Jr.", a
 * parenthetical nickname) would otherwise split the operand mid-value and
 * 400 the request. Wrapping the value in double quotes (escaping any literal
 * `"` first) is PostgREST's own documented escape hatch for exactly this. */
function quotePostgrestValue(value: string): string {
  return `"${value.replace(/"/g, '\\"')}"`;
}

/** `.or()` filter matching a name pattern across `given_name`, `surname`, and
 * `nickname` — the same three columns on both `person` and `person_name`
 * (SPEC #62: "Name search over `person` + `person_name`"), so one filter
 * string works against either table. */
export function nameIlikeFilter(pattern: string): string {
  const quoted = quotePostgrestValue(pattern);
  return `given_name.ilike.${quoted},surname.ilike.${quoted},nickname.ilike.${quoted}`;
}

/** One {@link nameIlikeFilter} per whitespace-separated word of `query`,
 * each a substring pattern. The caller chains them as separate `.or()`
 * calls; PostgREST ANDs repeated logical params, so every word must match
 * *some* name column while no single column has to hold the whole query.
 * That is what lets `"Gideon Qatestsson"` — the name every list row and
 * heading prints — find Gideon (#113): no column ever holds `given surname`
 * together. The AND is per *row*: a `person_name` variant that carries only
 * a nickname will not combine with the `person` row's surname. Empty /
 * whitespace-only query → `[]`. */
export function nameQueryFilters(query: string): readonly string[] {
  return query
    .split(/\s+/)
    .filter((word) => word !== "")
    .map((word) => nameIlikeFilter(`%${escapeLikePattern(word)}%`));
}

/** Apply every filter from {@link nameQueryFilters} to a query builder.
 * Typed over the builder's own `.or()` so the same helper serves `person`
 * and `person_name` (the columns are the same three on both). */
function applyNameFilters<B extends { or(filters: string): B }>(
  builder: B,
  filters: readonly string[],
): B {
  return filters.reduce((acc, filter) => acc.or(filter), builder);
}

interface PersonRow {
  readonly id: string;
  readonly given_name: string | null;
  readonly surname: string | null;
  readonly nickname: string | null;
  readonly sex: Sex | null;
}

function toSearchOption(row: PersonRow): PersonSearchOption {
  return { id: row.id, name: personSearchLabel(row), sex: row.sex };
}

/** `nullsFirst: false` ordering, done client-side for the merged
 * primary+variant set below — a null surname (a nickname-only person) sorts
 * after every real surname instead of before it (bare `??  ""` would put it
 * first), with `given_name` as the tie-break to match `listPersons`. */
function compareNullableStrings(a: string | null, b: string | null): number {
  if (a === b) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return a.localeCompare(b);
}

export function compareBySurnameThenGiven(
  a: { readonly surname: string | null; readonly given_name: string | null },
  b: { readonly surname: string | null; readonly given_name: string | null },
): number {
  const bySurname = compareNullableStrings(a.surname, b.surname);
  return bySurname !== 0
    ? bySurname
    : compareNullableStrings(a.given_name, b.given_name);
}

/**
 * Name search behind every `PersonPicker` (`/moderation`'s approve /
 * reassign, `/settings`' default root, issue #53, and the edit view's
 * Relationships section) plus the header search box and `/people` (#62).
 * Case-insensitive substring match, per word (`nameQueryFilters`), on given
 * name, surname, or nickname —
 * `personSearchLabel` falls back to nickname when neither name part is set,
 * so the search has to cover it too, or a nickname-only person (common for
 * an infant or an unidentified relative) would be unreachable through this
 * picker. Also matches a `person_name` variant (maiden name, AKA, etc.) —
 * that table carries the same three columns, so the same pattern is applied
 * to it and the matched `person_id`s are folded into the same result set.
 * Empty query → no round trip, no results. Each route wraps this in its own
 * access-gated call; RLS (`person_select` / `person_name_select`, both
 * `person_is_visible()`) is the real boundary, so a viewer's search never
 * surfaces a person they could not otherwise see.
 */
export async function searchPersons(
  client: Db,
  query: string,
  limit: number = PERSON_SEARCH_LIMIT,
): Promise<readonly PersonSearchOption[]> {
  const filters = nameQueryFilters(query);
  if (filters.length === 0) {
    return [];
  }

  const [primary, variants] = await Promise.all([
    applyNameFilters(
      client.from("person").select("id, given_name, surname, nickname, sex"),
      filters,
    )
      .order("surname", { ascending: true, nullsFirst: false })
      .limit(limit),
    // No `.limit()` here: several matching `person_name` rows can belong to
    // the same person (multiple AKAs), so capping before dedup could drop a
    // distinct person entirely. The final `.slice(0, limit)` below re-caps
    // the already-deduplicated set.
    applyNameFilters(client.from("person_name").select("person_id"), filters),
  ]);

  if (primary.error !== null) {
    throw new Error(`searchPersons: ${primary.error.message}`);
  }
  if (variants.error !== null) {
    throw new Error(`searchPersons: ${variants.error.message}`);
  }

  const primaryRows = primary.data ?? [];
  const knownIds = new Set(primaryRows.map((row) => row.id));
  const variantOnlyIds = [
    ...new Set(
      (variants.data ?? [])
        .map((row) => row.person_id)
        .filter((id) => !knownIds.has(id)),
    ),
  ];

  let variantRows: readonly PersonRow[] = [];
  if (variantOnlyIds.length > 0) {
    const { data, error } = await client
      .from("person")
      .select("id, given_name, surname, nickname, sex")
      .in("id", variantOnlyIds);
    if (error !== null) {
      throw new Error(`searchPersons: ${error.message}`);
    }
    variantRows = data ?? [];
  }

  return [...primaryRows, ...variantRows]
    .sort(compareBySurnameThenGiven)
    .slice(0, limit)
    .map(toSearchOption);
}

/** Compute the earliest recorded birth year and earliest recorded death year
 * per person from a flat set of `event` rows — pure so the tie-break logic
 * (`get_neighborhood`'s SQL uses `min()`; this mirrors it in TS since the
 * rows here come from one batched query, not a per-person subquery) is
 * unit-testable without a database. */
export function summarizeLifespans(
  personIds: readonly string[],
  events: readonly {
    person_id: string | null;
    type: string;
    date_year1: number | null;
  }[],
): ReadonlyMap<string, { birthYear: number | null; deathYear: number | null }> {
  const result = new Map<
    string,
    { birthYear: number | null; deathYear: number | null }
  >(personIds.map((id) => [id, { birthYear: null, deathYear: null }]));

  for (const event of events) {
    if (event.person_id === null || event.date_year1 === null) continue;
    const entry = result.get(event.person_id);
    if (entry === undefined) continue;
    if (event.type === "birth") {
      entry.birthYear =
        entry.birthYear === null
          ? event.date_year1
          : Math.min(entry.birthYear, event.date_year1);
    } else if (event.type === "death") {
      entry.deathYear =
        entry.deathYear === null
          ? event.date_year1
          : Math.min(entry.deathYear, event.date_year1);
    }
  }
  return result;
}

/** Batch lifespan lookup for a page of search/browse results — one query for
 * every id at once (never per-row), so a 20- or 50-result page costs exactly
 * two round trips total. */
export async function getPersonLifespans(
  client: Db,
  personIds: readonly string[],
): Promise<
  ReadonlyMap<string, { birthYear: number | null; deathYear: number | null }>
> {
  if (personIds.length === 0) {
    return new Map();
  }
  const { data, error } = await client
    .from("event")
    .select("person_id, type, date_year1")
    .in("person_id", personIds)
    .in("type", ["birth", "death"]);
  if (error !== null) {
    throw new Error(`getPersonLifespans: ${error.message}`);
  }
  return summarizeLifespans(personIds, data ?? []);
}

/** The header search box's result shape: `searchPersons` plus a lifespan for
 * each hit, capped at {@link HEADER_SEARCH_LIMIT} (SPEC #62: "Cap at 20, no
 * pagination"). */
export async function searchPersonsWithLifespan(
  client: Db,
  query: string,
  limit: number = HEADER_SEARCH_LIMIT,
): Promise<readonly PersonSearchResult[]> {
  const options = await searchPersons(client, query, limit);
  const lifespans = await getPersonLifespans(
    client,
    options.map((option) => option.id),
  );
  return options.map((option) => {
    const lifespan = lifespans.get(option.id) ?? {
      birthYear: null,
      deathYear: null,
    };
    return { ...option, ...lifespan };
  });
}

export interface PersonListPage {
  readonly rows: readonly PersonSearchResult[];
  readonly total: number;
}

/** Every `person.id` matching `pattern` on either `person` or `person_name`
 * — unlimited, unlike {@link searchPersons}'s capped autocomplete, since this
 * feeds a paginated count-and-slice below rather than a dropdown. `null`
 * means "no filter" (match everyone) rather than an empty array. Split out
 * of `listPersons` so the same query the header search runs is the one
 * `/people` filters by — the header's "See all results" link prefills this
 * exact box, and a person visible in the dropdown must not vanish from the
 * full list. */
async function resolveMatchingPersonIds(
  client: Db,
  query: string,
): Promise<readonly string[] | null> {
  const filters = nameQueryFilters(query);
  if (filters.length === 0) {
    return null;
  }

  const [primary, variants] = await Promise.all([
    applyNameFilters(client.from("person").select("id"), filters),
    applyNameFilters(client.from("person_name").select("person_id"), filters),
  ]);
  if (primary.error !== null) {
    throw new Error(`resolveMatchingPersonIds: ${primary.error.message}`);
  }
  if (variants.error !== null) {
    throw new Error(`resolveMatchingPersonIds: ${variants.error.message}`);
  }

  return [
    ...new Set([
      ...(primary.data ?? []).map((row) => row.id),
      ...(variants.data ?? []).map((row) => row.person_id),
    ]),
  ];
}

/**
 * `/people` — everyone, sorted by surname then given name, paginated at the
 * source (SPEC #62: 50 per page). `query` matches the same way the header
 * search box does (given name, surname, nickname, and `person_name`
 * variants) — the browse index's filter box is the same box, prefilled from
 * the header's "See all results" link.
 */
export async function listPersons(
  client: Db,
  options: {
    readonly query?: string;
    readonly page: number;
    readonly pageSize?: number;
  },
): Promise<PersonListPage> {
  const pageSize = options.pageSize ?? PEOPLE_PAGE_SIZE;
  const from = (options.page - 1) * pageSize;
  const to = from + pageSize - 1;

  const matchingIds = await resolveMatchingPersonIds(
    client,
    options.query ?? "",
  );
  if (matchingIds !== null && matchingIds.length === 0) {
    return { total: 0, rows: [] };
  }

  let queryBuilder = client
    .from("person")
    .select("id, given_name, surname, nickname, sex", { count: "exact" });
  if (matchingIds !== null) {
    queryBuilder = queryBuilder.in("id", matchingIds);
  }

  const { data, error, count } = await queryBuilder
    .order("surname", { ascending: true, nullsFirst: false })
    .order("given_name", { ascending: true, nullsFirst: false })
    .range(from, to);

  if (error !== null) {
    throw new Error(`listPersons: ${error.message}`);
  }

  const rows = data ?? [];
  const lifespans = await getPersonLifespans(
    client,
    rows.map((row) => row.id),
  );
  return {
    total: count ?? 0,
    rows: rows.map((row) => {
      const lifespan = lifespans.get(row.id) ?? {
        birthYear: null,
        deathYear: null,
      };
      return { ...toSearchOption(row), ...lifespan };
    }),
  };
}
