import type { SupabaseClient } from "@supabase/supabase-js";

import { getAccountDisplayName } from "./account-lookup";
import type { Database } from "./database.types";
import type { RowConflict } from "./conflict";
import type { NameType, Sex } from "./types";
import { isUuid } from "./uuid";

type Db = SupabaseClient<Database>;

/**
 * The write side of the edit view's Name & Gender, Additional Names, and
 * Reference Numbers sections (SPEC §8.3, §4.2, §10 item 27). Reads run under
 * the caller's identity (RLS `person_select` / `person_name_select`); writes
 * go through `person_update` / `person_name_write`, both `is_moderator()` — the
 * server actions in `app/person/[personId]/edit/actions.ts` re-check that
 * before calling in, but RLS is the real boundary.
 *
 * Every write is a version-checked `UPDATE … WHERE id = $1 AND updated_at =
 * $2` (WAYFINDER decision 26, non-negotiable from the first edit-view
 * release). Zero rows back means the row changed (or was deleted) since it
 * was loaded — the caller refetches the current row (`resolvePersonConflict` /
 * `resolveNameConflict`, #31) so `ConflictDialog` can show "theirs" beside the
 * rejected local edit; `person` carries `updated_by`, so a person-field
 * conflict also names who holds it now, while a `person_name` conflict does
 * not (that table has no `updated_by` column).
 */

// --- Name & Gender / Reference Numbers (one `person` row) ---------------

const PERSON_EDIT_COLUMNS =
  "id, given_name, surname, name_prefix, name_suffix, nickname, sex, familysearch_id, ancestral_file_number, user_reference_number, updated_at";

type PersonEditRow = {
  id: string;
  given_name: string | null;
  surname: string | null;
  name_prefix: string | null;
  name_suffix: string | null;
  nickname: string | null;
  sex: Sex | null;
  familysearch_id: string | null;
  ancestral_file_number: string | null;
  user_reference_number: string | null;
  updated_at: string;
};

export interface PersonEditFields {
  readonly id: string;
  readonly updatedAt: string;
  readonly givenName: string | null;
  readonly surname: string | null;
  readonly namePrefix: string | null;
  readonly nameSuffix: string | null;
  readonly nickname: string | null;
  readonly sex: Sex | null;
  readonly familysearchId: string | null;
  readonly ancestralFileNumber: string | null;
  readonly userReferenceNumber: string | null;
}

/** The subset of {@link PersonEditFields} a save may patch — never `id` or
 * `updatedAt`, which identify the version being written, not values to set. */
export type PersonFieldPatch = Partial<
  Omit<PersonEditFields, "id" | "updatedAt">
>;

function mapPersonEditFields(row: PersonEditRow): PersonEditFields {
  return {
    id: row.id,
    updatedAt: row.updated_at,
    givenName: row.given_name,
    surname: row.surname,
    namePrefix: row.name_prefix,
    nameSuffix: row.name_suffix,
    nickname: row.nickname,
    sex: row.sex,
    familysearchId: row.familysearch_id,
    ancestralFileNumber: row.ancestral_file_number,
    userReferenceNumber: row.user_reference_number,
  };
}

const PATCH_COLUMN_NAMES: Readonly<
  Record<keyof PersonFieldPatch, keyof PersonEditRow>
> = {
  givenName: "given_name",
  surname: "surname",
  namePrefix: "name_prefix",
  nameSuffix: "name_suffix",
  nickname: "nickname",
  sex: "sex",
  familysearchId: "familysearch_id",
  ancestralFileNumber: "ancestral_file_number",
  userReferenceNumber: "user_reference_number",
};

function toPersonUpdateRow(
  patch: PersonFieldPatch,
): Database["public"]["Tables"]["person"]["Update"] {
  const row: Database["public"]["Tables"]["person"]["Update"] = {};
  for (const key of Object.keys(patch) as (keyof PersonFieldPatch)[]) {
    const column = PATCH_COLUMN_NAMES[key];
    (row as Record<string, unknown>)[column] = patch[key];
  }
  return row;
}

/** The Reference Numbers section's fields only — `id, updated_at` plus the
 * three reference columns. Deliberately not {@link PersonEditFields}'s full
 * column set: the page's `/edit` shell has already fetched the Name & Gender
 * columns (they are exactly {@link ProfilePersonCore}'s), so re-fetching them
 * here would be the same `person` row over the wire twice for no reason. */
export type PersonReferenceNumberFields = Pick<
  PersonEditFields,
  | "id"
  | "updatedAt"
  | "familysearchId"
  | "ancestralFileNumber"
  | "userReferenceNumber"
>;

const PERSON_REFERENCE_NUMBER_COLUMNS =
  "id, familysearch_id, ancestral_file_number, user_reference_number, updated_at";

type PersonReferenceNumberRow = Pick<
  PersonEditRow,
  | "id"
  | "familysearch_id"
  | "ancestral_file_number"
  | "user_reference_number"
  | "updated_at"
>;

function mapPersonReferenceNumberFields(
  row: PersonReferenceNumberRow,
): PersonReferenceNumberFields {
  return {
    id: row.id,
    updatedAt: row.updated_at,
    familysearchId: row.familysearch_id,
    ancestralFileNumber: row.ancestral_file_number,
    userReferenceNumber: row.user_reference_number,
  };
}

/** Load the Reference Numbers section's fields for `personId`, or `null` when
 * the person is absent or hidden by RLS. */
export async function getPersonReferenceNumbers(
  client: Db,
  personId: string,
): Promise<PersonReferenceNumberFields | null> {
  if (!isUuid(personId)) {
    return null;
  }

  const { data, error } = await client
    .from("person")
    .select(PERSON_REFERENCE_NUMBER_COLUMNS)
    .eq("id", personId)
    .maybeSingle();

  if (error !== null) {
    throw new Error(`getPersonReferenceNumbers: ${error.message}`);
  }
  return data === null ? null : mapPersonReferenceNumberFields(data);
}

export type SavePersonFieldsResult =
  | { readonly ok: true; readonly row: PersonEditFields }
  | { readonly ok: false; readonly conflict: RowConflict<PersonEditFields> };

/** Refetch `person`'s current state (ignoring `updated_at`) for the
 * `ConflictDialog` — `null` if the row is gone (deleted, or no longer
 * RLS-visible). `person.updated_by` resolves to a display name via
 * `getAccountDisplayName`; see the module doc for why `person_name` cannot. */
async function resolvePersonFieldsConflict(
  client: Db,
  personId: string,
): Promise<RowConflict<PersonEditFields>> {
  const { data, error } = await client
    .from("person")
    .select(`${PERSON_EDIT_COLUMNS}, updated_by`)
    .eq("id", personId)
    .maybeSingle();

  if (error !== null) {
    throw new Error(`resolvePersonFieldsConflict: ${error.message}`);
  }
  if (data === null) {
    return { id: personId, theirs: null, changedBy: null };
  }
  const changedBy = await getAccountDisplayName(client, data.updated_by);
  return { id: personId, theirs: mapPersonEditFields(data), changedBy };
}

/**
 * Apply `patch` to `personId`'s row, guarded on it still being at
 * `expectedUpdatedAt`. `patch` must be non-empty — the caller (the section
 * component) never invokes a save with nothing dirty.
 */
export async function updatePersonFields(
  client: Db,
  args: {
    readonly personId: string;
    readonly expectedUpdatedAt: string;
    readonly patch: PersonFieldPatch;
  },
): Promise<SavePersonFieldsResult> {
  const { data, error } = await client
    .from("person")
    .update(toPersonUpdateRow(args.patch))
    .eq("id", args.personId)
    .eq("updated_at", args.expectedUpdatedAt)
    .select(PERSON_EDIT_COLUMNS)
    .maybeSingle();

  if (error !== null) {
    throw new Error(`updatePersonFields: ${error.message}`);
  }
  if (data !== null) {
    return { ok: true, row: mapPersonEditFields(data) };
  }
  return {
    ok: false,
    conflict: await resolvePersonFieldsConflict(client, args.personId),
  };
}

// --- Additional Names (`person_name`, many rows) -------------------------

const PERSON_NAME_COLUMNS =
  "id, type, given_name, surname, prefix, suffix, nickname, sort_order, updated_at";

type PersonNameEditDbRow = {
  id: string;
  type: NameType | null;
  given_name: string | null;
  surname: string | null;
  prefix: string | null;
  suffix: string | null;
  nickname: string | null;
  sort_order: number | null;
  updated_at: string;
};

export interface PersonNameEditRow {
  readonly id: string;
  readonly updatedAt: string;
  readonly type: NameType | null;
  readonly givenName: string | null;
  readonly surname: string | null;
  readonly prefix: string | null;
  readonly suffix: string | null;
  readonly nickname: string | null;
  readonly sortOrder: number | null;
}

function mapPersonNameEditRow(row: PersonNameEditDbRow): PersonNameEditRow {
  return {
    id: row.id,
    updatedAt: row.updated_at,
    type: row.type,
    givenName: row.given_name,
    surname: row.surname,
    prefix: row.prefix,
    suffix: row.suffix,
    nickname: row.nickname,
    sortOrder: row.sort_order,
  };
}

/** Every `person_name` row for `personId`, in display order. */
export async function getPersonNames(
  client: Db,
  personId: string,
): Promise<readonly PersonNameEditRow[]> {
  const { data, error } = await client
    .from("person_name")
    .select(PERSON_NAME_COLUMNS)
    .eq("person_id", personId)
    .order("sort_order", { ascending: true, nullsFirst: false })
    .order("created_at", { ascending: true });

  if (error !== null) {
    throw new Error(`getPersonNames: ${error.message}`);
  }
  return (data ?? []).map(mapPersonNameEditRow);
}

export interface PersonNameFieldValues {
  readonly type: NameType | null;
  readonly givenName: string | null;
  readonly surname: string | null;
  readonly prefix: string | null;
  readonly suffix: string | null;
  readonly nickname: string | null;
}

export interface PersonNameInsertInput extends PersonNameFieldValues {
  /** Client-generated (the Additional Names section assigns a row's id at
   * "add" time, before it is ever saved) so a freshly inserted row's identity
   * is known immediately — no need to correlate it back from an insert
   * response, which `INSERT … VALUES (...), (...)` does not order-guarantee. */
  readonly id: string;
  readonly sortOrder: number;
}

export interface PersonNameUpdateInput {
  readonly id: string;
  readonly expectedUpdatedAt: string;
  /** Only the changed fields — `sortOrder` is present whenever the row's
   * position changed, even if no other field did. */
  readonly patch: Partial<PersonNameFieldValues> & { sortOrder?: number };
}

export interface PersonNameDeleteInput {
  readonly id: string;
  readonly expectedUpdatedAt: string;
}

export interface SaveAdditionalNamesResult {
  readonly inserted: readonly PersonNameEditRow[];
  readonly updated: readonly PersonNameEditRow[];
  readonly deletedIds: readonly string[];
  /** Rows whose update or delete lost the version check — the row changed
   * elsewhere since this section loaded it. `person_name` has no
   * `updated_by` column, so `changedBy` is always `null` here. */
  readonly conflicts: readonly RowConflict<PersonNameEditRow>[];
}

function toPersonNameInsertRow(
  personId: string,
  input: PersonNameInsertInput,
): Database["public"]["Tables"]["person_name"]["Insert"] {
  return {
    id: input.id,
    person_id: personId,
    type: input.type,
    given_name: input.givenName,
    surname: input.surname,
    prefix: input.prefix,
    suffix: input.suffix,
    nickname: input.nickname,
    sort_order: input.sortOrder,
  };
}

const NAME_PATCH_COLUMNS: Readonly<
  Record<keyof PersonNameFieldValues, keyof PersonNameEditDbRow>
> = {
  type: "type",
  givenName: "given_name",
  surname: "surname",
  prefix: "prefix",
  suffix: "suffix",
  nickname: "nickname",
};

function toPersonNameUpdateRow(
  patch: PersonNameUpdateInput["patch"],
): Database["public"]["Tables"]["person_name"]["Update"] {
  const row: Database["public"]["Tables"]["person_name"]["Update"] = {};
  for (const key of Object.keys(patch) as (keyof typeof patch)[]) {
    if (key === "sortOrder") {
      row.sort_order = patch.sortOrder;
      continue;
    }
    const column = NAME_PATCH_COLUMNS[key];
    (row as Record<string, unknown>)[column] = patch[key];
  }
  return row;
}

/**
 * Apply the Additional Names diff for one person: insert new rows, apply each
 * version-checked update, apply each version-checked delete. Every insert is
 * one bulk round trip (no concurrency question — the rows do not exist yet);
 * updates and deletes each need their own `WHERE id = $1 AND updated_at = $2`,
 * so those run one round trip per row (decision 26 — "a mismatch rejects only
 * that row; the rest save", which a single batched statement cannot express).
 *
 * Not wrapped in a transaction, so it is not atomic across the three legs: a
 * thrown error (a constraint violation, a dropped connection) on one leg
 * rejects this whole call even though the other legs' Postgres writes may
 * already have committed — the caller then sees "something went wrong" while
 * some rows genuinely saved. No data is lost (Postgres holds the true state,
 * and the next load reflects it correctly) — the caller's in-memory view is
 * just stale until then, the same recovery path as an ordinary conflict. A
 * single transactional RPC would close this gap; not worth it for v1 given
 * how rarely a leg throws outright (a version mismatch, the common case,
 * already returns as data rather than throwing).
 */
export async function saveAdditionalNames(
  client: Db,
  args: {
    readonly personId: string;
    readonly inserts: readonly PersonNameInsertInput[];
    readonly updates: readonly PersonNameUpdateInput[];
    readonly deletes: readonly PersonNameDeleteInput[];
  },
): Promise<SaveAdditionalNamesResult> {
  const [inserted, updateResults, deleteResults] = await Promise.all([
    insertNames(client, args.personId, args.inserts),
    Promise.all(args.updates.map((input) => applyNameUpdate(client, input))),
    Promise.all(args.deletes.map((input) => applyNameDelete(client, input))),
  ]);

  const updated: PersonNameEditRow[] = [];
  const conflicts: RowConflict<PersonNameEditRow>[] = [];
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

async function insertNames(
  client: Db,
  personId: string,
  inserts: readonly PersonNameInsertInput[],
): Promise<readonly PersonNameEditRow[]> {
  if (inserts.length === 0) {
    return [];
  }
  const { data, error } = await client
    .from("person_name")
    .insert(inserts.map((input) => toPersonNameInsertRow(personId, input)))
    .select(PERSON_NAME_COLUMNS);

  if (error !== null) {
    throw new Error(`saveAdditionalNames: insert: ${error.message}`);
  }
  return (data ?? []).map(mapPersonNameEditRow);
}

/** Refetch a `person_name` row's current state (ignoring `updated_at`) for
 * the `ConflictDialog` — `null` if the row is gone. `person_name` has no
 * `updated_by` column, so `changedBy` is always `null` (see the module doc). */
async function resolveNameConflict(
  client: Db,
  id: string,
): Promise<RowConflict<PersonNameEditRow>> {
  const { data, error } = await client
    .from("person_name")
    .select(PERSON_NAME_COLUMNS)
    .eq("id", id)
    .maybeSingle();

  if (error !== null) {
    throw new Error(`resolveNameConflict: ${id}: ${error.message}`);
  }
  return data === null
    ? { id, theirs: null, changedBy: null }
    : { id, theirs: mapPersonNameEditRow(data), changedBy: null };
}

type RowResult =
  | { readonly ok: true; readonly id: string; readonly row: PersonNameEditRow }
  | { readonly ok: false; readonly conflict: RowConflict<PersonNameEditRow> };

async function applyNameUpdate(
  client: Db,
  input: PersonNameUpdateInput,
): Promise<RowResult> {
  const { data, error } = await client
    .from("person_name")
    .update(toPersonNameUpdateRow(input.patch))
    .eq("id", input.id)
    .eq("updated_at", input.expectedUpdatedAt)
    .select(PERSON_NAME_COLUMNS)
    .maybeSingle();

  if (error !== null) {
    throw new Error(
      `saveAdditionalNames: update ${input.id}: ${error.message}`,
    );
  }
  if (data !== null) {
    return { ok: true, id: input.id, row: mapPersonNameEditRow(data) };
  }
  return { ok: false, conflict: await resolveNameConflict(client, input.id) };
}

async function applyNameDelete(
  client: Db,
  input: PersonNameDeleteInput,
): Promise<
  | { readonly ok: true; readonly id: string }
  | { readonly ok: false; readonly conflict: RowConflict<PersonNameEditRow> }
> {
  const { data, error } = await client
    .from("person_name")
    .delete()
    .eq("id", input.id)
    .eq("updated_at", input.expectedUpdatedAt)
    .select("id")
    .maybeSingle();

  if (error !== null) {
    throw new Error(
      `saveAdditionalNames: delete ${input.id}: ${error.message}`,
    );
  }
  if (data !== null) {
    return { ok: true, id: input.id };
  }
  return { ok: false, conflict: await resolveNameConflict(client, input.id) };
}
