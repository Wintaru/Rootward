import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "./database.types";

type Db = SupabaseClient<Database>;

/**
 * Ids per `in (...)` request. PostgREST filters travel in the GET query
 * string, and a full-width 10-up / 10-down neighborhood can run to several
 * hundred UUIDs — past the gateway's request-line limit (~8 KB) and past
 * `max_rows` (1000, `supabase/config.toml`), which would silently truncate.
 * 100 ids ≈ 4 KB, comfortably inside both.
 */
const IDS_PER_REQUEST = 100;

/**
 * The tree card's photo lookup (SPEC §8.2, issue #105): for a set of person
 * ids, the `storage_path_thumb` of each person's primary photo
 * (`media_link.is_primary`, at most one per person by the
 * `media_link_one_primary_uidx` index). A person with no primary photo, or
 * whose primary photo has no thumb yet, is simply absent from the result — the
 * card falls back to the silhouette.
 *
 * One batched read per {@link IDS_PER_REQUEST} ids, never a query per card. Runs
 * under the caller's own session, so `media_link_select` RLS decides which
 * links come back — that is the visibility check `getSignedMediaUrls`
 * (`media-urls.ts`) relies on its callers having done, so a path from here is
 * safe to sign.
 *
 * Returns a plain object rather than a `Map` so the result can cross the
 * Server → Client Component boundary as a prop and come back from a server
 * action without a conversion at each edge.
 */
export async function getPrimaryPhotoThumbPaths(
  client: Db,
  personIds: readonly string[],
): Promise<Readonly<Record<string, string>>> {
  const chunks: string[][] = [];
  for (let i = 0; i < personIds.length; i += IDS_PER_REQUEST) {
    chunks.push(personIds.slice(i, i + IDS_PER_REQUEST));
  }

  const results = await Promise.all(
    chunks.map(async (ids) => {
      const { data, error } = await client
        .from("media_link")
        .select("owner_id, media:media_id(storage_path_thumb)")
        .eq("owner_type", "person")
        .eq("is_primary", true)
        .in("owner_id", ids);

      if (error !== null) {
        throw new Error(`getPrimaryPhotoThumbPaths: ${error.message}`);
      }
      return data ?? [];
    }),
  );

  return collectThumbPaths(results.flat());
}

/** The row shape `getPrimaryPhotoThumbPaths` selects — exported for the test. */
export interface PrimaryPhotoRow {
  readonly owner_id: string;
  readonly media: { readonly storage_path_thumb: string | null } | null;
}

/** Fold the joined rows into `personId → thumb path`, dropping rows with no
 * thumb (an upload `media-process` has not finished, or a link whose media
 * row RLS hid). Pure — the seam the unit test covers. */
export function collectThumbPaths(
  rows: readonly PrimaryPhotoRow[],
): Readonly<Record<string, string>> {
  const paths: Record<string, string> = {};
  for (const row of rows) {
    const thumb = row.media?.storage_path_thumb ?? null;
    if (thumb !== null) {
      paths[row.owner_id] = thumb;
    }
  }
  return paths;
}
