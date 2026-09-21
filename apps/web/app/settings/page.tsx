import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { getCurrentAccount } from "@/lib/auth/current-account";
import { resolveSettingsAccess } from "@/lib/auth/require-moderator";
import { getPersonCount, getTreeSettings, listAllAccounts } from "@/lib/db";
import {
  resolveSettingsTab,
  type SettingsTab,
  visibleSettingsTabs,
} from "@/lib/settings/tabs";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { toThemePreference } from "@/lib/theme/preference";

import { AppearancePanel } from "./AppearancePanel";
import { RoleManagement } from "./RoleManagement";
import { SettingsForbidden, SettingsTabForbidden } from "./SettingsForbidden";
import { SettingsTabs } from "./SettingsTabs";
import { TreeSettingsForm } from "./TreeSettingsForm";
import { WipeTreeSection } from "./WipeTreeSection";

export const metadata: Metadata = {
  title: "Settings · Rootward",
};

/** The page title and intro line per tab (SPEC §8.1 copy for Appearance).
 * A record over the tab id, so a tab added to `SETTINGS_TABS` without copy
 * is a compile error. */
const TAB_COPY: Readonly<
  Record<SettingsTab["id"], { readonly title: string; readonly intro: string }>
> = {
  appearance: {
    title: "Appearance",
    intro:
      "How Rootward looks for you. Each member picks their own — this does not change the tree for anyone else.",
  },
  tree: {
    title: "Tree",
    intro:
      "Tree-wide settings. Everyone with an approved account is affected by changes here.",
  },
  roles: {
    title: "Roles",
    intro:
      "Who can do what on this tree. Role changes apply the next time the member loads a page.",
  },
};

/**
 * `/settings` (SPEC §8.1, §9.4, §10 item 37, #80) — tabbed: **Appearance**
 * (the member's own theme + mode, every approved member) | **Tree** (the
 * singleton `tree_settings` row and the wipe) | **Roles** (the account
 * roster). The admin gate applies per tab, not per route: a non-admin sees
 * only the Appearance tab, and a direct hit on `?tab=tree` renders the
 * refusal inside the tab region. Only the active tab's data is fetched.
 * Reading the session makes this route dynamic.
 */
export default async function SettingsPage({
  searchParams,
}: PageProps<"/settings">) {
  const access = await resolveSettingsAccess();
  if (access.kind === "unauthenticated") {
    redirect("/login");
  }
  if (access.kind === "forbidden") {
    return <SettingsForbidden />;
  }

  const { tab: tabParam } = await searchParams;
  const tab = resolveSettingsTab(
    typeof tabParam === "string" ? tabParam : undefined,
  );

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-7 px-6 py-12">
      <header className="flex flex-col gap-3">
        <SettingsTabs
          tabs={visibleSettingsTabs(access.isAdmin)}
          active={tab.id}
        />
        <h1 className="font-display mt-3 text-4xl leading-tight font-semibold">
          {TAB_COPY[tab.id].title}
        </h1>
        <p className="text-muted-foreground text-[15px]">
          {TAB_COPY[tab.id].intro}
        </p>
      </header>

      {tab.adminOnly && !access.isAdmin ? (
        <SettingsTabForbidden />
      ) : (
        <TabContent tab={tab} userId={access.userId} />
      )}
    </main>
  );
}

/** The active tab's panels, each with only the reads it needs. */
async function TabContent({
  tab,
  userId,
}: {
  readonly tab: SettingsTab;
  readonly userId: string;
}) {
  switch (tab.id) {
    case "appearance": {
      // `getCurrentAccount` is request-cached: the layout already ran it.
      const current = await getCurrentAccount();
      const stored = current?.appearance ?? null;
      const initial = toThemePreference(stored?.theme, stored?.colorMode);
      return <AppearancePanel initial={initial} />;
    }
    case "tree": {
      const supabase = await createSupabaseServerClient();
      const [settings, personCount] = await Promise.all([
        getTreeSettings(supabase),
        getPersonCount(supabase),
      ]);
      return (
        <div className="flex max-w-2xl flex-col gap-8">
          <TreeSettingsForm key={settings.updatedAt} settings={settings} />
          <WipeTreeSection personCount={personCount} startedBy={userId} />
        </div>
      );
    }
    case "roles": {
      const supabase = await createSupabaseServerClient();
      const accounts = await listAllAccounts(supabase);
      return (
        <div className="flex max-w-2xl flex-col gap-8">
          <RoleManagement accounts={accounts} currentUserId={userId} />
        </div>
      );
    }
  }
}
