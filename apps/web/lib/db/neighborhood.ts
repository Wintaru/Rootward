import type { SupabaseClient } from "@supabase/supabase-js";

import { Constants, type Database } from "./database.types";
import type {
  ExpandRelation,
  Neighborhood,
  NeighborhoodFamily,
  NeighborhoodFragment,
  NeighborhoodPerson,
} from "./types";
import { isUuid } from "./uuid";

/**
 * Default generations shown each way, before `tree_settings` / session
 * overrides. Must match the `p_up` / `p_down` defaults on the `get_neighborhood`
 * function — the callers here always pass a value, so the SQL default is only a
 * fallback for a direct RPC call.
 */
export const DEFAULT_GENERATIONS_UP = 2;
export const DEFAULT_GENERATIONS_DOWN = 2;

/**
 * Upper bound on generations each way. Mirrors the `least(…, 10)` clamp in the
 * `get_neighborhood` SQL function (migration `20260830191012`) — the in-session
 * depth control (issue #23) caps at the same value so a request never asks for
 * more than the function will return.
 */
export const MAX_GENERATIONS = 10;

/**
 * The tree view's single fetch: the focus person, ancestors `up` generations,
 * descendants `down` generations, plus the focus person's siblings and partners,
 * with the family rows that link them (WAYFINDER decisions 9, 28).
 *
 * One round trip — the recursion runs in Postgres (`get_neighborhood`), and RLS
 * decides what the caller sees, so a hidden branch never reaches the client.
 *
 * An empty `persons` array means nothing was visible — the focus person does not
 * exist, or the caller may not see it. The caller decides whether that is a 404
 * or a 403.
 *
 * Pass the client from `lib/supabase` for the current context (browser client
 * for a Client Component, server client for a Server Component).
 */
export async function getNeighborhood(
  client: SupabaseClient<Database>,
  focusId: string,
  up: number = DEFAULT_GENERATIONS_UP,
  down: number = DEFAULT_GENERATIONS_DOWN,
): Promise<Neighborhood> {
  if (!isUuid(focusId)) {
    throw new Error(`getNeighborhood: focusId is not a UUID: ${focusId}`);
  }

  const { data, error } = await client.rpc("get_neighborhood", {
    p_focus: focusId,
    p_up: clampGenerations(up),
    p_down: clampGenerations(down),
  });

  if (error) {
    throw new Error(`getNeighborhood(${focusId}): ${error.message}`);
  }

  return parseNeighborhood(data);
}

/**
 * Whole number of generations in `0..MAX_GENERATIONS` — the same bound the
 * `get_neighborhood` SQL function enforces. The single clamp for the fetch
 * depth, the `tree_settings` defaults, and the in-session override.
 */
export function clampGenerations(value: number): number {
  return Math.min(MAX_GENERATIONS, Math.max(0, Math.trunc(value)));
}

/**
 * The tree view's expand-in-place fetch (issue #24) — one branch, one level,
 * never a re-run of the whole `getNeighborhood` recursion. `relation`:
 *
 * - `"parents"` — the family `personId` is a child in, plus its partners.
 * - `"children"` — every family `personId` partners in, plus their children.
 * - `"self"` — just `personId`, no relations. Resolves a partner id a family
 *   in the current view already names but the fetched window did not include
 *   (a descendant's spouse, say — see `Neighborhood["families"]`'s doc).
 *
 * RLS decides what comes back, same as `getNeighborhood`. Merge the result
 * into the current `Neighborhood` with `mergeNeighborhoodFragment`
 * (`lib/tree/expand-tree.ts`), which also fixes up `generation` — this
 * function's persons carry only a `0` placeholder for it.
 */
export async function expandRelatives(
  client: SupabaseClient<Database>,
  personId: string,
  relation: ExpandRelation,
): Promise<NeighborhoodFragment> {
  if (!isUuid(personId)) {
    throw new Error(`expandRelatives: personId is not a UUID: ${personId}`);
  }

  const { data, error } = await client.rpc("expand_relatives", {
    p_person: personId,
    p_relation: relation,
  });

  if (error) {
    throw new Error(
      `expandRelatives(${personId}, ${relation}): ${error.message}`,
    );
  }

  return parseNeighborhoodFragment(data);
}

// --- boundary validation ---------------------------------------------------
// `get_neighborhood` returns `jsonb`, typed only as `Json`. Parse it once here
// so the rest of the app works with a real `Neighborhood`.

function parseNeighborhood(raw: unknown): Neighborhood {
  const root = asObject(raw, "payload");
  return {
    focus_id: asString(root.focus_id, "focus_id"),
    persons: asArray(root.persons, "persons").map((p, i) => parsePerson(p, i)),
    families: asArray(root.families, "families").map(parseFamily),
  };
}

function parseNeighborhoodFragment(raw: unknown): NeighborhoodFragment {
  const root = asObject(raw, "payload");
  return {
    persons: asArray(root.persons, "persons").map((p, i) =>
      parsePerson(p, i, 0),
    ),
    families: asArray(root.families, "families").map(parseFamily),
  };
}

function parsePerson(
  raw: unknown,
  index: number,
  generation: number | null = null,
): NeighborhoodPerson {
  const p = asObject(raw, `persons[${index}]`);
  return {
    id: asString(p.id, `persons[${index}].id`),
    given_name: asNullableString(p.given_name),
    surname: asNullableString(p.surname),
    name_prefix: asNullableString(p.name_prefix),
    name_suffix: asNullableString(p.name_suffix),
    nickname: asNullableString(p.nickname),
    sex: asNullableEnum(p.sex, Constants.public.Enums.sex),
    is_living: asNullableBoolean(p.is_living),
    generation:
      generation ?? asNumber(p.generation, `persons[${index}].generation`),
    birth_year: asNullableNumber(p.birth_year),
    death_year: asNullableNumber(p.death_year),
    can_expand_up: asBoolean(
      p.can_expand_up,
      `persons[${index}].can_expand_up`,
    ),
    can_expand_down: asBoolean(
      p.can_expand_down,
      `persons[${index}].can_expand_down`,
    ),
  };
}

function parseFamily(raw: unknown, index: number): NeighborhoodFamily {
  const f = asObject(raw, `families[${index}]`);
  return {
    id: asString(f.id, `families[${index}].id`),
    partner1_id: asNullableString(f.partner1_id),
    partner2_id: asNullableString(f.partner2_id),
    partner1_role: asNullableEnum(
      f.partner1_role,
      Constants.public.Enums.partner_role,
    ),
    partner2_role: asNullableEnum(
      f.partner2_role,
      Constants.public.Enums.partner_role,
    ),
    relationship_type: asNullableEnum(
      f.relationship_type,
      Constants.public.Enums.union_type,
    ),
    child_ids: asArray(f.child_ids, `families[${index}].child_ids`).map(
      (id, i) => asString(id, `families[${index}].child_ids[${i}]`),
    ),
  };
}

function asObject(v: unknown, where: string): Record<string, unknown> {
  if (typeof v !== "object" || v === null || Array.isArray(v)) {
    throw new Error(`get_neighborhood: expected an object at ${where}`);
  }
  return v as Record<string, unknown>;
}

function asArray(v: unknown, where: string): unknown[] {
  if (!Array.isArray(v)) {
    throw new Error(`get_neighborhood: expected an array at ${where}`);
  }
  return v;
}

function asString(v: unknown, where: string): string {
  if (typeof v !== "string") {
    throw new Error(`get_neighborhood: expected a string at ${where}`);
  }
  return v;
}

function asNumber(v: unknown, where: string): number {
  if (typeof v !== "number") {
    throw new Error(`get_neighborhood: expected a number at ${where}`);
  }
  return v;
}

function asNullableString(v: unknown): string | null {
  return v == null ? null : asString(v, "nullable string");
}

function asNullableNumber(v: unknown): number | null {
  return v == null ? null : asNumber(v, "nullable number");
}

function asBoolean(v: unknown, where: string): boolean {
  if (typeof v !== "boolean") {
    throw new Error(`get_neighborhood: expected a boolean at ${where}`);
  }
  return v;
}

function asNullableBoolean(v: unknown): boolean | null {
  if (v == null) return null;
  if (typeof v !== "boolean") {
    throw new Error("get_neighborhood: expected a boolean");
  }
  return v;
}

function asNullableEnum<T extends string>(
  v: unknown,
  allowed: readonly T[],
): T | null {
  if (v == null) return null;
  const s = asString(v, "enum");
  const match = allowed.find((label) => label === s);
  if (match === undefined) {
    throw new Error(`get_neighborhood: unexpected enum value ${s}`);
  }
  return match;
}
