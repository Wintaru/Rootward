import type { SupabaseClient } from "@supabase/supabase-js";
import type { MediaDerivatives, MediaTransform } from "@rootward/media";

import type { Database } from "./database.types";
import { MEDIA_BUCKET } from "./media-edit";

type Db = SupabaseClient<Database>;

/**
 * Rotate/crop persistence (SPEC §4.4, §8.3; migration
 * `20260914170500_media_transform.sql`). The browser regenerates the
 * thumb/display pair from the original with the transform applied
 * (`lib/media/regenerate.ts`) and uploads it here under a fresh random
 * `token`; the server action then repoints the row at the new objects with
 * a version-checked update and removes the superseded ones. New paths --
 * not an overwrite of `thumb.webp` -- because the signed URL's path is the
 * browser's cache key (see DECISIONS.md, 2026-09-14 17:04).
 *
 * The client never sends a storage path: it sends the token, and both
 * sides derive the paths from {@link derivativePaths}, so a caller cannot
 * point a row at an object it did not just produce for this media id.
 */

export interface DerivativePaths {
  readonly thumb: string;
  readonly display: string;
}

export function derivativePaths(
  mediaId: string,
  token: string,
): DerivativePaths {
  return {
    thumb: `${mediaId}/thumb-${token}.webp`,
    display: `${mediaId}/display-${token}.webp`,
  };
}

/** Browser side: write both derivatives under the moderator's own session
 * (the bucket's `media_moderator_all` policy), same direct upload
 * `uploadMediaOriginal` does for a staging file. If either upload fails the
 * other is removed again before rethrowing -- nothing references these
 * paths yet, so a half-written pair would otherwise be orphaned for good. */
export async function uploadMediaDerivatives(
  client: Db,
  paths: DerivativePaths,
  derivatives: MediaDerivatives,
): Promise<void> {
  const bucket = client.storage.from(MEDIA_BUCKET);
  const results = await Promise.all([
    bucket.upload(paths.thumb, derivatives.thumb, {
      contentType: "image/webp",
    }),
    bucket.upload(paths.display, derivatives.display, {
      contentType: "image/webp",
    }),
  ]);
  const failed = results.find(({ error }) => error !== null);
  if (failed?.error) {
    await bucket.remove([paths.thumb, paths.display]);
    throw new Error(`uploadMediaDerivatives: ${failed.error.message}`);
  }
}

export type ApplyMediaTransformResult =
  | {
      readonly ok: true;
      /** The derivative objects the row pointed at before -- for the caller
       * to remove once the update has landed. */
      readonly replacedPaths: readonly string[];
    }
  | { readonly ok: false; readonly reason: "conflict" };

/**
 * Store `transform` and repoint the row at `paths`, guarded on the row still
 * being at `expectedUpdatedAt` (decision 26). Two round trips: read the
 * current derivative paths, then the guarded update. A lost guard is
 * reported as a conflict for the caller to explain, not retried -- the
 * derivatives it just uploaded were built against a transform someone else
 * may have changed.
 */
export async function applyMediaTransform(
  client: Db,
  args: {
    readonly mediaId: string;
    readonly expectedUpdatedAt: string;
    readonly transform: MediaTransform;
    readonly paths: DerivativePaths;
  },
): Promise<ApplyMediaTransformResult> {
  const before = await client
    .from("media")
    .select("storage_path_thumb, storage_path_display")
    .eq("id", args.mediaId)
    .eq("updated_at", args.expectedUpdatedAt)
    .maybeSingle();
  if (before.error !== null) {
    throw new Error(`applyMediaTransform: read: ${before.error.message}`);
  }
  if (before.data === null) {
    return { ok: false, reason: "conflict" };
  }

  const { crop } = args.transform;
  const updated = await client
    .from("media")
    .update({
      rotation: args.transform.rotation,
      crop_x: crop?.x ?? null,
      crop_y: crop?.y ?? null,
      crop_width: crop?.width ?? null,
      crop_height: crop?.height ?? null,
      storage_path_thumb: args.paths.thumb,
      storage_path_display: args.paths.display,
    })
    .eq("id", args.mediaId)
    .eq("updated_at", args.expectedUpdatedAt)
    .select("id")
    .maybeSingle();
  if (updated.error !== null) {
    throw new Error(`applyMediaTransform: update: ${updated.error.message}`);
  }
  if (updated.data === null) {
    return { ok: false, reason: "conflict" };
  }

  return {
    ok: true,
    replacedPaths: [
      before.data.storage_path_thumb,
      before.data.storage_path_display,
    ].filter((path): path is string => path !== null),
  };
}
