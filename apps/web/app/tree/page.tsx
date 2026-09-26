import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { isActiveModerator, isApproved } from "@/lib/auth/access";
import { resolveTreeFocusPersonId } from "@/lib/auth/auth-redirect";
import { getCurrentAccount } from "@/lib/auth/current-account";
import { getFallbackRootPersonId, getVisibleRootPersonId } from "@/lib/db";
import { createSupabaseServerClient } from "@/lib/supabase/server";

import { TreeEmptyState } from "./TreeEmptyState";

export const metadata: Metadata = {
  title: "Family tree · Rootward",
};

/**
 * `/tree` — the index (SPEC §8.1, issues #51, #82). `/` sends an approved
 * member here when nothing is left to centre the tree on, and the header's
 * Home link can land here too, so it must always resolve to something:
 *
 * 1. the caller's own record → `/tree/<self>`, the rule `/` applies as well
 *    (`resolveTreeFocusPersonId`, which both routes share);
 * 2. no linked person, but a root is set and visible to this caller →
 *    `/tree/<root>`;
 * 3. no root, or the root is hidden from this caller → the deterministic
 *    fallback (`getFallbackRootPersonId`) → `/tree/<person>`;
 * 4. nobody visible → the empty state.
 *
 * Each read runs only when the one above it came back empty, so a linked
 * member costs nothing beyond the auth lookup they already needed, and an
 * unlinked one is a settings read and a redirect. That serialises the settings
 * read behind the auth check, where it used to run alongside it. Worth it: the
 * common case now issues no settings read at all, and the members who pay the
 * extra serial round trip are the moderators and admins, who are the ones with
 * no record of their own. Access mirrors `/tree/[personId]`: approved members
 * only.
 */
export default async function TreeIndexPage() {
  const current = await getCurrentAccount();

  if (current === null) {
    redirect("/login");
  }
  if (!isApproved(current.account)) {
    redirect("/onboarding");
  }

  // In-process, no round trip — both loaders below need it, and neither runs
  // for a linked member.
  const supabase = await createSupabaseServerClient();
  const focusPersonId = await resolveTreeFocusPersonId(
    current.personId,
    () => getVisibleRootPersonId(supabase),
    () => getFallbackRootPersonId(supabase),
  );

  if (focusPersonId !== null) {
    redirect(`/tree/${focusPersonId}`);
  }

  return <TreeEmptyState canImport={isActiveModerator(current.account)} />;
}
