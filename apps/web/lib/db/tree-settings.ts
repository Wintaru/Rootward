import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "./database.types";

type Db = SupabaseClient<Database>;

/** The singleton `tree_settings` row always has id 1 (CHECK, migration #7). */
const TREE_SETTINGS_ID = 1;

/**
 * The person the tree view opens on (SPEC §4.6, decision 21). `null` on a fresh
 * deployment with no data yet. Any signed-in account may read `tree_settings`
 * (RLS `tree_settings_select`).
 */
export async function getDefaultRootPersonId(
  client: Db,
): Promise<string | null> {
  const { data, error } = await client
    .from("tree_settings")
    .select("default_root_person_id")
    .eq("id", TREE_SETTINGS_ID)
    .maybeSingle();

  if (error !== null) {
    throw new Error(`getDefaultRootPersonId: ${error.message}`);
  }
  return data?.default_root_person_id ?? null;
}
