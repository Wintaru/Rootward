import type { SupabaseClient } from "@supabase/supabase-js";

import type { RowConflict } from "./conflict";
import type { Database } from "./database.types";
import type { GenealogyDateColumns } from "./genealogy-date";
import type { CitationOwner, EventType, FactType } from "./types";

type Db = SupabaseClient<Database>;

/**
 * The write side of the edit view's Sources section (SPEC §8.3, §4.3, §10
 * item 30): `repository` and `source` are managed as flat, unscoped lists
 * (both `repository_select` / `source_select` RLS already allow any approved
 * member to read them, same "shared reference data" boundary as `place`), and
 * `citation` rows are managed for the person and for the person's own events
 * and facts — the issue's exact wording ("Attach a citation to the person
 * (and to events / facts)"), a narrower slice of the full `citation_owner`
 * enum (`person · event · fact · family · person_name`) than the schema
 * allows, same kind of MVP-scope call `note-edit.ts` makes for `note_owner`.
 *
 * `repository` / `source` carry no `created_by` / `updated_by` columns (#7
 * only added those to `person` / `event` / `fact`, plus `uploaded_by` on
 * `media`) — a conflict's `changedBy` is always `null`, same as `note`.
 * `citation` is the same: it carries `updated_at` (the `set_updated_at`
 * trigger applies) but no `updated_by`.
 *
 * Every write is version-checked (WAYFINDER decision 26): `UPDATE/DELETE …
 * WHERE id = $1 AND updated_at = $2`, zero rows back → the caller refetches
 * the current row for the `ConflictDialog`.
 *
 * `repository` and `source` are read in full rather than searched — both are
 * small reference tables today (one row per archive / bibliographic source, a
 * handful per tree), so a flat "manage everything" list matches the pattern
 * `additional-names.ts` / `events.ts` use for a person's own rows. If a tree
 * ever accumulates enough sources for this to matter, this is the place to
 * switch to a `PlaceInput`-style search-and-create picker instead.
 */

// ===========================================================================
// repository
// ===========================================================================

const REPOSITORY_EDIT_COLUMNS =
  "id, name, address, phone, email, website, updated_at";

type RepositoryEditDbRow = {
  id: string;
  name: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  updated_at: string;
};

export interface RepositoryEditRow {
  readonly id: string;
  readonly updatedAt: string;
  readonly name: string | null;
  readonly address: string | null;
  readonly phone: string | null;
  readonly email: string | null;
  readonly website: string | null;
}

function mapRepositoryEditRow(row: RepositoryEditDbRow): RepositoryEditRow {
  return {
    id: row.id,
    updatedAt: row.updated_at,
    name: row.name,
    address: row.address,
    phone: row.phone,
    email: row.email,
    website: row.website,
  };
}

/** Every `repository` row, ordered by name (nulls last, then `id` for a
 * stable order among unnamed rows). */
export async function getRepositories(
  client: Db,
): Promise<readonly RepositoryEditRow[]> {
  const { data, error } = await client
    .from("repository")
    .select(REPOSITORY_EDIT_COLUMNS)
    .order("name", { ascending: true, nullsFirst: false })
    .order("id", { ascending: true });

  if (error !== null) {
    throw new Error(`getRepositories: ${error.message}`);
  }
  return (data ?? []).map(mapRepositoryEditRow);
}

export interface RepositoryFieldValues {
  readonly name: string | null;
  readonly address: string | null;
  readonly phone: string | null;
  readonly email: string | null;
  readonly website: string | null;
}

export interface RepositoryInsertInput extends RepositoryFieldValues {
  /** Client-generated (the section assigns a row's id at "Add" time), same
   * reason as every other section's insert id — and, here, so a `source`
   * added in the same save can reference this repository's id before either
   * row has round-tripped (see `source-edit.ts`'s module doc). */
  readonly id: string;
}

export interface RepositoryUpdateInput {
  readonly id: string;
  readonly expectedUpdatedAt: string;
  readonly patch: Partial<RepositoryFieldValues>;
}

export interface RepositoryDeleteInput {
  readonly id: string;
  readonly expectedUpdatedAt: string;
}

export interface SaveRepositoriesResult {
  readonly inserted: readonly RepositoryEditRow[];
  readonly updated: readonly RepositoryEditRow[];
  readonly deletedIds: readonly string[];
  readonly conflicts: readonly RowConflict<RepositoryEditRow>[];
}

async function resolveRepositoryConflict(
  client: Db,
  id: string,
): Promise<RowConflict<RepositoryEditRow>> {
  const { data, error } = await client
    .from("repository")
    .select(REPOSITORY_EDIT_COLUMNS)
    .eq("id", id)
    .maybeSingle();

  if (error !== null) {
    throw new Error(`resolveRepositoryConflict: ${id}: ${error.message}`);
  }
  return data === null
    ? { id, theirs: null, changedBy: null }
    : { id, theirs: mapRepositoryEditRow(data), changedBy: null };
}

/**
 * Apply the Repositories diff: insert new rows, apply each version-checked
 * update, apply each version-checked delete. Same shape as `saveNotes` — one
 * bulk insert, one round trip per update/delete (decision 26), not
 * transactional across the three legs for the same documented reason.
 */
export async function saveRepositories(
  client: Db,
  args: {
    readonly inserts: readonly RepositoryInsertInput[];
    readonly updates: readonly RepositoryUpdateInput[];
    readonly deletes: readonly RepositoryDeleteInput[];
  },
): Promise<SaveRepositoriesResult> {
  const [inserted, updateResults, deleteResults] = await Promise.all([
    insertRepositories(client, args.inserts),
    Promise.all(
      args.updates.map((input) => applyRepositoryUpdate(client, input)),
    ),
    Promise.all(
      args.deletes.map((input) => applyRepositoryDelete(client, input)),
    ),
  ]);

  const updated: RepositoryEditRow[] = [];
  const conflicts: RowConflict<RepositoryEditRow>[] = [];
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

async function insertRepositories(
  client: Db,
  inserts: readonly RepositoryInsertInput[],
): Promise<readonly RepositoryEditRow[]> {
  if (inserts.length === 0) {
    return [];
  }
  const { data, error } = await client
    .from("repository")
    .insert(
      inserts.map((input) => ({
        id: input.id,
        name: input.name,
        address: input.address,
        phone: input.phone,
        email: input.email,
        website: input.website,
      })),
    )
    .select(REPOSITORY_EDIT_COLUMNS);

  if (error !== null) {
    throw new Error(`saveRepositories: insert: ${error.message}`);
  }
  return (data ?? []).map(mapRepositoryEditRow);
}

type RepositoryRowResult =
  | { readonly ok: true; readonly row: RepositoryEditRow }
  | { readonly ok: false; readonly conflict: RowConflict<RepositoryEditRow> };

async function applyRepositoryUpdate(
  client: Db,
  input: RepositoryUpdateInput,
): Promise<RepositoryRowResult> {
  const patch: Database["public"]["Tables"]["repository"]["Update"] = {};
  if (input.patch.name !== undefined) {
    patch.name = input.patch.name;
  }
  if (input.patch.address !== undefined) {
    patch.address = input.patch.address;
  }
  if (input.patch.phone !== undefined) {
    patch.phone = input.patch.phone;
  }
  if (input.patch.email !== undefined) {
    patch.email = input.patch.email;
  }
  if (input.patch.website !== undefined) {
    patch.website = input.patch.website;
  }

  const { data, error } = await client
    .from("repository")
    .update(patch)
    .eq("id", input.id)
    .eq("updated_at", input.expectedUpdatedAt)
    .select(REPOSITORY_EDIT_COLUMNS)
    .maybeSingle();

  if (error !== null) {
    throw new Error(`saveRepositories: update ${input.id}: ${error.message}`);
  }
  if (data !== null) {
    return { ok: true, row: mapRepositoryEditRow(data) };
  }
  return {
    ok: false,
    conflict: await resolveRepositoryConflict(client, input.id),
  };
}

async function applyRepositoryDelete(
  client: Db,
  input: RepositoryDeleteInput,
): Promise<
  | { readonly ok: true; readonly id: string }
  | { readonly ok: false; readonly conflict: RowConflict<RepositoryEditRow> }
> {
  const { data, error } = await client
    .from("repository")
    .delete()
    .eq("id", input.id)
    .eq("updated_at", input.expectedUpdatedAt)
    .select("id")
    .maybeSingle();

  if (error !== null) {
    throw new Error(`saveRepositories: delete ${input.id}: ${error.message}`);
  }
  if (data !== null) {
    return { ok: true, id: input.id };
  }
  return {
    ok: false,
    conflict: await resolveRepositoryConflict(client, input.id),
  };
}

// ===========================================================================
// source
// ===========================================================================

const SOURCE_EDIT_COLUMNS =
  "id, title, author, publication_info, repository_id, source_text, updated_at";

type SourceEditDbRow = {
  id: string;
  title: string | null;
  author: string | null;
  publication_info: string | null;
  repository_id: string | null;
  source_text: string | null;
  updated_at: string;
};

export interface SourceEditRow {
  readonly id: string;
  readonly updatedAt: string;
  readonly title: string | null;
  readonly author: string | null;
  readonly publicationInfo: string | null;
  readonly repositoryId: string | null;
  readonly sourceText: string | null;
}

function mapSourceEditRow(row: SourceEditDbRow): SourceEditRow {
  return {
    id: row.id,
    updatedAt: row.updated_at,
    title: row.title,
    author: row.author,
    publicationInfo: row.publication_info,
    repositoryId: row.repository_id,
    sourceText: row.source_text,
  };
}

/** Every `source` row, ordered by title (nulls last, then `id`). */
export async function getSources(
  client: Db,
): Promise<readonly SourceEditRow[]> {
  const { data, error } = await client
    .from("source")
    .select(SOURCE_EDIT_COLUMNS)
    .order("title", { ascending: true, nullsFirst: false })
    .order("id", { ascending: true });

  if (error !== null) {
    throw new Error(`getSources: ${error.message}`);
  }
  return (data ?? []).map(mapSourceEditRow);
}

export interface SourceFieldValues {
  readonly title: string | null;
  readonly author: string | null;
  readonly publicationInfo: string | null;
  /** `null` clears the repository link — `source.repository_id` is `on
   * delete set null`, so this mirrors what happens when the repository
   * itself is removed. */
  readonly repositoryId: string | null;
  readonly sourceText: string | null;
}

export interface SourceInsertInput extends SourceFieldValues {
  /** Client-generated, so a citation added in the same save can reference
   * this source's id before either row has round-tripped (see the module
   * doc). */
  readonly id: string;
}

export interface SourceUpdateInput {
  readonly id: string;
  readonly expectedUpdatedAt: string;
  readonly patch: Partial<SourceFieldValues>;
}

export interface SourceDeleteInput {
  readonly id: string;
  readonly expectedUpdatedAt: string;
}

export interface SaveSourcesResult {
  readonly inserted: readonly SourceEditRow[];
  readonly updated: readonly SourceEditRow[];
  readonly deletedIds: readonly string[];
  readonly conflicts: readonly RowConflict<SourceEditRow>[];
}

async function resolveSourceConflict(
  client: Db,
  id: string,
): Promise<RowConflict<SourceEditRow>> {
  const { data, error } = await client
    .from("source")
    .select(SOURCE_EDIT_COLUMNS)
    .eq("id", id)
    .maybeSingle();

  if (error !== null) {
    throw new Error(`resolveSourceConflict: ${id}: ${error.message}`);
  }
  return data === null
    ? { id, theirs: null, changedBy: null }
    : { id, theirs: mapSourceEditRow(data), changedBy: null };
}

/** Apply the Sources diff — same shape as `saveRepositories`. */
export async function saveSources(
  client: Db,
  args: {
    readonly inserts: readonly SourceInsertInput[];
    readonly updates: readonly SourceUpdateInput[];
    readonly deletes: readonly SourceDeleteInput[];
  },
): Promise<SaveSourcesResult> {
  const [inserted, updateResults, deleteResults] = await Promise.all([
    insertSources(client, args.inserts),
    Promise.all(args.updates.map((input) => applySourceUpdate(client, input))),
    Promise.all(args.deletes.map((input) => applySourceDelete(client, input))),
  ]);

  const updated: SourceEditRow[] = [];
  const conflicts: RowConflict<SourceEditRow>[] = [];
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

async function insertSources(
  client: Db,
  inserts: readonly SourceInsertInput[],
): Promise<readonly SourceEditRow[]> {
  if (inserts.length === 0) {
    return [];
  }
  const { data, error } = await client
    .from("source")
    .insert(
      inserts.map((input) => ({
        id: input.id,
        title: input.title,
        author: input.author,
        publication_info: input.publicationInfo,
        repository_id: input.repositoryId,
        source_text: input.sourceText,
      })),
    )
    .select(SOURCE_EDIT_COLUMNS);

  if (error !== null) {
    throw new Error(`saveSources: insert: ${error.message}`);
  }
  return (data ?? []).map(mapSourceEditRow);
}

type SourceRowResult =
  | { readonly ok: true; readonly row: SourceEditRow }
  | { readonly ok: false; readonly conflict: RowConflict<SourceEditRow> };

async function applySourceUpdate(
  client: Db,
  input: SourceUpdateInput,
): Promise<SourceRowResult> {
  const patch: Database["public"]["Tables"]["source"]["Update"] = {};
  if (input.patch.title !== undefined) {
    patch.title = input.patch.title;
  }
  if (input.patch.author !== undefined) {
    patch.author = input.patch.author;
  }
  if (input.patch.publicationInfo !== undefined) {
    patch.publication_info = input.patch.publicationInfo;
  }
  if (input.patch.repositoryId !== undefined) {
    patch.repository_id = input.patch.repositoryId;
  }
  if (input.patch.sourceText !== undefined) {
    patch.source_text = input.patch.sourceText;
  }

  const { data, error } = await client
    .from("source")
    .update(patch)
    .eq("id", input.id)
    .eq("updated_at", input.expectedUpdatedAt)
    .select(SOURCE_EDIT_COLUMNS)
    .maybeSingle();

  if (error !== null) {
    throw new Error(`saveSources: update ${input.id}: ${error.message}`);
  }
  if (data !== null) {
    return { ok: true, row: mapSourceEditRow(data) };
  }
  return { ok: false, conflict: await resolveSourceConflict(client, input.id) };
}

async function applySourceDelete(
  client: Db,
  input: SourceDeleteInput,
): Promise<
  | { readonly ok: true; readonly id: string }
  | { readonly ok: false; readonly conflict: RowConflict<SourceEditRow> }
> {
  const { data, error } = await client
    .from("source")
    .delete()
    .eq("id", input.id)
    .eq("updated_at", input.expectedUpdatedAt)
    .select("id")
    .maybeSingle();

  if (error !== null) {
    throw new Error(`saveSources: delete ${input.id}: ${error.message}`);
  }
  if (data !== null) {
    return { ok: true, id: input.id };
  }
  return { ok: false, conflict: await resolveSourceConflict(client, input.id) };
}

// ===========================================================================
// citation
// ===========================================================================

/** `citation_owner` has 5 values (SPEC §4.3) — `family` and `person_name` are
 * also citable — but this section's queries only ever fetch `owner_type in
 * ('person', 'event', 'fact')` (see the module doc). Narrowing to that triple
 * here, the same move `note-edit.ts` makes for `NoteOwner`, keeps the other 2
 * values unrepresentable in this module. */
export type CitationSectionOwner = Extract<
  CitationOwner,
  "person" | "event" | "fact"
>;

const CITATION_EDIT_COLUMNS =
  "id, source_id, owner_type, owner_id, page, data_text, quality, date_value_raw, date_kind, date_year1, date_month1, date_day1, date_year2, date_month2, date_day2, date_calendar, date_dual_year, date_phrase, updated_at";

type CitationEditDbRow = {
  id: string;
  source_id: string;
  owner_type: CitationOwner;
  owner_id: string;
  page: string | null;
  data_text: string | null;
  quality: number | null;
  updated_at: string;
} & GenealogyDateColumns;

export interface CitationEditRow {
  readonly id: string;
  readonly updatedAt: string;
  readonly sourceId: string;
  readonly ownerType: CitationSectionOwner;
  readonly ownerId: string;
  readonly page: string | null;
  readonly dataText: string | null;
  readonly quality: number | null;
  /** `date_value_raw` — always round-trips (SPEC §4.1), so this is exactly
   * what a `DateInput` shows on load. */
  readonly dateRaw: string;
}

function mapCitationEditRow(row: CitationEditDbRow): CitationEditRow {
  return {
    id: row.id,
    updatedAt: row.updated_at,
    sourceId: row.source_id,
    // Safe by construction: `getPersonCitations` only ever queries
    // `owner_type in ('person', 'event', 'fact')` (see below), so every row
    // this module maps is already one of the three `CitationSectionOwner`
    // values.
    ownerType: row.owner_type as CitationSectionOwner,
    ownerId: row.owner_id,
    page: row.page,
    dataText: row.data_text,
    quality: row.quality,
    dateRaw: row.date_value_raw ?? "",
  };
}

/** One of the person's own events — just enough to label and offer it as a
 * citation's owner. Same shape as `note-edit.ts`'s `NoteEventOption`. */
export interface CitationEventOption {
  readonly id: string;
  readonly type: EventType;
  readonly typeOther: string | null;
}

/** One of the person's own facts — just enough to label and offer it as a
 * citation's owner. */
export interface CitationFactOption {
  readonly id: string;
  readonly type: FactType;
  readonly typeOther: string | null;
}

export interface PersonCitationsData {
  readonly citations: readonly CitationEditRow[];
  readonly events: readonly CitationEventOption[];
  readonly facts: readonly CitationFactOption[];
}

/**
 * Load every citation owned directly by `personId`, plus every citation
 * owned by one of `personId`'s own events or facts, plus the lightweight
 * event/fact lists needed to group/label those and to offer as a new
 * citation's owner. `owner_type` differs across the three citation queries,
 * so one `.in()` cannot express all of them — same two-phase fan-out shape as
 * `getPersonNotes`, extended from one dependent owner kind to two.
 */
export async function getPersonCitations(
  client: Db,
  personId: string,
): Promise<PersonCitationsData> {
  const [eventsRes, factsRes, personCitationsRes] = await Promise.all([
    client
      .from("event")
      .select("id, type, type_other")
      .eq("owner_type", "person")
      .eq("person_id", personId)
      .order("sort_key", { ascending: true, nullsFirst: false })
      .order("id", { ascending: true }),
    client
      .from("fact")
      .select("id, type, type_other")
      .eq("owner_type", "person")
      .eq("person_id", personId)
      .order("id", { ascending: true }),
    client
      .from("citation")
      .select(CITATION_EDIT_COLUMNS)
      .eq("owner_type", "person")
      .eq("owner_id", personId)
      .order("created_at", { ascending: true }),
  ]);

  if (eventsRes.error !== null) {
    throw new Error(`getPersonCitations: event: ${eventsRes.error.message}`);
  }
  if (factsRes.error !== null) {
    throw new Error(`getPersonCitations: fact: ${factsRes.error.message}`);
  }
  if (personCitationsRes.error !== null) {
    throw new Error(
      `getPersonCitations: person citation: ${personCitationsRes.error.message}`,
    );
  }

  const events: CitationEventOption[] = (eventsRes.data ?? []).map((row) => ({
    id: row.id,
    type: row.type,
    typeOther: row.type_other,
  }));
  const facts: CitationFactOption[] = (factsRes.data ?? []).map((row) => ({
    id: row.id,
    type: row.type,
    typeOther: row.type_other,
  }));
  // `.in()` with an empty array correctly returns zero rows rather than
  // needing a special case when this person has no events/facts yet.
  const eventIds = events.map((event) => event.id);
  const factIds = facts.map((fact) => fact.id);

  const [eventCitationsRes, factCitationsRes] = await Promise.all([
    client
      .from("citation")
      .select(CITATION_EDIT_COLUMNS)
      .eq("owner_type", "event")
      .in("owner_id", eventIds)
      .order("created_at", { ascending: true }),
    client
      .from("citation")
      .select(CITATION_EDIT_COLUMNS)
      .eq("owner_type", "fact")
      .in("owner_id", factIds)
      .order("created_at", { ascending: true }),
  ]);

  if (eventCitationsRes.error !== null) {
    throw new Error(
      `getPersonCitations: event citation: ${eventCitationsRes.error.message}`,
    );
  }
  if (factCitationsRes.error !== null) {
    throw new Error(
      `getPersonCitations: fact citation: ${factCitationsRes.error.message}`,
    );
  }

  const citations = [
    ...(personCitationsRes.data ?? []),
    ...(eventCitationsRes.data ?? []),
    ...(factCitationsRes.data ?? []),
  ].map(mapCitationEditRow);

  return { citations, events, facts };
}

/** Everything the Sources section needs for one person, fetched together —
 * the full `repository` / `source` lists plus this person's citation data —
 * so `page.tsx`'s section switch makes one call, same convention as
 * `getPersonNotes` bundling its event list alongside its notes. */
export interface SourcesSectionData {
  readonly repositories: readonly RepositoryEditRow[];
  readonly sources: readonly SourceEditRow[];
  readonly citations: PersonCitationsData;
}

export async function getSourcesSectionData(
  client: Db,
  personId: string,
): Promise<SourcesSectionData> {
  const [repositories, sources, citations] = await Promise.all([
    getRepositories(client),
    getSources(client),
    getPersonCitations(client, personId),
  ]);
  return { repositories, sources, citations };
}

export interface CitationFieldValues {
  readonly sourceId: string;
  readonly page: string | null;
  readonly dataText: string | null;
  /** GEDCOM `QUAY`, 0–3. `null` means unset. */
  readonly quality: number | null;
  readonly date: GenealogyDateColumns;
}

export interface CitationInsertInput extends CitationFieldValues {
  /** Client-generated, same reason as every other section's insert id. */
  readonly id: string;
  readonly ownerType: CitationSectionOwner;
  readonly ownerId: string;
}

export interface CitationUpdateInput {
  readonly id: string;
  readonly expectedUpdatedAt: string;
  readonly patch: Partial<CitationFieldValues>;
}

export interface CitationDeleteInput {
  readonly id: string;
  readonly expectedUpdatedAt: string;
}

export interface SaveCitationsResult {
  readonly inserted: readonly CitationEditRow[];
  readonly updated: readonly CitationEditRow[];
  readonly deletedIds: readonly string[];
  readonly conflicts: readonly RowConflict<CitationEditRow>[];
}

async function resolveCitationConflict(
  client: Db,
  id: string,
): Promise<RowConflict<CitationEditRow>> {
  const { data, error } = await client
    .from("citation")
    .select(CITATION_EDIT_COLUMNS)
    .eq("id", id)
    .maybeSingle();

  if (error !== null) {
    throw new Error(`resolveCitationConflict: ${id}: ${error.message}`);
  }
  return data === null
    ? { id, theirs: null, changedBy: null }
    : { id, theirs: mapCitationEditRow(data), changedBy: null };
}

/** Apply the Citations diff — same shape as `saveRepositories` /
 * `saveSources`. `sourceId` may name a source inserted in the same save (see
 * the module doc) — the caller is responsible for saving repositories,
 * sources, and citations in that order so the FK target already exists by
 * the time this runs (each `lib/db` call is its own auto-committed
 * statement, so a prior await is enough — see `app/person/[personId]/edit/actions.ts`). */
export async function saveCitations(
  client: Db,
  args: {
    readonly inserts: readonly CitationInsertInput[];
    readonly updates: readonly CitationUpdateInput[];
    readonly deletes: readonly CitationDeleteInput[];
  },
): Promise<SaveCitationsResult> {
  const [inserted, updateResults, deleteResults] = await Promise.all([
    insertCitations(client, args.inserts),
    Promise.all(
      args.updates.map((input) => applyCitationUpdate(client, input)),
    ),
    Promise.all(
      args.deletes.map((input) => applyCitationDelete(client, input)),
    ),
  ]);

  const updated: CitationEditRow[] = [];
  const conflicts: RowConflict<CitationEditRow>[] = [];
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

async function insertCitations(
  client: Db,
  inserts: readonly CitationInsertInput[],
): Promise<readonly CitationEditRow[]> {
  if (inserts.length === 0) {
    return [];
  }
  const { data, error } = await client
    .from("citation")
    .insert(
      inserts.map((input) => ({
        id: input.id,
        source_id: input.sourceId,
        owner_type: input.ownerType,
        owner_id: input.ownerId,
        page: input.page,
        data_text: input.dataText,
        quality: input.quality,
        ...input.date,
      })),
    )
    .select(CITATION_EDIT_COLUMNS);

  if (error !== null) {
    throw new Error(`saveCitations: insert: ${error.message}`);
  }
  return (data ?? []).map(mapCitationEditRow);
}

type CitationRowResult =
  | { readonly ok: true; readonly row: CitationEditRow }
  | { readonly ok: false; readonly conflict: RowConflict<CitationEditRow> };

async function applyCitationUpdate(
  client: Db,
  input: CitationUpdateInput,
): Promise<CitationRowResult> {
  const patch: Database["public"]["Tables"]["citation"]["Update"] = {};
  if (input.patch.sourceId !== undefined) {
    patch.source_id = input.patch.sourceId;
  }
  if (input.patch.page !== undefined) {
    patch.page = input.patch.page;
  }
  if (input.patch.dataText !== undefined) {
    patch.data_text = input.patch.dataText;
  }
  if (input.patch.quality !== undefined) {
    patch.quality = input.patch.quality;
  }
  if (input.patch.date !== undefined) {
    Object.assign(patch, input.patch.date);
  }

  const { data, error } = await client
    .from("citation")
    .update(patch)
    .eq("id", input.id)
    .eq("updated_at", input.expectedUpdatedAt)
    .select(CITATION_EDIT_COLUMNS)
    .maybeSingle();

  if (error !== null) {
    throw new Error(`saveCitations: update ${input.id}: ${error.message}`);
  }
  if (data !== null) {
    return { ok: true, row: mapCitationEditRow(data) };
  }
  return {
    ok: false,
    conflict: await resolveCitationConflict(client, input.id),
  };
}

async function applyCitationDelete(
  client: Db,
  input: CitationDeleteInput,
): Promise<
  | { readonly ok: true; readonly id: string }
  | { readonly ok: false; readonly conflict: RowConflict<CitationEditRow> }
> {
  const { data, error } = await client
    .from("citation")
    .delete()
    .eq("id", input.id)
    .eq("updated_at", input.expectedUpdatedAt)
    .select("id")
    .maybeSingle();

  if (error !== null) {
    throw new Error(`saveCitations: delete ${input.id}: ${error.message}`);
  }
  if (data !== null) {
    return { ok: true, id: input.id };
  }
  return {
    ok: false,
    conflict: await resolveCitationConflict(client, input.id),
  };
}
