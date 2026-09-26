import { redirect } from "next/navigation";

import {
  resolveHomeDestination,
  resolveTreeFocusPersonId,
} from "@/lib/auth/auth-redirect";
import { getCurrentAccount } from "@/lib/auth/current-account";
import { getVisibleRootPersonId } from "@/lib/db";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * `/` is a pure router (SPEC §8.1): approved → the tree centred on their own
 * record (or the deployment's default root when their account is linked to no
 * person), signed-in-not-approved → onboarding, no session → login. It renders
 * nothing.
 *
 * The settings read is a loader rather than a value, so a linked member — the
 * common case — never issues it.
 */
export default async function Home() {
  const current = await getCurrentAccount();

  if (current === null) {
    redirect("/login");
  }

  const approved = current.account?.status === "active";
  const focusPersonId = approved
    ? await resolveTreeFocusPersonId(current.personId, async () =>
        getVisibleRootPersonId(await createSupabaseServerClient()),
      )
    : null;

  redirect(resolveHomeDestination({ signedIn: true, approved, focusPersonId }));
}
