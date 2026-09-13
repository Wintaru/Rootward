import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "./database.types";

type Db = SupabaseClient<Database>;

/**
 * "Ask a moderator to hide this record" (SPEC §5/§7, decisions 7/14/27, issue
 * #61). All of the authorization -- the caller must be linked to `personId`
 * themselves, or linked to one of that person's parents (decision 14's "hide
 * my child") -- and the dedup against an already-open request live in the
 * `request_hide` SQL function
 * (`supabase/migrations/20260913193000_request_hide.sql`), which also raises
 * the `hide_request` notification. Nothing here re-checks that; a caller who
 * isn't linked gets the function's own `insufficient_privilege` error.
 */
export async function requestHide(
  client: Db,
  personId: string,
  reason?: string,
): Promise<void> {
  const { error } = await client.rpc("request_hide", {
    p_person_id: personId,
    ...(reason !== undefined ? { p_reason: reason } : {}),
  });
  if (error !== null) {
    throw new Error(`requestHide: ${error.message}`);
  }
}
