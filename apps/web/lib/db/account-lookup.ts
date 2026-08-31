import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "./database.types";

type Db = SupabaseClient<Database>;

/**
 * A moderator can read any `account` row (RLS `account_select`:
 * `id = auth.uid() OR is_moderator()`), so resolving `updated_by` to a display
 * name for a `ConflictDialog` (SPEC §8.3, WAYFINDER decision 26) is a plain,
 * RLS-safe read — every caller of this is already gated to the moderator-only
 * edit view. Returns `null` for a null id (no attribution known — `note` and
 * `person_name` carry no `updated_by` column) or a display name that is
 * itself unset.
 */
export async function getAccountDisplayName(
  client: Db,
  accountId: string | null,
): Promise<string | null> {
  if (accountId === null) {
    return null;
  }

  const { data, error } = await client
    .from("account")
    .select("display_name")
    .eq("id", accountId)
    .maybeSingle();

  if (error !== null) {
    throw new Error(`getAccountDisplayName: ${error.message}`);
  }
  return data?.display_name ?? null;
}
