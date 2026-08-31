import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

import { isActiveModerator, isApproved } from "@/lib/auth/access";
import { getCurrentAccount } from "@/lib/auth/current-account";
import { getPersonEditShell } from "@/lib/db";
import { resolveEditSection } from "@/lib/edit/sections";
import { buildEditShellView } from "@/lib/edit/view-model";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { EditShell } from "@/components/person/EditShell";

import { EditForbidden } from "./EditForbidden";

export const metadata: Metadata = {
  title: "Edit · Rootward",
};

/**
 * `/person/[personId]/edit` — the full-screen edit shell (SPEC §8.3, §10 item
 * 26). Moderator+ only; this issue builds the shell (layout, section nav,
 * relatives strip, Done) — the sections themselves are #27–#32.
 *
 * Gate mirrors `/person/[personId]`'s (unauthenticated → `/login`, not
 * approved → `/onboarding`) plus a moderator check on top, matching
 * `isActiveModerator`'s documented scope ("the edit view", `lib/auth/access.ts`).
 * `getPersonEditShell` reads under the caller's identity — a hidden or absent
 * person both come back `null` → `notFound()` (never leak which), same
 * contract as the profile route.
 */
export default async function EditPersonPage({
  params,
  searchParams,
}: PageProps<"/person/[personId]/edit">) {
  const { personId } = await params;

  const current = await getCurrentAccount();
  if (current === null) {
    redirect("/login");
  }
  if (!isApproved(current.account)) {
    redirect("/onboarding");
  }
  if (!isActiveModerator(current.account)) {
    return <EditForbidden personId={personId} />;
  }

  const supabase = await createSupabaseServerClient();
  const data = await getPersonEditShell(supabase, personId);
  if (data === null) {
    notFound();
  }

  const section = resolveEditSection((await searchParams).section);

  return <EditShell view={buildEditShellView(data, section)} />;
}
