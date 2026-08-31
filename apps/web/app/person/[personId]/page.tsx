import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

import { isActiveModerator, isApproved } from "@/lib/auth/access";
import { getCurrentAccount } from "@/lib/auth/current-account";
import { getPersonProfile } from "@/lib/db";
import { buildPersonProfileView } from "@/lib/person/view-model";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { PersonProfile } from "@/components/person/PersonProfile";

export const metadata: Metadata = {
  title: "Profile · Rootward",
};

/**
 * `/person/[personId]` — the read-only profile (SPEC §8.1, §10 item 25).
 * Approved members only; a signed-in-but-pending visitor belongs on
 * `/onboarding`, an anonymous one on `/login` — the same guard as `/tree`.
 *
 * RLS is the real boundary: `getPersonProfile` reads under the caller's identity,
 * so a hidden person and an absent one both come back as `null` → `notFound()`
 * (never leak which). The "Edit" link is shown to moderators+ only, matching the
 * `/person/[personId]/edit` route's own gate (that route 404s until Phase 5).
 */
export default async function PersonPage({
  params,
}: PageProps<"/person/[personId]">) {
  const { personId } = await params;

  const current = await getCurrentAccount();
  if (current === null) {
    redirect("/login");
  }
  if (!isApproved(current.account)) {
    redirect("/onboarding");
  }

  const supabase = await createSupabaseServerClient();
  const data = await getPersonProfile(supabase, personId);
  if (data === null) {
    notFound();
  }

  return (
    <PersonProfile
      view={buildPersonProfileView(data)}
      canEdit={isActiveModerator(current.account)}
    />
  );
}
