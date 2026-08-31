import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "./database.types";
import type { GenealogyDateColumns } from "./genealogy-date";
import { getNeighborhood } from "./neighborhood";
import type {
  EventType,
  FactType,
  FactVisibility,
  NameType,
  Neighborhood,
  Sex,
} from "./types";
import { isUuid } from "./uuid";

type Db = SupabaseClient<Database>;

/**
 * The read-only person profile (SPEC §8.1 route `/person/[personId]`, §10 item
 * 25). Every read runs under the caller's identity, so RLS is the boundary — a
 * non-visible person yields `null`, a withheld fact never comes back, a
 * sensitive fact is hidden from a non-moderator while the subject is living
 * (`fact_is_visible`, SPEC §5).
 *
 * The queries fan out by entity type because the dependent tables
 * (`fact` / `media_link` / `citation` / `note`) are polymorphic and carry no FK
 * to `person` (SPEC §4.9), so a single embedded select is not possible. They run
 * in parallel; the relationship strip reuses the one-round-trip
 * `get_neighborhood` at one generation each way.
 *
 * The timeline is this person's own events. Union events (marriage, divorce)
 * hang off `family` and are surfaced through the relationship strip's union
 * label, not the timeline — see `DECISIONS.md`.
 */

// --- returned shape ------------------------------------------------------

export interface ProfilePersonCore {
  readonly id: string;
  readonly givenName: string | null;
  readonly surname: string | null;
  readonly namePrefix: string | null;
  readonly nameSuffix: string | null;
  readonly nickname: string | null;
  readonly sex: Sex | null;
  readonly isLiving: boolean | null;
}

export interface ProfileName {
  readonly id: string;
  readonly type: NameType | null;
  readonly givenName: string | null;
  readonly surname: string | null;
  readonly prefix: string | null;
  readonly suffix: string | null;
  readonly nickname: string | null;
}

export interface ProfileEvent {
  readonly id: string;
  readonly type: EventType;
  readonly typeOther: string | null;
  readonly value: string | null;
  readonly ageText: string | null;
  readonly sortKey: string | null;
  readonly placeName: string | null;
  readonly date: GenealogyDateColumns;
}

export interface ProfileFact {
  readonly id: string;
  readonly type: FactType;
  readonly typeOther: string | null;
  readonly value: string | null;
  readonly isSensitive: boolean;
  readonly visibility: FactVisibility;
  readonly placeName: string | null;
  readonly date: GenealogyDateColumns;
}

export interface ProfileMedia {
  /** `media_link` id — the attachment, not the underlying media row. */
  readonly id: string;
  readonly title: string | null;
  readonly filename: string | null;
  readonly caption: string | null;
  readonly isPrimary: boolean;
}

export interface ProfileCitation {
  readonly id: string;
  readonly page: string | null;
  readonly quality: number | null;
  readonly detail: string | null;
  readonly sourceTitle: string | null;
  readonly sourceAuthor: string | null;
  readonly sourcePublication: string | null;
  readonly repositoryName: string | null;
}

export interface ProfileNote {
  readonly id: string;
  readonly text: string;
}

export interface PersonProfileData {
  readonly person: ProfilePersonCore;
  readonly names: readonly ProfileName[];
  readonly events: readonly ProfileEvent[];
  readonly facts: readonly ProfileFact[];
  readonly media: readonly ProfileMedia[];
  readonly citations: readonly ProfileCitation[];
  readonly notes: readonly ProfileNote[];
  readonly relationships: Neighborhood;
}

/** Everything `/person/[personId]/edit`'s shell needs: the header line and the
 * parents / partners / children strip. The individual sections (#27–#32) fetch
 * their own data — the shell has no reason to fan out to `event` / `fact` /
 * `media_link` / `citation` / `note` the way {@link getPersonProfile} does.
 * `personUpdatedAt` piggybacks on this same row read so the Name & Gender
 * section (#27) — whose fields are exactly {@link ProfilePersonCore}'s, plus
 * this timestamp — never needs a second `person` fetch for data the shell
 * already has in hand. */
export interface PersonEditShellData {
  readonly person: ProfilePersonCore;
  readonly personUpdatedAt: string;
  readonly relationships: Neighborhood;
}

// --- shared person-core select -----------------------------------------

const PERSON_CORE_COLUMNS =
  "id, given_name, surname, name_prefix, name_suffix, nickname, sex, is_living";

function mapPersonCore(row: {
  id: string;
  given_name: string | null;
  surname: string | null;
  name_prefix: string | null;
  name_suffix: string | null;
  nickname: string | null;
  sex: Sex | null;
  is_living: boolean | null;
}): ProfilePersonCore {
  return {
    id: row.id,
    givenName: row.given_name,
    surname: row.surname,
    namePrefix: row.name_prefix,
    nameSuffix: row.name_suffix,
    nickname: row.nickname,
    sex: row.sex,
    isLiving: row.is_living,
  };
}

// --- fetch -------------------------------------------------------------

/**
 * Load everything the profile shows for `personId`, or `null` when the person is
 * absent or hidden by RLS (the caller cannot tell which — never leak it).
 */
export async function getPersonProfile(
  client: Db,
  personId: string,
): Promise<PersonProfileData | null> {
  if (!isUuid(personId)) {
    return null;
  }

  const [
    personRes,
    namesRes,
    eventsRes,
    factsRes,
    mediaRes,
    citationsRes,
    notesRes,
  ] = await Promise.all([
    client
      .from("person")
      .select(PERSON_CORE_COLUMNS)
      .eq("id", personId)
      .maybeSingle(),
    client
      .from("person_name")
      .select("id, type, given_name, surname, prefix, suffix, nickname")
      .eq("person_id", personId)
      .order("sort_order", { ascending: true, nullsFirst: false })
      .order("created_at", { ascending: true }),
    client
      .from("event")
      .select(
        "id, type, type_other, value, age_text, sort_key, date_value_raw, date_kind, date_year1, date_month1, date_day1, date_year2, date_month2, date_day2, date_calendar, date_dual_year, date_phrase, place:place_id(name)",
      )
      .eq("owner_type", "person")
      .eq("person_id", personId)
      .order("sort_key", { ascending: true, nullsFirst: false })
      .order("id", { ascending: true }),
    client
      .from("fact")
      .select(
        "id, type, type_other, value, is_sensitive, visibility, date_value_raw, date_kind, date_year1, date_month1, date_day1, date_year2, date_month2, date_day2, date_calendar, date_dual_year, date_phrase, place:place_id(name)",
      )
      .eq("owner_type", "person")
      .eq("person_id", personId)
      .order("id", { ascending: true }),
    client
      .from("media_link")
      .select(
        "id, caption, is_primary, sort_order, media:media_id(title, original_filename)",
      )
      .eq("owner_type", "person")
      .eq("owner_id", personId)
      .order("is_primary", { ascending: false })
      .order("sort_order", { ascending: true, nullsFirst: false }),
    client
      .from("citation")
      .select(
        "id, page, quality, data_text, source:source_id(title, author, publication_info, repository:repository_id(name))",
      )
      .eq("owner_type", "person")
      .eq("owner_id", personId)
      .order("id", { ascending: true }),
    client
      .from("note")
      .select("id, text")
      .eq("owner_type", "person")
      .eq("owner_id", personId)
      .order("sort_order", { ascending: true, nullsFirst: false })
      .order("created_at", { ascending: true }),
  ]);

  // Check every query for a real error before branching on "not found" — a
  // genuine failure on a sibling query must never be swallowed by an early
  // return that reads as "this person doesn't exist."
  throwOnError("person", personRes.error);
  throwOnError("person_name", namesRes.error);
  throwOnError("event", eventsRes.error);
  throwOnError("fact", factsRes.error);
  throwOnError("media_link", mediaRes.error);
  throwOnError("citation", citationsRes.error);
  throwOnError("note", notesRes.error);

  if (personRes.data === null) {
    return null;
  }

  const relationships = await getNeighborhood(client, personId, 1, 1);

  return {
    person: mapPersonCore(personRes.data),
    names: (namesRes.data ?? []).map((row) => ({
      id: row.id,
      type: row.type,
      givenName: row.given_name,
      surname: row.surname,
      prefix: row.prefix,
      suffix: row.suffix,
      nickname: row.nickname,
    })),
    events: (eventsRes.data ?? []).map((row) => ({
      id: row.id,
      type: row.type,
      typeOther: row.type_other,
      value: row.value,
      ageText: row.age_text,
      sortKey: row.sort_key,
      placeName: placeName(row.place),
      date: pickDateColumns(row),
    })),
    facts: (factsRes.data ?? []).map((row) => ({
      id: row.id,
      type: row.type,
      typeOther: row.type_other,
      value: row.value,
      isSensitive: row.is_sensitive ?? false,
      visibility: row.visibility,
      placeName: placeName(row.place),
      date: pickDateColumns(row),
    })),
    media: (mediaRes.data ?? []).map((row) => ({
      id: row.id,
      title: row.media?.title ?? null,
      filename: row.media?.original_filename ?? null,
      caption: row.caption,
      isPrimary: row.is_primary,
    })),
    citations: (citationsRes.data ?? []).map((row) => ({
      id: row.id,
      page: row.page,
      quality: row.quality,
      detail: row.data_text,
      sourceTitle: row.source?.title ?? null,
      sourceAuthor: row.source?.author ?? null,
      sourcePublication: row.source?.publication_info ?? null,
      repositoryName: row.source?.repository?.name ?? null,
    })),
    notes: (notesRes.data ?? []).map((row) => ({ id: row.id, text: row.text })),
    relationships,
  };
}

/**
 * Load the header and relatives strip for `/person/[personId]/edit`'s shell
 * (SPEC §8.3, §10 item 26), or `null` when the person is absent or hidden by
 * RLS — same never-leak-which contract as {@link getPersonProfile}. The person
 * row is fetched alone first so a 404 never pays for the neighbourhood query.
 */
export async function getPersonEditShell(
  client: Db,
  personId: string,
): Promise<PersonEditShellData | null> {
  if (!isUuid(personId)) {
    return null;
  }

  const personRes = await client
    .from("person")
    .select(`${PERSON_CORE_COLUMNS}, updated_at`)
    .eq("id", personId)
    .maybeSingle();

  throwOnError("person", personRes.error);
  if (personRes.data === null) {
    return null;
  }

  const relationships = await getNeighborhood(client, personId, 1, 1);

  return {
    person: mapPersonCore(personRes.data),
    personUpdatedAt: personRes.data.updated_at,
    relationships,
  };
}

// --- row mapping helpers ----------------------------------------------

/** An embedded to-one `place` — object, or `null` when unset. */
function placeName(place: { name: string } | null): string | null {
  const name = place?.name.trim();
  return name === undefined || name === "" ? null : name;
}

function pickDateColumns(row: GenealogyDateColumns): GenealogyDateColumns {
  return {
    date_value_raw: row.date_value_raw,
    date_kind: row.date_kind,
    date_year1: row.date_year1,
    date_month1: row.date_month1,
    date_day1: row.date_day1,
    date_year2: row.date_year2,
    date_month2: row.date_month2,
    date_day2: row.date_day2,
    date_calendar: row.date_calendar,
    date_dual_year: row.date_dual_year,
    date_phrase: row.date_phrase,
  };
}

function throwOnError(table: string, error: { message: string } | null): void {
  if (error !== null) {
    throw new Error(`getPersonProfile: ${table}: ${error.message}`);
  }
}
