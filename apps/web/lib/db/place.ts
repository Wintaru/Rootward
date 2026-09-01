import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "./database.types";

type Db = SupabaseClient<Database>;

/**
 * Place lookup for the Events section's `place` field (SPEC §8.3, §4.2, §10
 * item 28). `place` carries no owner and is shared reference data — RLS
 * (`place_select`) lets any approved member read it, and writes go through
 * `place_write` (`is_moderator()`, SPEC §5), the same boundary as `event`.
 */

export interface PlaceOption {
  readonly id: string;
  readonly name: string;
}

const PLACE_SEARCH_LIMIT = 8;

/** Escape `LIKE`/`ILIKE` wildcards (`%`, `_`) so a name that happens to
 * contain one (rare, but not impossible) is matched literally instead of as
 * a pattern — not a SQL-injection concern (PostgREST parameterizes the
 * value), just search relevance. Shared with `searchPersonsForModeration`
 * (`moderation.ts`), the only other `ilike` search in the app. */
export function escapeLikePattern(value: string): string {
  return value.replace(/[%_\\]/g, "\\$&");
}

/** Autocomplete candidates for `query`, case-insensitive substring match on
 * the display name. Empty query → no round trip, no results. */
export async function searchPlaces(
  client: Db,
  query: string,
): Promise<readonly PlaceOption[]> {
  const trimmed = query.trim();
  if (trimmed === "") {
    return [];
  }

  const { data, error } = await client
    .from("place")
    .select("id, name")
    .ilike("name", `%${escapeLikePattern(trimmed)}%`)
    .order("name", { ascending: true })
    .limit(PLACE_SEARCH_LIMIT);

  if (error !== null) {
    throw new Error(`searchPlaces: ${error.message}`);
  }
  return data ?? [];
}

/**
 * Lowercase, collapse punctuation and runs of whitespace, trim (SPEC §4.2).
 *
 * A deliberate duplicate of `packages/gedcom`'s `normalizePlaceName` (the
 * `gedcom-import` edge function's dedupe key) rather than a new
 * `apps/web` → `@rootward/gedcom` dependency: that package ships no build
 * output in CI (WAYFINDER decision 8's pure-TS packages resolve from source
 * for typecheck/test), so importing it here would mean the same
 * tsconfig-`paths` + `next.config.ts` `transpilePackages` wiring `#25` added
 * for `@rootward/shared`, just for a four-line helper. `place-normalize.test.ts`
 * guards the two copies against drift instead. Keep both in step by hand.
 */
export function normalizePlaceName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[.,;]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Resolve `rawName` to a `place.id`, creating the row if no place with that
 * normalized name exists yet. `null` in, `null` out — an empty/blank name
 * means "no place", not a row to create.
 *
 * Not atomic: a concurrent create of the same normalized place between the
 * lookup and the insert is possible (two moderators editing different events
 * at the same place for the first time). The unique index on
 * `normalized_name` (`place_normalized_name_uidx`) turns that into a `23505`
 * on the losing insert; the catch re-selects and returns the winner's id, so
 * two rows for the same place never persist.
 */
export async function findOrCreatePlaceId(
  client: Db,
  rawName: string | null,
): Promise<string | null> {
  const trimmed = rawName?.trim() ?? "";
  if (trimmed === "") {
    return null;
  }
  const normalized = normalizePlaceName(trimmed);
  if (normalized === "") {
    return null;
  }

  const existing = await selectByNormalizedName(client, normalized);
  if (existing !== null) {
    return existing;
  }

  const { data, error } = await client
    .from("place")
    .insert({ name: trimmed, normalized_name: normalized })
    .select("id")
    .single();

  if (error !== null) {
    if (error.code === "23505") {
      const winner = await selectByNormalizedName(client, normalized);
      if (winner !== null) {
        return winner;
      }
    }
    throw new Error(`findOrCreatePlaceId: ${error.message}`);
  }
  return data.id;
}

async function selectByNormalizedName(
  client: Db,
  normalized: string,
): Promise<string | null> {
  const { data, error } = await client
    .from("place")
    .select("id")
    .eq("normalized_name", normalized)
    .maybeSingle();

  if (error !== null) {
    throw new Error(`findOrCreatePlaceId: ${error.message}`);
  }
  return data?.id ?? null;
}
