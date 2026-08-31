import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "./database.types";
import { findOrCreatePlaceId } from "./place";
import type { EventType } from "./types";
import type { GenealogyDateColumns } from "./genealogy-date";

type Db = SupabaseClient<Database>;

/**
 * The write side of the edit view's Events section (SPEC §8.3, §4.2, §10 item
 * 28). Reads run under the caller's identity (RLS `event_select`); writes go
 * through `event_write` (`is_moderator()`) — the server action re-checks
 * before calling in, but RLS is the real boundary, same posture as
 * `person-edit.ts`.
 *
 * Only person-owned events (`owner_type = 'person'`) are in scope — a
 * family's union events (marriage, divorce) are not edited from a person's
 * edit view (SPEC §8.3 lists no such affordance; the read-only profile made
 * the same call for its timeline, see `person.ts`'s doc comment).
 *
 * Every write is version-checked the same way as #27's `person`/`person_name`
 * writes (WAYFINDER decision 26): `UPDATE/DELETE … WHERE id = $1 AND
 * updated_at = $2`, zero rows back → that row's `{ ok: false }`. `sort_key` is
 * never sent — it is a trigger-populated plain column (`date_sort_key` plus a
 * per-`type` ordinal, `supabase/migrations/20260830164537_events_facts_places.sql`),
 * so a save's returned row already carries its new position; the caller
 * re-sorts by it (`reconcileEventsAfterSave` in `lib/edit/events.ts`).
 */

const EVENT_EDIT_COLUMNS =
  "id, type, type_other, value, age_text, sort_key, place_id, date_value_raw, date_kind, date_year1, date_month1, date_day1, date_year2, date_month2, date_day2, date_calendar, date_dual_year, date_phrase, updated_at, place:place_id(name)";

type EventEditDbRow = {
  id: string;
  type: EventType;
  type_other: string | null;
  value: string | null;
  age_text: string | null;
  sort_key: string | null;
  place_id: string | null;
  updated_at: string;
  place: { name: string } | null;
} & GenealogyDateColumns;

export interface EventEditRow {
  readonly id: string;
  readonly updatedAt: string;
  readonly type: EventType;
  readonly typeOther: string | null;
  readonly value: string | null;
  readonly ageText: string | null;
  readonly sortKey: string | null;
  readonly placeName: string | null;
  /** `date_value_raw` — always round-trips (SPEC §4.1), so this is exactly
   * what a `DateInput` shows on load. */
  readonly dateRaw: string;
}

function mapEventEditRow(row: EventEditDbRow): EventEditRow {
  return {
    id: row.id,
    updatedAt: row.updated_at,
    type: row.type,
    typeOther: row.type_other,
    value: row.value,
    ageText: row.age_text,
    sortKey: row.sort_key,
    placeName: row.place?.name ?? null,
    dateRaw: row.date_value_raw ?? "",
  };
}

/** Every person-owned `event` row for `personId`, ordered by `sort_key`
 * (undated events last, matching `getPersonProfile`'s timeline order). */
export async function getPersonEvents(
  client: Db,
  personId: string,
): Promise<readonly EventEditRow[]> {
  const { data, error } = await client
    .from("event")
    .select(EVENT_EDIT_COLUMNS)
    .eq("owner_type", "person")
    .eq("person_id", personId)
    .order("sort_key", { ascending: true, nullsFirst: false })
    .order("id", { ascending: true });

  if (error !== null) {
    throw new Error(`getPersonEvents: ${error.message}`);
  }
  return (data ?? []).map(mapEventEditRow);
}

/** The fields one event row's insert/update patch may carry. `date` is always
 * the full column set together (it is derived from one raw string —
 * `dateColumnsFromRaw` in `lib/edit/events.ts` — so there is no per-column
 * diff to express). `placeName` is the raw text the user typed; resolving it
 * to a `place_id` (find-or-create) happens here, not in the pure diff, since
 * it needs a round trip. */
export interface EventFieldValues {
  readonly type: EventType;
  readonly typeOther: string | null;
  readonly value: string | null;
  readonly ageText: string | null;
  readonly date: GenealogyDateColumns;
  readonly placeName: string | null;
}

export interface EventInsertInput extends EventFieldValues {
  /** Client-generated (the section assigns a row's id at "Add" time), same
   * reason as `person-edit.ts`'s `PersonNameInsertInput`. */
  readonly id: string;
}

export interface EventUpdateInput {
  readonly id: string;
  readonly expectedUpdatedAt: string;
  readonly patch: Partial<EventFieldValues>;
}

export interface EventDeleteInput {
  readonly id: string;
  readonly expectedUpdatedAt: string;
}

export interface SaveEventsResult {
  readonly inserted: readonly EventEditRow[];
  readonly updated: readonly EventEditRow[];
  readonly deletedIds: readonly string[];
  /** Ids whose update or delete lost the version check — the row changed
   * elsewhere since this section loaded it. */
  readonly conflictIds: readonly string[];
}

type EventInsertRow = Database["public"]["Tables"]["event"]["Insert"];
type EventUpdateRow = Database["public"]["Tables"]["event"]["Update"];

async function buildEventInsertRow(
  client: Db,
  personId: string,
  input: EventInsertInput,
): Promise<EventInsertRow> {
  const placeId = await findOrCreatePlaceId(client, input.placeName);
  return {
    id: input.id,
    owner_type: "person",
    person_id: personId,
    family_id: null,
    type: input.type,
    type_other: input.typeOther,
    value: input.value,
    age_text: input.ageText,
    place_id: placeId,
    ...input.date,
  };
}

async function buildEventPatchRow(
  client: Db,
  patch: Partial<EventFieldValues>,
): Promise<EventUpdateRow> {
  const row: EventUpdateRow = {};
  if (patch.type !== undefined) {
    row.type = patch.type;
  }
  if (patch.typeOther !== undefined) {
    row.type_other = patch.typeOther;
  }
  if (patch.value !== undefined) {
    row.value = patch.value;
  }
  if (patch.ageText !== undefined) {
    row.age_text = patch.ageText;
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
 * Apply the Events diff for one person: insert new rows, apply each
 * version-checked update, apply each version-checked delete. Same shape as
 * `saveAdditionalNames` — one bulk insert (no concurrency question, the rows
 * do not exist yet), one round trip per update/delete (decision 26 — a
 * mismatch rejects only that row) — and not transactional across the three
 * legs for the same reason documented there. Place resolution
 * (`findOrCreatePlaceId`) runs per row alongside the writes; its own
 * `23505` retry keeps two rows saving the same new place from creating two
 * `place` rows.
 */
export async function saveEvents(
  client: Db,
  args: {
    readonly personId: string;
    readonly inserts: readonly EventInsertInput[];
    readonly updates: readonly EventUpdateInput[];
    readonly deletes: readonly EventDeleteInput[];
  },
): Promise<SaveEventsResult> {
  const [inserted, updateResults, deleteResults] = await Promise.all([
    insertEvents(client, args.personId, args.inserts),
    Promise.all(args.updates.map((input) => applyEventUpdate(client, input))),
    Promise.all(args.deletes.map((input) => applyEventDelete(client, input))),
  ]);

  const updated: EventEditRow[] = [];
  const conflictIds: string[] = [];
  for (const result of updateResults) {
    if (result.ok) {
      updated.push(result.row);
    } else {
      conflictIds.push(result.id);
    }
  }

  const deletedIds: string[] = [];
  for (const result of deleteResults) {
    if (result.ok) {
      deletedIds.push(result.id);
    } else {
      conflictIds.push(result.id);
    }
  }

  return { inserted, updated, deletedIds, conflictIds };
}

async function insertEvents(
  client: Db,
  personId: string,
  inserts: readonly EventInsertInput[],
): Promise<readonly EventEditRow[]> {
  if (inserts.length === 0) {
    return [];
  }
  const rows = await Promise.all(
    inserts.map((input) => buildEventInsertRow(client, personId, input)),
  );

  const { data, error } = await client
    .from("event")
    .insert(rows)
    .select(EVENT_EDIT_COLUMNS);

  if (error !== null) {
    throw new Error(`saveEvents: insert: ${error.message}`);
  }
  return (data ?? []).map(mapEventEditRow);
}

type RowResult =
  | { readonly ok: true; readonly id: string; readonly row: EventEditRow }
  | { readonly ok: false; readonly id: string };

async function applyEventUpdate(
  client: Db,
  input: EventUpdateInput,
): Promise<RowResult> {
  const patchRow = await buildEventPatchRow(client, input.patch);
  const { data, error } = await client
    .from("event")
    .update(patchRow)
    .eq("id", input.id)
    .eq("updated_at", input.expectedUpdatedAt)
    .select(EVENT_EDIT_COLUMNS)
    .maybeSingle();

  if (error !== null) {
    throw new Error(`saveEvents: update ${input.id}: ${error.message}`);
  }
  return data === null
    ? { ok: false, id: input.id }
    : { ok: true, id: input.id, row: mapEventEditRow(data) };
}

async function applyEventDelete(
  client: Db,
  input: EventDeleteInput,
): Promise<{ readonly ok: boolean; readonly id: string }> {
  const { data, error } = await client
    .from("event")
    .delete()
    .eq("id", input.id)
    .eq("updated_at", input.expectedUpdatedAt)
    .select("id")
    .maybeSingle();

  if (error !== null) {
    throw new Error(`saveEvents: delete ${input.id}: ${error.message}`);
  }
  return { ok: data !== null, id: input.id };
}
