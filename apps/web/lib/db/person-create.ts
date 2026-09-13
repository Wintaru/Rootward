import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "./database.types";
import type { Sex } from "./types";

type Db = SupabaseClient<Database>;

/**
 * The site-created path into `person` (SPEC §8.1, §8.3, issue #55) — every
 * other row comes from the GEDCOM importer. A placeholder person (no name, no
 * events) is normal in genealogy, so every field here is optional; the caller
 * (`app/person/new/actions.ts`) is the one place that turns an empty form
 * field into `null` rather than an empty string. `gedcom_xref` stays null —
 * `gedcom-export` assigns one on first export (§4.2).
 */
export interface NewPerson {
  readonly givenName: string | null;
  readonly surname: string | null;
  readonly sex: Sex;
}

/**
 * Insert a new `person` row and return its id. RLS (`person_insert`) requires
 * an active moderator — the caller re-checks that itself for a clean error
 * message, but RLS is the real boundary.
 */
export async function createPerson(
  client: Db,
  person: NewPerson,
): Promise<string> {
  const { data, error } = await client
    .from("person")
    .insert({
      given_name: person.givenName,
      surname: person.surname,
      sex: person.sex,
    })
    .select("id")
    .single();

  if (error !== null) {
    throw new Error(`createPerson: ${error.message}`);
  }
  return data.id;
}
