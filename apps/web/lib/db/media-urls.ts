import "server-only";

import { createSupabaseServiceClient } from "@/lib/supabase/service";

/**
 * Signed URLs for the private `media` bucket (SPEC §4.4 / §8.3, §10 item 34).
 * The bucket's only `storage.objects` policy is `is_moderator()` (migration
 * `20260901111850_media_bucket.sql`), so an approved-but-non-moderator member
 * cannot read a media object with their own session — signing must run
 * server-side, past that policy, with the service role.
 *
 * This module is deliberately *not* the visibility check: every caller must
 * only pass paths that already came back from a query run under the caller's
 * own identity (`media_link_select` / `media_select` RLS), so a path this
 * function signs was already confirmed visible before it got here. Not
 * exported from the shared `@/lib/db` barrel — that barrel is imported by
 * Client Components for its types and browser-safe query functions, and
 * `server-only` throws a build error the moment a client bundle pulls this
 * module in.
 */

const MEDIA_BUCKET = "media";
/** Matches `gedcom-export`'s `SIGNED_URL_TTL_SECONDS` convention. */
const SIGNED_URL_TTL_SECONDS = 3600;

/** Sign every distinct non-null path in one batched call. Paths that fail to
 * sign (a dangling reference, a deleted object) are simply absent from the
 * result rather than failing the whole batch — a gallery with one broken
 * thumbnail should still render the rest. */
export async function getSignedMediaUrls(
  paths: readonly (string | null)[],
): Promise<ReadonlyMap<string, string>> {
  const uniquePaths = [
    ...new Set(paths.filter((path): path is string => path !== null)),
  ];
  if (uniquePaths.length === 0) {
    return new Map();
  }

  const service = createSupabaseServiceClient();
  const { data, error } = await service.storage
    .from(MEDIA_BUCKET)
    .createSignedUrls(uniquePaths, SIGNED_URL_TTL_SECONDS);

  if (error !== null) {
    throw new Error(`getSignedMediaUrls: ${error.message}`);
  }

  const map = new Map<string, string>();
  for (const entry of data) {
    if (entry.path !== null && entry.signedUrl !== null) {
      map.set(entry.path, entry.signedUrl);
    }
  }
  return map;
}

/** Single-path convenience wrapper over {@link getSignedMediaUrls}. */
export async function getSignedMediaUrl(
  path: string | null,
): Promise<string | null> {
  if (path === null) {
    return null;
  }
  const map = await getSignedMediaUrls([path]);
  return map.get(path) ?? null;
}
