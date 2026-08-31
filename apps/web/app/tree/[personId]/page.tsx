import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

import { isApproved } from "@/lib/auth/access";
import { getCurrentAccount } from "@/lib/auth/current-account";
import { getDefaultGenerations, getNeighborhood, isUuid } from "@/lib/db";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { FamilyTree } from "@/components/tree/FamilyTree";
import { toFamilyChartData } from "@/lib/tree/to-family-chart";
import { resolveTreeDepth } from "@/lib/tree/tree-view-params";

export const metadata: Metadata = {
  title: "Family tree · Rootward",
};

/**
 * `/tree/[personId]` — the hourglass view centred on one person (SPEC §8.1,
 * §8.2). Approved members only; a signed-in-but-pending visitor belongs on
 * `/onboarding`, an anonymous one on `/login`.
 *
 * The focus person is the route segment and the depth override is `?up` / `?down`
 * (WAYFINDER decision 28) — so a click re-centre and a depth change are both a
 * `router.push`, one `get_neighborhood` recursion per navigation, and the back
 * button walks the history. The `FamilyTree` client shell animates between the
 * old and new payloads.
 */
export default async function TreePage({
  params,
  searchParams,
}: PageProps<"/tree/[personId]">) {
  const { personId } = await params;

  // The depth defaults are the invariant `tree_settings` singleton — fetch them
  // alongside the auth check rather than after it.
  const supabase = await createSupabaseServerClient();
  const [current, defaults] = await Promise.all([
    getCurrentAccount(),
    getDefaultGenerations(supabase),
  ]);

  if (current === null) {
    redirect("/login");
  }
  if (!isApproved(current.account)) {
    redirect("/onboarding");
  }

  if (!isUuid(personId)) {
    notFound();
  }

  const depth = resolveTreeDepth(await searchParams, defaults);
  const neighborhood = await getNeighborhood(
    supabase,
    personId,
    depth.up,
    depth.down,
  );

  // Empty means the focus person does not exist or RLS hides them — a 404 to
  // the caller either way (never leak which).
  if (neighborhood.persons.length === 0) {
    notFound();
  }

  const tree = toFamilyChartData(neighborhood);

  return (
    <main className="flex flex-1 flex-col">
      <FamilyTree tree={tree} depth={depth} depthDefaults={defaults} />
    </main>
  );
}
