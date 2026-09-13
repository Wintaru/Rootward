import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "./database.types";

type Db = SupabaseClient<Database>;

/** The private bucket `media-process` writes processed objects into
 * (`20260901111850_media_bucket.sql`); `media.storage_path_*` are already
 * bucket-relative keys (`<media id>/original.<ext>`, …), the same shape
 * `media-process/gateway.ts` writes. */
const MEDIA_BUCKET = "media";

/** PostgREST's `max_rows` (`supabase/config.toml`) caps any unpaginated
 * `select` at 1000 — {@link getAllMediaStoragePaths} pages at this size so a
 * tree with more media than that does not silently lose the remainder. */
const MEDIA_READ_PAGE_SIZE = 1000;

/**
 * How many people are in the tree right now (SPEC §7, §8.1, issue #60) — the
 * emptiness check `/import` blocks a re-import on, and the count
 * `WipeTreeSection.tsx` shows in its confirmation copy. Runs under the
 * caller's own RLS (`person_select`); the only callers are moderator+ routes,
 * and `person_is_visible` grants `is_moderator()` full visibility regardless
 * of a row's own visibility, so the count is always the true total for them.
 */
export async function getPersonCount(client: Db): Promise<number> {
  const { count, error } = await client
    .from("person")
    .select("*", { count: "exact", head: true });

  if (error !== null) {
    throw new Error(`getPersonCount: ${error.message}`);
  }
  return count ?? 0;
}

/**
 * Every storage path the `media` bucket holds for a still-uploaded asset
 * (SPEC §4.4, §7, issue #60) — read off `media` in pages of
 * {@link MEDIA_READ_PAGE_SIZE} (PostgREST's `max_rows` caps a single
 * unpaginated `select` there) before {@link wipeTree} deletes those rows,
 * since that is the only place they are recorded. A storage object without a
 * matching `media` row (an abandoned `media/staging/<token>.<ext>` upload,
 * SPEC §7) is not returned — it is not genealogy data and `media-process`
 * already cleans up its own staging key on a normal run.
 *
 * Runs under the caller's own session: the bucket's only `storage.objects`
 * policy (`media_moderator_all`) already grants a moderator+ full access, so
 * this needs no service role.
 *
 * Deliberately separate from the removal itself ({@link removeMediaStorageObjects})
 * — `wipeTreeAction` calls this first, then {@link wipeTree}, then the
 * removal, so a failure calling `wipe_tree` leaves storage completely
 * untouched (safe to retry), and a failure removing storage after a
 * successful DB wipe only leaves harmless orphaned objects rather than
 * breaking still-referenced media.
 */
export async function getAllMediaStoragePaths(client: Db): Promise<string[]> {
  const paths: string[] = [];
  let from = 0;
  for (;;) {
    const { data, error } = await client
      .from("media")
      .select("storage_path_original, storage_path_thumb, storage_path_display")
      .order("id", { ascending: true })
      .range(from, from + MEDIA_READ_PAGE_SIZE - 1);

    if (error !== null) {
      throw new Error(`getAllMediaStoragePaths: ${error.message}`);
    }
    paths.push(...collectMediaStoragePaths(data));
    if (data.length < MEDIA_READ_PAGE_SIZE) {
      return paths;
    }
    from += MEDIA_READ_PAGE_SIZE;
  }
}

/** Remove a batch of previously-read paths from the `media` bucket. A no-op
 * for an empty list, so a caller need not special-case a tree with no media. */
export async function removeMediaStorageObjects(
  client: Db,
  paths: readonly string[],
): Promise<void> {
  if (paths.length === 0) {
    return;
  }
  const { error } = await client.storage.from(MEDIA_BUCKET).remove([...paths]);
  if (error !== null) {
    throw new Error(`removeMediaStorageObjects: ${error.message}`);
  }
}

/** Every non-null storage path across a batch of `media` rows' three
 * columns, in one flat list for a single `storage.remove` call. Exported for
 * tests. */
export function collectMediaStoragePaths(
  rows: readonly {
    readonly storage_path_original: string | null;
    readonly storage_path_thumb: string | null;
    readonly storage_path_display: string | null;
  }[],
): string[] {
  return rows.flatMap((row) =>
    [
      row.storage_path_original,
      row.storage_path_thumb,
      row.storage_path_display,
    ].filter((path): path is string => path !== null),
  );
}

/**
 * Admin-only hard reset of the tree (SPEC §7, §8.1, decisions 18/33, issue
 * #60): every person, family, event, fact, name, place, source, repository,
 * citation, media, media_link, and note row is gone. Every account survives
 * with `person_id` set to null (the FK's own "on delete set null"),
 * `tree_settings` survives with its `default_root_person_id` cleared the same
 * way, and every notification / import_job / export_job row is untouched.
 * All of that lives in the `wipe_tree` SQL function
 * (`supabase/migrations/20260913191500_wipe_tree.sql`) — the function's own
 * `is_admin()` check is the real boundary, not RLS or this caller. Does not
 * touch storage — `wipeTreeAction` reads {@link getAllMediaStoragePaths}
 * first (before `media` rows are gone), then calls this, then
 * {@link removeMediaStorageObjects} — see that function's doc comment for why
 * the removal happens last.
 */
export async function wipeTree(client: Db): Promise<void> {
  const { error } = await client.rpc("wipe_tree");
  if (error !== null) {
    throw new Error(`wipeTree: ${error.message}`);
  }
}
