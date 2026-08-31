import { redirect } from "next/navigation";

import { resolveHomeDestination } from "@/lib/auth/auth-redirect";
import { getCurrentAccount } from "@/lib/auth/current-account";
import { getDefaultRootPersonId } from "@/lib/db";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * `/` is a pure router (SPEC §8.1): approved → the tree, signed-in-not-approved
 * → onboarding, no session → login. It renders nothing.
 */
export default async function Home() {
  const current = await getCurrentAccount();

  if (current === null) {
    redirect("/login");
  }

  const approved = current.account?.status === "active";
  const rootPersonId = approved
    ? await getDefaultRootPersonId(await createSupabaseServerClient())
    : null;

  redirect(resolveHomeDestination({ signedIn: true, approved, rootPersonId }));
}
