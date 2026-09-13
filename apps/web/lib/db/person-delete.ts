import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "./database.types";

type Db = SupabaseClient<Database>;

/**
 * The edit view's Name & Gender "danger zone" delete (SPEC §8.3, WAYFINDER
 * decision 18, issue #59). All of the cascade logic — the polymorphic
 * citation/media_link/note cleanup a plain FK cannot reach, the family
 * partner-slot null-out, the account unlink — lives in the `delete_person`
 * SQL function (`supabase/migrations/20260913190832_delete_person.sql`), run
 * as one round trip so the delete is atomic: either everything commits, or
 * nothing does. `person_delete` RLS (`is_admin()`) is still enforced inside
 * the function itself, ahead of any row it touches — not relied on here as
 * the boundary, since the function's own `is_admin()` check is what keeps a
 * moderator's call from partially stripping a still-living person's rows
 * before failing (see the function's doc comment).
 *
 * Returns `false` if the person was already gone (a concurrent delete, or a
 * stale page) — treated as a benign no-op by the caller, not an error.
 */
export async function deletePerson(
  client: Db,
  personId: string,
): Promise<boolean> {
  const { data, error } = await client.rpc("delete_person", {
    p_person_id: personId,
  });

  if (error !== null) {
    throw new Error(`deletePerson: ${error.message}`);
  }
  return data;
}
