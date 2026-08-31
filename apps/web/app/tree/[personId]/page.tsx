import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

import { isApproved } from "@/lib/auth/access";
import { getCurrentAccount } from "@/lib/auth/current-account";
import { getNeighborhood, isUuid } from "@/lib/db";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { FamilyTree } from "@/components/tree/FamilyTree";
import { toFamilyChartData } from "@/lib/tree/to-family-chart";

export const metadata: Metadata = {
  title: "Family tree · Rootward",
};

/**
 * `/tree/[personId]` — the hourglass view centred on one person (SPEC §8.1,
 * §8.2). Approved members only; a signed-in-but-pending visitor belongs on
 * `/onboarding`, an anonymous one on `/login`.
 *
 * One `getNeighborhood` fetch at the default depths renders the visible
 * neighbourhood. Click-to-re-centre with URL history and an in-session depth
 * override are issue #23.
 */
export default async function TreePage({
  params,
}: PageProps<"/tree/[personId]">) {
  const { personId } = await params;

  const current = await getCurrentAccount();
  if (current === null) {
    redirect("/login");
  }
  if (!isApproved(current.account)) {
    redirect("/onboarding");
  }

  if (!isUuid(personId)) {
    notFound();
  }

  const supabase = await createSupabaseServerClient();
  const neighborhood = await getNeighborhood(supabase, personId);

  // Empty means the focus person does not exist or RLS hides them — a 404 to
  // the caller either way (never leak which).
  if (neighborhood.persons.length === 0) {
    notFound();
  }

  const tree = toFamilyChartData(neighborhood);

  return (
    <main className="flex flex-1 flex-col">
      <FamilyTree tree={tree} />
    </main>
  );
}
