import type { SupabaseClient } from "@supabase/supabase-js";

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

/** The whitespace-separated words of a query — the `p_words` argument of the
 * `search_persons` RPC (migration 20260920090000), which owns the matching
 * rule and the wildcard escaping. Empty / whitespace-only query → `[]`,
 * which callers treat as "no round trip" (autocomplete) or "no filter" (the
 * `/people` browse). */
export function nameQueryWords(query: string): readonly string[] {
  return query.split(/\s+/).filter((word) => word !== "");
}

const PERSON_SEARCH_COLUMNS = "id, given_name, surname, nickname, sex";

/** PostgREST's "Requested range not satisfiable": the `offset` is past the
 * row count. Answered with HTTP 416, which postgrest-js turns into an error
 * and drops the `Content-Range` total with it. */
const PGRST_RANGE_NOT_SATISFIABLE = "PGRST103";

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

/**
 * Name search behind every `PersonPicker` (`/moderation`'s approve /
 * reassign, `/settings`' default root, issue #53, and the edit view's
 * Relationships section) plus the header search box and `/people` (#62).
 * Case-insensitive substring match, per word (`nameQueryWords`), on given
 * name, surname, or nickname — `personSearchLabel` falls back to nickname
 * when neither name part is set, so the search has to cover it too, or a
 * nickname-only person (common for an infant or an unidentified relative)
 * would be unreachable through this picker. Also matches a `person_name`
 * variant (maiden name, AKA, etc.). All of that is the `search_persons`
 * RPC's job — one round trip, ordered and capped at the source, no id list
 * riding back and forth in the request URI (#111). Empty query → no round
 * trip, no results. Each route wraps this in its own access-gated call; RLS
 * (`person_select` / `person_name_select`, both `person_is_visible()`) is
 * the real boundary — the function is SECURITY INVOKER — so a viewer's
 * search never surfaces a person they could not otherwise see.
 */
export async function searchPersons(
  client: Db,
  query: string,
  limit: number = PERSON_SEARCH_LIMIT,
): Promise<readonly PersonSearchOption[]> {
  const words = nameQueryWords(query);
  if (words.length === 0) {
    return [];
  }

  const { data, error } = await client
    .rpc("search_persons", { p_words: [...words] })
    .select(PERSON_SEARCH_COLUMNS)
    .order("surname", { ascending: true, nullsFirst: false })
    .order("given_name", { ascending: true, nullsFirst: false })
    .limit(limit);
  if (error !== null) {
    throw new Error(`searchPersons: ${error.message}`);
  }
  return (data ?? []).map(toSearchOption);
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

/** How many people match `query` — the same `search_persons` call as the
 * page itself with zero rows asked for, so the count comes back in
 * `Content-Range` and nothing else does. Deliberately not `head: true`:
 * a HEAD rpc puts the arguments in the URL as a bare Postgres array literal,
 * so a word with a comma or a quote (`Smith,`) is a `22P02` malformed
 * literal and `null` becomes SQL NULL — the POST body stays JSON, the same
 * shape the page request sends. */
async function countPersons(client: Db, query: string): Promise<number> {
  const { error, count } = await client
    .rpc(
      "search_persons",
      { p_words: [...nameQueryWords(query)] },
      { count: "exact" },
    )
    .select("id")
    .limit(0);
  if (error !== null) {
    throw new Error(`countPersons: ${error.message}`);
  }
  return count ?? 0;
}

/**
 * `/people` — everyone, sorted by surname then given name, paginated at the
 * source (SPEC #62: 50 per page). `query` matches the same way the header
 * search box does (given name, surname, nickname, and `person_name`
 * variants). A `page` past the end is not an error: the result carries the
 * true `total` with no rows, and the route redirects to the last real page.
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

  // The same `search_persons` call the header box makes — the header's "See
  // all results" link prefills this exact box, and a person visible in the
  // dropdown must not vanish from the full list. An empty word list is the
  // unfiltered browse: the function then matches everyone. PostgREST pages
  // and counts a set-returning function's rows like a table's, so the match
  // and the page are one round trip (#111).
  const { data, error, count } = await client
    .rpc(
      "search_persons",
      { p_words: [...nameQueryWords(options.query ?? "")] },
      { count: "exact" },
    )
    .select(PERSON_SEARCH_COLUMNS)
    .order("surname", { ascending: true, nullsFirst: false })
    .order("given_name", { ascending: true, nullsFirst: false })
    .range(from, to);

  if (error !== null) {
    if (error.code !== PGRST_RANGE_NOT_SATISFIABLE) {
      throw new Error(`listPersons: ${error.message}`);
    }
    // A page past the end — a stale link after the query narrowed, or a
    // hand-edited URL (#114). Not a failure: report the true total with no
    // rows, so the route's redirect to the last real page gets its turn. The
    // extra count-only round trip is paid only on this path.
    return { total: await countPersons(client, options.query ?? ""), rows: [] };
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
