import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { resolveSettingsAccess } from "@/lib/auth/require-moderator";
import { getTreeSettings, listAllAccounts } from "@/lib/db";
import { createSupabaseServerClient } from "@/lib/supabase/server";

import { RoleManagement } from "./RoleManagement";
import { SettingsForbidden } from "./SettingsForbidden";
import { TreeSettingsForm } from "./TreeSettingsForm";

export const metadata: Metadata = {
  title: "Settings · Rootward",
};

/**
 * `/settings` — admin only (SPEC §8.1, §9.4, §10 item 37). Two surfaces:
 * the singleton `tree_settings` row, and the full account roster (role
 * changes, suspend/reactivate). Reading the session makes this route
 * dynamic.
 */
export default async function SettingsPage() {
  const access = await resolveSettingsAccess();
  if (access.kind === "unauthenticated") {
    redirect("/login");
  }
  if (access.kind === "forbidden") {
    return <SettingsForbidden />;
  }

  const supabase = await createSupabaseServerClient();
  const [settings, accounts] = await Promise.all([
    getTreeSettings(supabase),
    listAllAccounts(supabase),
  ]);

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-8 px-6 py-16">
      <header className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold tracking-tight">Settings</h1>
        <p className="text-muted-foreground text-sm">
          Tree-wide settings and account roles. Everyone with an approved
          account is affected by changes here.
        </p>
      </header>

      <TreeSettingsForm key={settings.updatedAt} settings={settings} />
      <RoleManagement accounts={accounts} currentUserId={access.userId} />
    </main>
  );
}
