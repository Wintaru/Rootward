import type { SupabaseClient } from "@supabase/supabase-js";

import { getAccountDisplayName } from "./account-lookup";
import type { RowConflict } from "./conflict";
import type { Database } from "./database.types";
import { findOrCreatePlaceId } from "./place";
import type { FactType, FactVisibility } from "./types";
import type { GenealogyDateColumns } from "./genealogy-date";

type Db = SupabaseClient<Database>;

/**
 * The write side of the edit view's Facts section (SPEC §8.3, §4.2, §10 item
 * 29). Structurally the same as `event-edit.ts` — same version-checked
 * insert/update/delete shape (WAYFINDER decision 26), same
 * find-or-create place resolution — with the differences `fact`'s own
 * columns force:
 *
 * - No `age_text` / `sort_key` on `fact` — nothing to send, nothing to
 *   re-sort by after a save. `getPersonFacts` orders by `id`, matching
 *   `getPersonProfile`'s read-only fact query (`person.ts`).
 * - `visibility` is a writable enum column here (`fact_write` RLS,
 *   `is_moderator()`); the MVP UI (`lib/edit/facts.ts`) only ever sends
 *   `everyone_approved` or `hidden` (issue #29 scope — same restriction
 *   decisions 7/31 apply to `person.visibility`).
 * - `is_sensitive` is a generated column (`type in ('ssn', 'national_id',
 *   'medical')`, SPEC §4.2) — never sent on insert/update. The UI derives the
 *   same value client-side from `type` alone (`factIsSensitive` in
 *   `lib/edit/facts.ts`) so it reflects instantly, without waiting on a
 *   round trip; the row this module returns after a save still carries the
 *   server's own `is_sensitive` for display, in case the two ever disagree.
 */

const FACT_EDIT_COLUMNS =
  "id, type, type_other, value, visibility, is_sensitive, place_id, date_value_raw, date_kind, date_year1, date_month1, date_day1, date_year2, date_month2, date_day2, date_calendar, date_dual_year, date_phrase, updated_at, place:place_id(name)";

type FactEditDbRow = {
  id: string;
  type: FactType;
  type_other: string | null;
  value: string | null;
  visibility: FactVisibility;
  is_sensitive: boolean | null;
  place_id: string | null;
  updated_at: string;
  place: { name: string } | null;
} & GenealogyDateColumns;

export interface FactEditRow {
  readonly id: string;
  readonly updatedAt: string;
  readonly type: FactType;
  readonly typeOther: string | null;
  readonly value: string | null;
  readonly visibility: FactVisibility;
  readonly isSensitive: boolean;
  readonly placeName: string | null;
  /** `date_value_raw` — always round-trips (SPEC §4.1), so this is exactly
   * what a `DateInput` shows on load. */
  readonly dateRaw: string;
}

function mapFactEditRow(row: FactEditDbRow): FactEditRow {
  return {
    id: row.id,
    updatedAt: row.updated_at,
    type: row.type,
    typeOther: row.type_other,
    value: row.value,
    visibility: row.visibility,
    isSensitive: row.is_sensitive ?? false,
    placeName: row.place?.name ?? null,
    dateRaw: row.date_value_raw ?? "",
  };
}

/** Every person-owned `fact` row for `personId`, ordered by `id` — matches
 * `getPersonProfile`'s read-only fact query order (`person.ts`); `fact` has
 * no `sort_key` equivalent to order by instead. */
export async function getPersonFacts(
  client: Db,
  personId: string,
): Promise<readonly FactEditRow[]> {
  const { data, error } = await client
    .from("fact")
    .select(FACT_EDIT_COLUMNS)
    .eq("owner_type", "person")
    .eq("person_id", personId)
    .order("id", { ascending: true });

  if (error !== null) {
    throw new Error(`getPersonFacts: ${error.message}`);
  }
  return (data ?? []).map(mapFactEditRow);
}

/** The fields one fact row's insert/update patch may carry. `is_sensitive` is
 * deliberately absent — generated, never writable (see the module doc). */
export interface FactFieldValues {
  readonly type: FactType;
  readonly typeOther: string | null;
  readonly value: string | null;
  readonly visibility: FactVisibility;
  readonly date: GenealogyDateColumns;
  readonly placeName: string | null;
}

export interface FactInsertInput extends FactFieldValues {
  /** Client-generated (the section assigns a row's id at "Add" time), same
   * reason as `event-edit.ts`'s `EventInsertInput`. */
  readonly id: string;
}

export interface FactUpdateInput {
  readonly id: string;
  readonly expectedUpdatedAt: string;
  readonly patch: Partial<FactFieldValues>;
}

export interface FactDeleteInput {
  readonly id: string;
  readonly expectedUpdatedAt: string;
}

export interface SaveFactsResult {
  readonly inserted: readonly FactEditRow[];
  readonly updated: readonly FactEditRow[];
  readonly deletedIds: readonly string[];
  /** Rows whose update or delete lost the version check — the row changed
   * elsewhere since this section loaded it. */
  readonly conflicts: readonly RowConflict<FactEditRow>[];
}

type FactInsertRow = Database["public"]["Tables"]["fact"]["Insert"];
type FactUpdateRow = Database["public"]["Tables"]["fact"]["Update"];

async function buildFactInsertRow(
  client: Db,
  personId: string,
  input: FactInsertInput,
): Promise<FactInsertRow> {
  const placeId = await findOrCreatePlaceId(client, input.placeName);
  return {
    id: input.id,
    owner_type: "person",
    person_id: personId,
    family_id: null,
    type: input.type,
    type_other: input.typeOther,
    value: input.value,
    visibility: input.visibility,
    place_id: placeId,
    ...input.date,
  };
}

async function buildFactPatchRow(
  client: Db,
  patch: Partial<FactFieldValues>,
): Promise<FactUpdateRow> {
  const row: FactUpdateRow = {};
  if (patch.type !== undefined) {
    row.type = patch.type;
  }
  if (patch.typeOther !== undefined) {
    row.type_other = patch.typeOther;
  }
  if (patch.value !== undefined) {
    row.value = patch.value;
  }
  if (patch.visibility !== undefined) {
    row.visibility = patch.visibility;
  }
  if (patch.date !== undefined) {
    Object.assign(row, patch.date);
  }
  if (patch.placeName !== undefined) {
    row.place_id = await findOrCreatePlaceId(client, patch.placeName);
  }
  return row;
}

/**
 * Apply the Facts diff for one person: insert new rows, apply each
 * version-checked update, apply each version-checked delete. Same shape as
 * `saveEvents` — one bulk insert, one round trip per update/delete (decision
 * 26 — a mismatch rejects only that row), not transactional across the three
 * legs for the same reason documented there.
 */
export async function saveFacts(
  client: Db,
  args: {
    readonly personId: string;
    readonly inserts: readonly FactInsertInput[];
    readonly updates: readonly FactUpdateInput[];
    readonly deletes: readonly FactDeleteInput[];
  },
): Promise<SaveFactsResult> {
  const [inserted, updateResults, deleteResults] = await Promise.all([
    insertFacts(client, args.personId, args.inserts),
    Promise.all(args.updates.map((input) => applyFactUpdate(client, input))),
    Promise.all(args.deletes.map((input) => applyFactDelete(client, input))),
  ]);

  const updated: FactEditRow[] = [];
  const conflicts: RowConflict<FactEditRow>[] = [];
  for (const result of updateResults) {
    if (result.ok) {
      updated.push(result.row);
    } else {
      conflicts.push(result.conflict);
    }
  }

  const deletedIds: string[] = [];
  for (const result of deleteResults) {
    if (result.ok) {
      deletedIds.push(result.id);
    } else {
      conflicts.push(result.conflict);
    }
  }

  return { inserted, updated, deletedIds, conflicts };
}

async function insertFacts(
  client: Db,
  personId: string,
  inserts: readonly FactInsertInput[],
): Promise<readonly FactEditRow[]> {
  if (inserts.length === 0) {
    return [];
  }
  const rows = await Promise.all(
    inserts.map((input) => buildFactInsertRow(client, personId, input)),
  );

  const { data, error } = await client
    .from("fact")
    .insert(rows)
    .select(FACT_EDIT_COLUMNS);

  if (error !== null) {
    throw new Error(`saveFacts: insert: ${error.message}`);
  }
  return (data ?? []).map(mapFactEditRow);
}

/** Refetch a `fact` row's current state (ignoring `updated_at`) for the
 * `ConflictDialog` — `null` if the row is gone. `fact.updated_by` resolves to
 * a display name via `getAccountDisplayName`. */
async function resolveFactConflict(
  client: Db,
  id: string,
): Promise<RowConflict<FactEditRow>> {
  const { data, error } = await client
    .from("fact")
    .select(`${FACT_EDIT_COLUMNS}, updated_by`)
    .eq("id", id)
    .maybeSingle();

  if (error !== null) {
    throw new Error(`resolveFactConflict: ${id}: ${error.message}`);
  }
  if (data === null) {
    return { id, theirs: null, changedBy: null };
  }
  const changedBy = await getAccountDisplayName(client, data.updated_by);
  return { id, theirs: mapFactEditRow(data), changedBy };
}

type RowResult =
  | { readonly ok: true; readonly id: string; readonly row: FactEditRow }
  | { readonly ok: false; readonly conflict: RowConflict<FactEditRow> };

async function applyFactUpdate(
  client: Db,
  input: FactUpdateInput,
): Promise<RowResult> {
  const patchRow = await buildFactPatchRow(client, input.patch);
  const { data, error } = await client
    .from("fact")
    .update(patchRow)
    .eq("id", input.id)
    .eq("updated_at", input.expectedUpdatedAt)
    .select(FACT_EDIT_COLUMNS)
    .maybeSingle();

  if (error !== null) {
    throw new Error(`saveFacts: update ${input.id}: ${error.message}`);
  }
  if (data !== null) {
    return { ok: true, id: input.id, row: mapFactEditRow(data) };
  }
  return { ok: false, conflict: await resolveFactConflict(client, input.id) };
}

async function applyFactDelete(
  client: Db,
  input: FactDeleteInput,
): Promise<
  | { readonly ok: true; readonly id: string }
  | { readonly ok: false; readonly conflict: RowConflict<FactEditRow> }
> {
  const { data, error } = await client
    .from("fact")
    .delete()
    .eq("id", input.id)
    .eq("updated_at", input.expectedUpdatedAt)
    .select("id")
    .maybeSingle();

  if (error !== null) {
    throw new Error(`saveFacts: delete ${input.id}: ${error.message}`);
  }
  if (data !== null) {
    return { ok: true, id: input.id };
  }
  return { ok: false, conflict: await resolveFactConflict(client, input.id) };
}
