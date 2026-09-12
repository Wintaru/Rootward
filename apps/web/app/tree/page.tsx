import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { isActiveModerator, isApproved } from "@/lib/auth/access";
import { getCurrentAccount } from "@/lib/auth/current-account";
import { getDefaultRootPersonId, getFallbackRootPersonId } from "@/lib/db";
import { createSupabaseServerClient } from "@/lib/supabase/server";

import { TreeEmptyState } from "./TreeEmptyState";

export const metadata: Metadata = {
  title: "Family tree · Rootward",
};

/**
 * `/tree` — the index (SPEC §8.1, issue #51). `/` sends an approved member
 * here when no default root is set, and the header's Home link can land here
 * too, so it must always resolve to something:
 *
 * 1. a root is set → `/tree/<root>`;
 * 2. no root but the tree has people → the deterministic fallback
 *    (`getFallbackRootPersonId`) → `/tree/<person>`;
 * 3. nobody visible → the empty state.
 *
 * The fallback query runs only when the root is unset — after the first import
 * (which sets the root, §7) this route is one settings read and a redirect.
 * Access mirrors `/tree/[personId]`: approved members only.
 */
export default async function TreeIndexPage() {
  // Any signed-in account may read `tree_settings`, so the root read runs
  // alongside the auth check (same shape as `/tree/[personId]`).
  const supabase = await createSupabaseServerClient();
  const [current, storedRootId] = await Promise.all([
    getCurrentAccount(),
    getDefaultRootPersonId(supabase),
  ]);

  if (current === null) {
    redirect("/login");
  }
  if (!isApproved(current.account)) {
    redirect("/onboarding");
  }

  const rootPersonId =
    storedRootId ?? (await getFallbackRootPersonId(supabase));

  if (rootPersonId !== null) {
    redirect(`/tree/${rootPersonId}`);
  }

  return <TreeEmptyState canImport={isActiveModerator(current.account)} />;
}
