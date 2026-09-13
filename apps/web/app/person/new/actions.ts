"use server";

import { resolveEditAccess } from "@/lib/auth/require-moderator";
import { createPerson, type NewPerson } from "@/lib/db";
import { normalizeText } from "@/lib/edit/diff";
import { isSex } from "@/lib/edit/person-fields";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * "New person" (SPEC §8.1, §8.3, issue #55). Re-checks moderator access
 * independently of the page-level guard — same posture as every action in
 * `app/person/[personId]/edit/actions.ts`; `person_insert` RLS is the real
 * boundary. On success the caller (`NewPersonForm.tsx`) navigates to the new
 * person's edit view — that redirect happens client-side rather than inside
 * this action so the form can tell "created" apart from "something threw"
 * without a `NEXT_REDIRECT` in the mix.
 */
export type CreatePersonResult =
  | { readonly ok: true; readonly personId: string }
  | { readonly ok: false; readonly error: string };

export async function createPersonAction(input: {
  readonly givenName: string;
  readonly surname: string;
  readonly sex: string;
}): Promise<CreatePersonResult> {
  const access = await resolveEditAccess();
  if (access.kind !== "allowed") {
    return {
      ok: false,
      error: "You do not have permission to create a person.",
    };
  }

  const person: NewPerson = {
    givenName: normalizeText(input.givenName),
    surname: normalizeText(input.surname),
    sex: isSex(input.sex) ? input.sex : "unknown",
  };

  const supabase = await createSupabaseServerClient();
  const personId = await createPerson(supabase, person);
  return { ok: true, personId };
}
