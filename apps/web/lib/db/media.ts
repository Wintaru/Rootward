import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "./database.types";
import type { GenealogyDateColumns } from "./genealogy-date";
import type { MediaOwner } from "./types";
import { isUuid } from "./uuid";

type Db = SupabaseClient<Database>;

/**
 * `/media/[mediaId]` viewer (SPEC §8.3, §4.4, §10 item 34). `media_select`
 * RLS (any approved member) gates the row itself; `media_link_select`
 * (`media_link_is_visible`) gates which attachments come back in `links` — a
 * link whose owner isn't visible to the caller (a hidden person, say) is
 * silently absent, never surfaced as "linked to someone you can't see."
 *
 * Only a person-owned link resolves a display name: no other owner type
 * (event / fact / family / source / place) has its own detail route yet, so
 * `lib/media/view-model.ts` renders those with a generic per-type label
 * instead of a link.
 */

const MEDIA_COLUMNS =
  "id, title, original_filename, mime_type, size_bytes, storage_path_display, storage_path_original, date_value_raw, date_kind, date_year1, date_month1, date_day1, date_year2, date_month2, date_day2, date_calendar, date_dual_year, date_phrase";

type MediaDbRow = Pick<
  Database["public"]["Tables"]["media"]["Row"],
  | "id"
  | "title"
  | "original_filename"
  | "mime_type"
  | "size_bytes"
  | "storage_path_display"
  | "storage_path_original"
  | "date_value_raw"
  | "date_kind"
  | "date_year1"
  | "date_month1"
  | "date_day1"
  | "date_year2"
  | "date_month2"
  | "date_day2"
  | "date_calendar"
  | "date_dual_year"
  | "date_phrase"
>;

export interface MediaDetailLink {
  /** `media_link` id. */
  readonly id: string;
  readonly ownerType: MediaOwner;
  readonly ownerId: string;
  readonly isPrimary: boolean;
  readonly caption: string | null;
  /** `null` for every owner type but `person` (see the module doc). */
  readonly personName: string | null;
}

export interface MediaDetail {
  readonly id: string;
  readonly title: string | null;
  readonly originalFilename: string | null;
  readonly mimeType: string | null;
  readonly sizeBytes: number | null;
  readonly date: GenealogyDateColumns;
  readonly storagePathDisplay: string | null;
  readonly storagePathOriginal: string | null;
  readonly links: readonly MediaDetailLink[];
}

/** Load one media item and every attachment link visible to the caller, or
 * `null` when the media row is absent or hidden by RLS. */
export async function getMediaDetail(
  client: Db,
  mediaId: string,
): Promise<MediaDetail | null> {
  if (!isUuid(mediaId)) {
    return null;
  }

  const [mediaRes, linksRes] = await Promise.all([
    client.from("media").select(MEDIA_COLUMNS).eq("id", mediaId).maybeSingle(),
    client
      .from("media_link")
      .select("id, owner_type, owner_id, is_primary, caption")
      .eq("media_id", mediaId)
      .order("is_primary", { ascending: false }),
  ]);

  if (mediaRes.error !== null) {
    throw new Error(`getMediaDetail: media: ${mediaRes.error.message}`);
  }
  if (linksRes.error !== null) {
    throw new Error(`getMediaDetail: media_link: ${linksRes.error.message}`);
  }
  if (mediaRes.data === null) {
    return null;
  }

  const links = linksRes.data ?? [];
  if (links.length === 0) {
    // `media_select` RLS (any approved member) is deliberately looser than
    // `media_link_select` (`media_link_is_visible`) — see SPEC §5's own
    // comment on why the metadata row carries no per-person gate. But the
    // migration that created the `media` storage bucket
    // (`20260901111850_media_bucket.sql`) is explicit that *this* route must
    // still gate the actual bytes on link visibility (WAYFINDER decision
    // 25's "media follows decision 6's access rules"). A `media-process`
    // call always inserts exactly one `media_link` alongside the `media` row,
    // so an empty `links` here means every link that exists is invisible to
    // this caller (a hidden/`moderators_only` person, say) — never a
    // genuinely link-less row. Treat it the same as absent, same "never leak
    // which" contract as `getPersonProfile`.
    return null;
  }
  const personIds = links
    .filter((link) => link.owner_type === "person")
    .map((link) => link.owner_id);

  const namesByPersonId = new Map<string, string>();
  if (personIds.length > 0) {
    const { data: persons, error } = await client
      .from("person")
      .select("id, given_name, surname, nickname")
      .in("id", personIds);
    if (error !== null) {
      throw new Error(`getMediaDetail: person: ${error.message}`);
    }
    for (const person of persons ?? []) {
      namesByPersonId.set(person.id, personDisplayName(person));
    }
  }

  const media = mediaRes.data as MediaDbRow;

  return {
    id: media.id,
    title: media.title,
    originalFilename: media.original_filename,
    mimeType: media.mime_type,
    sizeBytes: media.size_bytes,
    date: pickDateColumns(media),
    storagePathDisplay: media.storage_path_display,
    storagePathOriginal: media.storage_path_original,
    links: links.map((link) => ({
      id: link.id,
      ownerType: link.owner_type,
      ownerId: link.owner_id,
      isPrimary: link.is_primary,
      caption: link.caption,
      personName:
        link.owner_type === "person"
          ? (namesByPersonId.get(link.owner_id) ?? null)
          : null,
    })),
  };
}

function personDisplayName(person: {
  readonly given_name: string | null;
  readonly surname: string | null;
  readonly nickname: string | null;
}): string {
  const full = [person.given_name, person.surname]
    .map((part) => part?.trim())
    .filter((part): part is string => part !== undefined && part !== "")
    .join(" ");
  return full !== "" ? full : person.nickname?.trim() || "Unknown person";
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
