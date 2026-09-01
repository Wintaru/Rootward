import { FunctionsHttpError, type SupabaseClient } from "@supabase/supabase-js";

import type { RowConflict } from "./conflict";
import type { Database } from "./database.types";
import type { MediaOwner } from "./types";

type Db = SupabaseClient<Database>;

/**
 * The Media section (SPEC §8.3, §4.4, §10 item 34) — upload, caption, reorder,
 * delete, and primary-photo over `media_link` rows owned by the person.
 * WAYFINDER decision 25's "referenced from many places" model lets a
 * `media_link` name an event / fact / family / source / place owner too, but
 * the edit view only ever creates person-owned links — narrower than the
 * full enum, same scoping call as `note-edit.ts`'s `SectionNoteOwner`.
 *
 * Uploading is not part of this module's version-checked save batch: the
 * moderator's browser client uploads the original straight to the `media`
 * bucket's staging key and invokes `media-process` (SPEC §7, issue #33),
 * which validates, derives the thumb/display WebP pair, and inserts the
 * `media` + `media_link` rows itself in one call — there is nothing left for
 * this module to insert. Only caption / sort order / delete on an *existing*
 * link go through {@link saveMediaLinks}'s diffed, version-checked save
 * (WAYFINDER decision 26); setting the primary photo is its own action
 * ({@link setPrimaryMedia}) rather than a field in that diff, because the
 * partial-unique-index invariant ("at most one primary per owner") needs an
 * unset-then-set pair, not a single per-row version-checked patch.
 *
 * Reads run under the caller's identity (RLS `media_link_select` /
 * `media_select`); writes go through `media_link_write` (`is_moderator()`).
 * Deleting a link only detaches it — the underlying `media` row (and its
 * storage objects) may still be referenced by another owner, so this never
 * deletes `media` itself (see `DECISIONS.md`).
 */

export const MEDIA_BUCKET = "media";

/** `media_owner` has 6 values (SPEC §4.4) — this section's queries only ever
 * fetch/write `owner_type = 'person'`. Narrowing to that one value here (same
 * pattern as `SectionNoteOwner`) makes the other 5 unrepresentable in this
 * module. */
export type SectionMediaOwner = Extract<MediaOwner, "person">;

export interface MediaEditRow {
  /** `media_link` id — the attachment, not the underlying media row. */
  readonly id: string;
  readonly updatedAt: string;
  readonly mediaId: string;
  readonly ownerType: SectionMediaOwner;
  readonly ownerId: string;
  readonly caption: string | null;
  readonly isPrimary: boolean;
  readonly sortOrder: number | null;
  readonly originalFilename: string | null;
  readonly mimeType: string | null;
  readonly title: string | null;
  readonly storagePathThumb: string | null;
  readonly storagePathDisplay: string | null;
}

const MEDIA_LINK_COLUMNS =
  "id, media_id, owner_type, owner_id, caption, is_primary, sort_order, updated_at, media:media_id(original_filename, mime_type, title, storage_path_thumb, storage_path_display)";

type MediaLinkDbRow = {
  id: string;
  media_id: string;
  owner_type: SectionMediaOwner;
  owner_id: string;
  caption: string | null;
  is_primary: boolean;
  sort_order: number | null;
  updated_at: string;
  media: {
    original_filename: string | null;
    mime_type: string | null;
    title: string | null;
    storage_path_thumb: string | null;
    storage_path_display: string | null;
  } | null;
};

function mapMediaLinkRow(row: MediaLinkDbRow): MediaEditRow {
  return {
    id: row.id,
    updatedAt: row.updated_at,
    mediaId: row.media_id,
    ownerType: row.owner_type,
    ownerId: row.owner_id,
    caption: row.caption,
    isPrimary: row.is_primary,
    sortOrder: row.sort_order,
    originalFilename: row.media?.original_filename ?? null,
    mimeType: row.media?.mime_type ?? null,
    title: row.media?.title ?? null,
    storagePathThumb: row.media?.storage_path_thumb ?? null,
    storagePathDisplay: row.media?.storage_path_display ?? null,
  };
}

/** Load every media attached directly to `personId`, primary first. */
export async function getPersonMedia(
  client: Db,
  personId: string,
): Promise<readonly MediaEditRow[]> {
  const { data, error } = await client
    .from("media_link")
    .select(MEDIA_LINK_COLUMNS)
    .eq("owner_type", "person")
    .eq("owner_id", personId)
    .order("is_primary", { ascending: false })
    .order("sort_order", { ascending: true, nullsFirst: false })
    .order("created_at", { ascending: true });

  if (error !== null) {
    throw new Error(`getPersonMedia: ${error.message}`);
  }
  return (data ?? []).map((row) => mapMediaLinkRow(row as MediaLinkDbRow));
}

/**
 * Fetch the `media_link` row `media-process` just inserted — the function's
 * response carries only `mediaId` (SPEC §7), not the link's own id, so the
 * section needs this to append the new row to its list. `media-process`
 * inserts exactly one link per call for the `(ownerType, ownerId)` pair it
 * was given, so the most recently created match is unambiguous.
 */
export async function getMediaLinkByMediaId(
  client: Db,
  args: {
    readonly mediaId: string;
    readonly ownerType: SectionMediaOwner;
    readonly ownerId: string;
  },
): Promise<MediaEditRow> {
  const { data, error } = await client
    .from("media_link")
    .select(MEDIA_LINK_COLUMNS)
    .eq("media_id", args.mediaId)
    .eq("owner_type", args.ownerType)
    .eq("owner_id", args.ownerId)
    .order("created_at", { ascending: false })
    .limit(1)
    .single();

  if (error !== null) {
    throw new Error(`getMediaLinkByMediaId: ${error.message}`);
  }
  return mapMediaLinkRow(data as MediaLinkDbRow);
}

// --- upload + process ------------------------------------------------------

function stagingExtension(filename: string, mimeType: string): string {
  const dot = filename.lastIndexOf(".");
  const fromName = dot > 0 ? filename.slice(dot + 1) : "";
  if (fromName !== "") {
    return fromName.toLowerCase();
  }
  const fromMime = mimeType.split("/").pop();
  return fromMime !== undefined && fromMime !== "" ? fromMime : "bin";
}

/**
 * Upload the chosen file to a fresh staging key in the private `media`
 * bucket — the moderator's own session, mirroring `uploadGedcomFile`'s
 * upload-before-invoke shape. A random key (not the job/person id) because a
 * person can upload many photos in one sitting; `media-process` removes the
 * staging object once it has read it.
 */
export async function uploadMediaOriginal(
  client: Db,
  file: File,
): Promise<{ readonly stagingPath: string }> {
  const stagingPath = `staging/${crypto.randomUUID()}.${stagingExtension(file.name, file.type)}`;
  const { error } = await client.storage
    .from(MEDIA_BUCKET)
    .upload(stagingPath, file, { contentType: file.type || undefined });

  if (error !== null) {
    throw new Error(`uploadMediaOriginal: ${error.message}`);
  }
  return { stagingPath };
}

export type MediaProcessOutcome =
  | {
      readonly status: "processed";
      readonly mediaId: string;
      readonly hasDerivatives: boolean;
      readonly warnings: readonly string[];
    }
  | { readonly status: "rejected"; readonly reason: "size" | "mime" };

/**
 * Invoke `media-process` (SPEC §7, issue #33) with the moderator's own JWT —
 * same direct-from-browser-client call as `invokeGedcomImport`. Synchronous:
 * unlike the GEDCOM import job, there is no polling — the function validates,
 * derives, and inserts in one request/response.
 *
 * A "rejected" outcome (oversize / disallowed MIME) comes back as a non-2xx
 * HTTP response (SPEC §7's `index.ts` returns 422), which `functions.invoke`
 * surfaces as a `FunctionsHttpError` rather than in `data` — the reason is
 * read back off `error.context`, the raw `Response`, so the caller still gets
 * the structured outcome instead of a generic failure message.
 */
export async function invokeMediaProcess(
  client: Db,
  input: {
    readonly ownerType: SectionMediaOwner;
    readonly ownerId: string;
    readonly stagingPath: string;
    readonly originalFilename: string;
  },
): Promise<MediaProcessOutcome> {
  const { data, error } = await client.functions.invoke("media-process", {
    body: input,
  });

  if (error !== null) {
    if (error instanceof FunctionsHttpError) {
      const body = (await error.context
        .json()
        .catch(() => null)) as MediaProcessOutcome | null;
      if (body !== null && body.status === "rejected") {
        return body;
      }
    }
    throw new Error(`invokeMediaProcess: ${error.message}`);
  }
  return data as MediaProcessOutcome;
}

// --- save diff (caption / sort order / delete) -----------------------------

export interface MediaLinkUpdateInput {
  readonly id: string;
  readonly expectedUpdatedAt: string;
  readonly patch: {
    readonly caption?: string | null;
    readonly sortOrder?: number;
  };
}

export interface MediaLinkDeleteInput {
  readonly id: string;
  readonly expectedUpdatedAt: string;
}

export interface SaveMediaLinksResult {
  readonly updated: readonly MediaEditRow[];
  readonly deletedIds: readonly string[];
  readonly conflicts: readonly RowConflict<MediaEditRow>[];
}

/** Refetch a `media_link` row's current state (ignoring `updated_at`) for the
 * `ConflictDialog` — `null` if the row is gone. `media_link` carries no
 * `updated_by` column, so `changedBy` is always `null`, same as `note`. */
async function resolveMediaLinkConflict(
  client: Db,
  id: string,
): Promise<RowConflict<MediaEditRow>> {
  const { data, error } = await client
    .from("media_link")
    .select(MEDIA_LINK_COLUMNS)
    .eq("id", id)
    .maybeSingle();

  if (error !== null) {
    throw new Error(`resolveMediaLinkConflict: ${id}: ${error.message}`);
  }
  return data === null
    ? { id, theirs: null, changedBy: null }
    : { id, theirs: mapMediaLinkRow(data as MediaLinkDbRow), changedBy: null };
}

/**
 * Apply the Media diff: each version-checked caption/sort-order update, each
 * version-checked delete (detach only — see the module doc). One round trip
 * per row (decision 26), not transactional across rows, same shape as
 * `saveNotes`.
 */
export async function saveMediaLinks(
  client: Db,
  args: {
    readonly updates: readonly MediaLinkUpdateInput[];
    readonly deletes: readonly MediaLinkDeleteInput[];
  },
): Promise<SaveMediaLinksResult> {
  const [updateResults, deleteResults] = await Promise.all([
    Promise.all(
      args.updates.map((input) => applyMediaLinkUpdate(client, input)),
    ),
    Promise.all(
      args.deletes.map((input) => applyMediaLinkDelete(client, input)),
    ),
  ]);

  const updated: MediaEditRow[] = [];
  const conflicts: RowConflict<MediaEditRow>[] = [];
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

  return { updated, deletedIds, conflicts };
}

type RowResult =
  | { readonly ok: true; readonly row: MediaEditRow }
  | { readonly ok: false; readonly conflict: RowConflict<MediaEditRow> };

async function applyMediaLinkUpdate(
  client: Db,
  input: MediaLinkUpdateInput,
): Promise<RowResult> {
  const patch: Database["public"]["Tables"]["media_link"]["Update"] = {};
  if (input.patch.caption !== undefined) {
    patch.caption = input.patch.caption;
  }
  if (input.patch.sortOrder !== undefined) {
    patch.sort_order = input.patch.sortOrder;
  }

  const { data, error } = await client
    .from("media_link")
    .update(patch)
    .eq("id", input.id)
    .eq("updated_at", input.expectedUpdatedAt)
    .select(MEDIA_LINK_COLUMNS)
    .maybeSingle();

  if (error !== null) {
    throw new Error(`saveMediaLinks: update ${input.id}: ${error.message}`);
  }
  if (data !== null) {
    return { ok: true, row: mapMediaLinkRow(data as MediaLinkDbRow) };
  }
  return {
    ok: false,
    conflict: await resolveMediaLinkConflict(client, input.id),
  };
}

async function applyMediaLinkDelete(
  client: Db,
  input: MediaLinkDeleteInput,
): Promise<
  | { readonly ok: true; readonly id: string }
  | { readonly ok: false; readonly conflict: RowConflict<MediaEditRow> }
> {
  const { data, error } = await client
    .from("media_link")
    .delete()
    .eq("id", input.id)
    .eq("updated_at", input.expectedUpdatedAt)
    .select("id")
    .maybeSingle();

  if (error !== null) {
    throw new Error(`saveMediaLinks: delete ${input.id}: ${error.message}`);
  }
  if (data !== null) {
    return { ok: true, id: input.id };
  }
  return {
    ok: false,
    conflict: await resolveMediaLinkConflict(client, input.id),
  };
}

// --- primary photo ----------------------------------------------------------

export interface SetPrimaryMediaResult {
  /** Every row this call actually changed — the previous primary(s) that got
   * cleared, plus the newly set one — each with its post-update `updated_at`.
   * The `set_updated_at` trigger bumps `updated_at` unconditionally on every
   * UPDATE (no `WHEN` clause), so the caller's cached baseline for both rows
   * goes stale the moment this runs; returning the fresh rows lets
   * `MediaSection.tsx` fold them back in through `reconcileMediaLinksAfterSave`
   * instead of hand-flipping `isPrimary` and leaving `updatedAt` stale (which
   * would fail the next version-checked save on either row with a spurious
   * conflict, misattributed to "someone else changed this").
   */
  readonly updated: readonly MediaEditRow[];
}

/**
 * Set `mediaLinkId` as the owner's primary photo, unsetting whichever link
 * currently holds it (SPEC §10 item 34's "setting a new primary photo unsets
 * the old one"). Two sequential updates, not one transaction — Supabase's
 * client has no cross-statement transaction, same documented limitation as
 * every other multi-step save in this app — but the partial unique index
 * (`media_link_one_primary_uidx`) still rejects a second `is_primary = true`
 * row outright if this ever raced with another moderator's click, so the
 * invariant itself never breaks even though the two steps aren't atomic.
 * Both steps are scoped to `(ownerType, ownerId)`, matching each other, so a
 * `mediaLinkId` that does not belong to this owner can never flip an
 * unrelated owner's link to primary.
 *
 * Not version-checked against the *caller's* prior read: any moderator
 * re-clicking "Set as primary" is a reasonable outcome, and modelling this as
 * a `ConflictDialog`-worthy boolean toggle would be over-engineering a
 * one-click action (see `DECISIONS.md`). It does still check that the target
 * row actually existed to update — a concurrent delete of `mediaLinkId`
 * (another moderator's "Remove") must not silently leave the owner with no
 * primary at all while the caller believes it succeeded.
 */
export async function setPrimaryMedia(
  client: Db,
  args: {
    readonly ownerType: SectionMediaOwner;
    readonly ownerId: string;
    readonly mediaLinkId: string;
  },
): Promise<SetPrimaryMediaResult> {
  const { data: cleared, error: clearError } = await client
    .from("media_link")
    .update({ is_primary: false })
    .eq("owner_type", args.ownerType)
    .eq("owner_id", args.ownerId)
    .eq("is_primary", true)
    .neq("id", args.mediaLinkId)
    .select(MEDIA_LINK_COLUMNS);

  if (clearError !== null) {
    throw new Error(`setPrimaryMedia: clear: ${clearError.message}`);
  }

  const { data: set, error: setError } = await client
    .from("media_link")
    .update({ is_primary: true })
    .eq("id", args.mediaLinkId)
    .eq("owner_type", args.ownerType)
    .eq("owner_id", args.ownerId)
    .select(MEDIA_LINK_COLUMNS)
    .maybeSingle();

  if (setError !== null) {
    throw new Error(`setPrimaryMedia: set: ${setError.message}`);
  }
  if (set === null) {
    throw new Error(
      `setPrimaryMedia: ${args.mediaLinkId} no longer exists for this owner`,
    );
  }

  return {
    updated: [
      ...(cleared ?? []).map((row) => mapMediaLinkRow(row as MediaLinkDbRow)),
      mapMediaLinkRow(set as MediaLinkDbRow),
    ],
  };
}
