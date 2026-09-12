import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "./database.types";

type Db = SupabaseClient<Database>;

/**
 * The person `/tree` opens on when `tree_settings.default_root_person_id` is
 * unset but the tree is not empty (SPEC §8.1, issue #51): a **deterministic**
 * pick — earliest `created_at`, then lowest `id` — among the people the caller
 * can see. Not "the first INDI": an import upserts persons in chunks, so a
 * whole chunk shares one `created_at` and the `id` (a uuidv5 hash) decides.
 * Runs under the caller's RLS, so a viewer is only ever sent to a person they
 * may open. Rarely hit after the first import, which sets the root (§7) — no
 * index on `created_at` yet; add one if this path becomes common.
 *
 * `null` means the tree is empty (or every person is hidden from this caller),
 * which is the empty-state branch for `/tree`. Read-only on purpose: persisting
 * the fallback would be a `tree_settings` write only an admin may make.
 */
export async function getFallbackRootPersonId(
  client: Db,
): Promise<string | null> {
  const { data, error } = await client
    .from("person")
    .select("id")
    .order("created_at", { ascending: true })
    .order("id", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (error !== null) {
    throw new Error(`getFallbackRootPersonId: ${error.message}`);
  }
  return data?.id ?? null;
}
