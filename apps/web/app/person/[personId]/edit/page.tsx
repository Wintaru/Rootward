import type { SupabaseClient } from "@supabase/supabase-js";
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import type { ReactNode } from "react";

import { isActiveModerator, isApproved } from "@/lib/auth/access";
import { getCurrentAccount } from "@/lib/auth/current-account";
import { getAccountDisplayName } from "@/lib/db/account-lookup";
import type { Database } from "@/lib/db/database.types";
import {
  getPersonEditShell,
  getPersonEvents,
  getPersonNames,
  getPersonNotes,
  getPersonReferenceNumbers,
} from "@/lib/db";
import type { PersonEditShellData } from "@/lib/db/person";
import { resolveEditSection, type EditSectionSlug } from "@/lib/edit/sections";
import type { NameGenderFields } from "@/lib/edit/person-fields";
import { buildEditShellView } from "@/lib/edit/view-model";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { AdditionalNamesSection } from "@/components/person/edit/AdditionalNamesSection";
import { EventsSection } from "@/components/person/edit/EventsSection";
import { NameGenderSection } from "@/components/person/edit/NameGenderSection";
import { NotesSection } from "@/components/person/edit/NotesSection";
import { ReferenceNumbersSection } from "@/components/person/edit/ReferenceNumbersSection";
import { EditShell } from "@/components/person/EditShell";

import { EditForbidden } from "./EditForbidden";

export const metadata: Metadata = {
  title: "Edit · Rootward",
};

/**
 * `/person/[personId]/edit` — the full-screen edit shell (SPEC §8.3, §10 item
 * 26) plus, as of #27/#28/#31, the Name & Gender, Additional Names, Reference
 * Numbers, Events, and Notes sections. Moderator+ only; Facts, Media, and
 * Sources (#29, #30, #33) still fall back to the shell's placeholder.
 *
 * Gate mirrors `/person/[personId]`'s (unauthenticated → `/login`, not
 * approved → `/onboarding`) plus a moderator check on top, matching
 * `isActiveModerator`'s documented scope ("the edit view", `lib/auth/access.ts`).
 * `getPersonEditShell` reads under the caller's identity — a hidden or absent
 * person both come back `null` → `notFound()` (never leak which), same
 * contract as the profile route.
 *
 * Only the active section's own data is fetched (fetch only what you need) —
 * `?section=additional-names` never pays for the Reference Numbers columns,
 * and Name & Gender pays for no query at all beyond the shell's own: its
 * fields are exactly the shell's person-core columns plus `updated_at`, which
 * `getPersonEditShell` already fetched, so `loadSectionContent` builds that
 * section's data straight from `data` rather than re-querying `person`.
 *
 * `selfDisplayName` (#32) resolves the caller's own `account.display_name`
 * for the `PresenceBanner` every other moderator editing this person sees —
 * fetched in parallel with the shell, since it is needed regardless of
 * whether the person is found. Falls back to a generic label, not the
 * caller's email — the presence channel is private + `is_moderator()`-gated
 * (see the #32 migration), but there is no reason to broadcast a real email
 * address to every other moderator as a matter of course.
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
  const [data, selfDisplayName] = await Promise.all([
    getPersonEditShell(supabase, personId),
    getAccountDisplayName(supabase, current.userId),
  ]);
  if (data === null) {
    notFound();
  }

  const section = resolveEditSection((await searchParams).section);
  const sectionContent = await loadSectionContent(
    supabase,
    personId,
    data,
    section,
  );

  return (
    <EditShell
      view={buildEditShellView(data, section)}
      sectionContent={sectionContent}
      currentUser={{
        userId: current.userId,
        displayName: selfDisplayName ?? "A moderator",
      }}
    />
  );
}

async function loadSectionContent(
  supabase: SupabaseClient<Database>,
  personId: string,
  shell: PersonEditShellData,
  section: EditSectionSlug,
): Promise<ReactNode> {
  switch (section) {
    case "name-gender": {
      const fields: NameGenderFields = {
        id: shell.person.id,
        updatedAt: shell.personUpdatedAt,
        givenName: shell.person.givenName,
        surname: shell.person.surname,
        namePrefix: shell.person.namePrefix,
        nameSuffix: shell.person.nameSuffix,
        nickname: shell.person.nickname,
        sex: shell.person.sex,
      };
      return <NameGenderSection personId={personId} loaded={fields} />;
    }

    case "reference-numbers": {
      const fields = await getPersonReferenceNumbers(supabase, personId);
      return fields === null ? undefined : (
        <ReferenceNumbersSection personId={personId} loaded={fields} />
      );
    }

    case "additional-names": {
      const names = await getPersonNames(supabase, personId);
      return <AdditionalNamesSection personId={personId} loaded={names} />;
    }

    case "events": {
      const events = await getPersonEvents(supabase, personId);
      return <EventsSection personId={personId} loaded={events} />;
    }

    case "notes": {
      const notes = await getPersonNotes(supabase, personId);
      return <NotesSection personId={personId} loaded={notes} />;
    }

    default:
      // Facts, Media, Sources — not built yet (#29, #30, #33); the shell's
      // own placeholder covers these.
      return undefined;
  }
}
