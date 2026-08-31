import type { SupabaseClient } from "@supabase/supabase-js";

import type { RowConflict } from "./conflict";
import type { Database } from "./database.types";
import type { EventType, NoteOwner } from "./types";

type Db = SupabaseClient<Database>;

/**
 * The write side of the edit view's Notes section (SPEC §8.3, §4.5, §10 item
 * 31). Scoped to notes on the person itself and on the person's own events —
 * WAYFINDER decision 21's exact MVP wording ("Notes (on person and on
 * events)"); the issue body's broader "facts / families" phrasing is thinner
 * than the settled decision, and WAYFINDER wins on conflict (`CLAUDE.md`) —
 * see `DECISIONS.md`. Reads run under the caller's identity (RLS
 * `note_select`); writes go through `note_write` (`is_moderator()`).
 *
 * Same version-checked shape as every other section (WAYFINDER decision 26):
 * `UPDATE/DELETE … WHERE id = $1 AND updated_at = $2`, zero rows back → the
 * caller refetches the current row (`resolveNoteConflict`) for the
 * `ConflictDialog`. `note` carries no `updated_by` column (issue #7 only
 * added one to `person` / `event` / `fact`), so a note conflict's
 * `changedBy` is always `null`.
 */

const NOTE_EDIT_COLUMNS =
  "id, owner_type, owner_id, text, sort_order, updated_at";

type NoteEditDbRow = {
  id: string;
  owner_type: NoteOwner;
  owner_id: string;
  text: string;
  sort_order: number | null;
  updated_at: string;
};

/** `note_owner` has 8 values (SPEC §4.5) — GEDCOM shared notes can attach to
 * a source, citation, or media row too — but this section's two queries
 * below only ever fetch `owner_type in ('person', 'event')`. Narrowing to
 * that pair here (rather than carrying the full `NoteOwner` through the
 * section) makes the other 6 values unrepresentable in this module, so an
 * exhaustive switch over it (`conflictTitle` in `lib/edit/notes.ts`) is
 * actually exhaustive instead of needing a silent fallback branch. */
export type SectionNoteOwner = Extract<NoteOwner, "person" | "event">;

export interface NoteEditRow {
  readonly id: string;
  readonly updatedAt: string;
  readonly ownerType: SectionNoteOwner;
  readonly ownerId: string;
  readonly text: string;
  readonly sortOrder: number | null;
}

function mapNoteEditRow(row: NoteEditDbRow): NoteEditRow {
  return {
    id: row.id,
    updatedAt: row.updated_at,
    // Safe by construction: `getPersonNotes` only ever queries `owner_type
    // in ('person', 'event')` (see its own doc comment), so every row this
    // module maps is already one of the two `SectionNoteOwner` values.
    ownerType: row.owner_type as SectionNoteOwner,
    ownerId: row.owner_id,
    text: row.text,
    sortOrder: row.sort_order,
  };
}

/** One of the person's own events — just enough to label and offer it as a
 * note's owner ("About this person" vs "About their Birth", …). */
export interface NoteEventOption {
  readonly id: string;
  readonly type: EventType;
  readonly typeOther: string | null;
}

export interface PersonNotesData {
  readonly notes: readonly NoteEditRow[];
  readonly events: readonly NoteEventOption[];
}

/**
 * Load every note owned directly by `personId`, plus every note owned by one
 * of `personId`'s own events, plus the lightweight event list needed to
 * group/label the latter and to offer as a new note's owner. `owner_type`
 * differs between the two note queries, so one `.in()` cannot express both —
 * this runs as two parallel note queries alongside the event list, the same
 * fan-out shape as `getPersonProfile`. The event-owned note query depends on
 * the event list's ids, so only the person-owned note query and the event
 * list itself run together; the event-owned note query follows.
 */
export async function getPersonNotes(
  client: Db,
  personId: string,
): Promise<PersonNotesData> {
  const [eventsRes, personNotesRes] = await Promise.all([
    client
      .from("event")
      .select("id, type, type_other")
      .eq("owner_type", "person")
      .eq("person_id", personId)
      .order("sort_key", { ascending: true, nullsFirst: false })
      .order("id", { ascending: true }),
    client
      .from("note")
      .select(NOTE_EDIT_COLUMNS)
      .eq("owner_type", "person")
      .eq("owner_id", personId)
      .order("sort_order", { ascending: true, nullsFirst: false })
      .order("created_at", { ascending: true }),
  ]);

  if (eventsRes.error !== null) {
    throw new Error(`getPersonNotes: event: ${eventsRes.error.message}`);
  }
  if (personNotesRes.error !== null) {
    throw new Error(
      `getPersonNotes: person note: ${personNotesRes.error.message}`,
    );
  }
  const events: NoteEventOption[] = (eventsRes.data ?? []).map((row) => ({
    id: row.id,
    type: row.type,
    typeOther: row.type_other,
  }));
  // `.in()` with an empty array correctly returns zero rows rather than
  // needing a special case when this person has no events yet.
  const eventIds = events.map((event) => event.id);

  const eventNotesRes = await client
    .from("note")
    .select(NOTE_EDIT_COLUMNS)
    .eq("owner_type", "event")
    .in("owner_id", eventIds)
    .order("sort_order", { ascending: true, nullsFirst: false })
    .order("created_at", { ascending: true });

  if (eventNotesRes.error !== null) {
    throw new Error(
      `getPersonNotes: event note: ${eventNotesRes.error.message}`,
    );
  }

  const notes = [
    ...(personNotesRes.data ?? []),
    ...(eventNotesRes.data ?? []),
  ].map(mapNoteEditRow);

  return { notes, events };
}

// --- save diff ------------------------------------------------------------

export interface NoteInsertInput {
  /** Client-generated, same reason as every other section's insert id. */
  readonly id: string;
  readonly ownerType: SectionNoteOwner;
  readonly ownerId: string;
  readonly text: string;
  readonly sortOrder: number;
}

export interface NoteUpdateInput {
  readonly id: string;
  readonly expectedUpdatedAt: string;
  readonly patch: { readonly text?: string; readonly sortOrder?: number };
}

export interface NoteDeleteInput {
  readonly id: string;
  readonly expectedUpdatedAt: string;
}

export interface SaveNotesResult {
  readonly inserted: readonly NoteEditRow[];
  readonly updated: readonly NoteEditRow[];
  readonly deletedIds: readonly string[];
  readonly conflicts: readonly RowConflict<NoteEditRow>[];
}

/** Refetch a `note` row's current state (ignoring `updated_at`) for the
 * `ConflictDialog` — `null` if the row is gone. `note` has no `updated_by`
 * column, so `changedBy` is always `null` (see the module doc). */
async function resolveNoteConflict(
  client: Db,
  id: string,
): Promise<RowConflict<NoteEditRow>> {
  const { data, error } = await client
    .from("note")
    .select(NOTE_EDIT_COLUMNS)
    .eq("id", id)
    .maybeSingle();

  if (error !== null) {
    throw new Error(`resolveNoteConflict: ${id}: ${error.message}`);
  }
  return data === null
    ? { id, theirs: null, changedBy: null }
    : { id, theirs: mapNoteEditRow(data), changedBy: null };
}

/**
 * Apply the Notes diff: insert new rows, apply each version-checked update,
 * apply each version-checked delete. Same shape as `saveAdditionalNames` /
 * `saveEvents` — one bulk insert, one round trip per update/delete (decision
 * 26), not transactional across the three legs for the same documented
 * reason as those.
 */
export async function saveNotes(
  client: Db,
  args: {
    readonly inserts: readonly NoteInsertInput[];
    readonly updates: readonly NoteUpdateInput[];
    readonly deletes: readonly NoteDeleteInput[];
  },
): Promise<SaveNotesResult> {
  const [inserted, updateResults, deleteResults] = await Promise.all([
    insertNotes(client, args.inserts),
    Promise.all(args.updates.map((input) => applyNoteUpdate(client, input))),
    Promise.all(args.deletes.map((input) => applyNoteDelete(client, input))),
  ]);

  const updated: NoteEditRow[] = [];
  const conflicts: RowConflict<NoteEditRow>[] = [];
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

async function insertNotes(
  client: Db,
  inserts: readonly NoteInsertInput[],
): Promise<readonly NoteEditRow[]> {
  if (inserts.length === 0) {
    return [];
  }
  const { data, error } = await client
    .from("note")
    .insert(
      inserts.map((input) => ({
        id: input.id,
        owner_type: input.ownerType,
        owner_id: input.ownerId,
        text: input.text,
        sort_order: input.sortOrder,
      })),
    )
    .select(NOTE_EDIT_COLUMNS);

  if (error !== null) {
    throw new Error(`saveNotes: insert: ${error.message}`);
  }
  return (data ?? []).map(mapNoteEditRow);
}

type RowResult =
  | { readonly ok: true; readonly row: NoteEditRow }
  | { readonly ok: false; readonly conflict: RowConflict<NoteEditRow> };

async function applyNoteUpdate(
  client: Db,
  input: NoteUpdateInput,
): Promise<RowResult> {
  const patch: Database["public"]["Tables"]["note"]["Update"] = {};
  if (input.patch.text !== undefined) {
    patch.text = input.patch.text;
  }
  if (input.patch.sortOrder !== undefined) {
    patch.sort_order = input.patch.sortOrder;
  }

  const { data, error } = await client
    .from("note")
    .update(patch)
    .eq("id", input.id)
    .eq("updated_at", input.expectedUpdatedAt)
    .select(NOTE_EDIT_COLUMNS)
    .maybeSingle();

  if (error !== null) {
    throw new Error(`saveNotes: update ${input.id}: ${error.message}`);
  }
  if (data !== null) {
    return { ok: true, row: mapNoteEditRow(data) };
  }
  return { ok: false, conflict: await resolveNoteConflict(client, input.id) };
}

async function applyNoteDelete(
  client: Db,
  input: NoteDeleteInput,
): Promise<
  | { readonly ok: true; readonly id: string }
  | { readonly ok: false; readonly conflict: RowConflict<NoteEditRow> }
> {
  const { data, error } = await client
    .from("note")
    .delete()
    .eq("id", input.id)
    .eq("updated_at", input.expectedUpdatedAt)
    .select("id")
    .maybeSingle();

  if (error !== null) {
    throw new Error(`saveNotes: delete ${input.id}: ${error.message}`);
  }
  if (data !== null) {
    return { ok: true, id: input.id };
  }
  return { ok: false, conflict: await resolveNoteConflict(client, input.id) };
}
