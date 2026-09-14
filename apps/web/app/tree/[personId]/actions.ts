"use server";

import { isApproved } from "@/lib/auth/access";
import { getCurrentAccount } from "@/lib/auth/current-account";
import { isUuid } from "@/lib/db";
import { getPrimaryPhotoUrls } from "@/lib/db/media-urls";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/** One `expand_relatives` step adds at most a couple of generations' worth of
 * people; anything past this is not a tree click, and the `in (...)` list
 * behind it would be needlessly long. */
const MAX_IDS_PER_CALL = 200;

/**
 * Photo URLs for the persons an expand-in-place step just added (issues #24,
 * #105). The expansion itself runs in the browser (`expandRelatives`), but a
 * signed URL can only be minted server-side (see `lib/db/media-urls.ts`), so
 * the client hands over the new person ids and gets `personId → URL` back.
 *
 * Ids, not paths, cross the boundary on purpose: the lookup re-runs under the
 * caller's own session, so RLS — not the client — decides which photos are
 * visible. A caller who is not an approved member gets nothing, which matches
 * what `/tree` itself would show them.
 */
export async function fetchPrimaryPhotoUrls(
  personIds: readonly string[],
): Promise<Readonly<Record<string, string>>> {
  // A server action's argument is wire input — validate its shape before the
  // (comparatively expensive) auth round trip.
  if (!Array.isArray(personIds)) {
    return {};
  }
  const validIds = personIds.filter(isUuid).slice(0, MAX_IDS_PER_CALL);
  if (validIds.length === 0) {
    return {};
  }

  const current = await getCurrentAccount();
  if (current === null || !isApproved(current.account)) {
    return {};
  }

  const supabase = await createSupabaseServerClient();
  return getPrimaryPhotoUrls(supabase, validIds);
}
