import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { isActiveModerator, isApproved } from "@/lib/auth/access";
import { getCurrentAccount } from "@/lib/auth/current-account";
import { getFallbackRootPersonId, getVisibleRootPersonId } from "@/lib/db";
import { createSupabaseServerClient } from "@/lib/supabase/server";

import { TreeEmptyState } from "./TreeEmptyState";

export const metadata: Metadata = {
  title: "Family tree · Rootward",
};

/**
 * `/tree` — the index (SPEC §8.1, issues #51, #82). `/` sends an approved
 * member here when no default root is set (or the set root is hidden from
 * them), and the header's Home link can land here too, so it must always
 * resolve to something:
 *
 * 1. a root is set and visible to this caller → `/tree/<root>`;
 * 2. no root, or the root is hidden from this caller → the deterministic
 *    fallback (`getFallbackRootPersonId`) → `/tree/<person>`;
 * 3. nobody visible → the empty state.
 *
 * The fallback query runs only when no visible root comes back — after the
 * first import (which sets the root, §7) this route is one settings read and
 * a redirect. `/` re-reads the same visible-root settings row before landing
 * here with a hidden or unset root, so that case costs two round trips
 * end-to-end — accepted for now since it only matters until an admin picks a
 * root every member can see. Access mirrors `/tree/[personId]`: approved
 * members only.
 */
export default async function TreeIndexPage() {
  // Any signed-in account may read `tree_settings`, so the root read runs
  // alongside the auth check (same shape as `/tree/[personId]`).
  const supabase = await createSupabaseServerClient();
  const [current, visibleRootId] = await Promise.all([
    getCurrentAccount(),
    getVisibleRootPersonId(supabase),
  ]);

  if (current === null) {
    redirect("/login");
  }
  if (!isApproved(current.account)) {
    redirect("/onboarding");
  }

  const rootPersonId =
    visibleRootId ?? (await getFallbackRootPersonId(supabase));

  if (rootPersonId !== null) {
    redirect(`/tree/${rootPersonId}`);
  }

  return <TreeEmptyState canImport={isActiveModerator(current.account)} />;
}
