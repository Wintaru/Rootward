import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { resolveModerationAccess } from "@/lib/auth/require-moderator";
import { listPendingInvitations } from "@/lib/db";
import { createSupabaseServerClient } from "@/lib/supabase/server";

import { InviteToClaimForm } from "./InviteToClaimForm";
import { ModerationForbidden } from "./ModerationForbidden";
import { PendingInvitations } from "./PendingInvitations";

export const metadata: Metadata = {
  title: "Moderation · Rootward",
};

/**
 * `/moderation` — moderator+ only (SPEC §8.1). The v1 stub: the "Invite to
 * claim" action and a list of pending invitations. The full queue (access
 * requests, self-claims, reassign / unlink) is issue #36. Reading the session
 * makes this route dynamic.
 */
export default async function ModerationPage({
  searchParams,
}: {
  searchParams: Promise<{ personId?: string }>;
}) {
  const access = await resolveModerationAccess();
  if (access.kind === "unauthenticated") {
    redirect("/login");
  }
  if (access.kind === "forbidden") {
    return <ModerationForbidden />;
  }

  const invitations = await listPendingInvitations(
    await createSupabaseServerClient(),
  );
  const { personId } = await searchParams;

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-8 px-6 py-16">
      <header className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold tracking-tight">Moderation</h1>
        <p className="text-muted-foreground text-sm">
          Invite people to claim their place in the tree and track invitations
          that are still open.
        </p>
      </header>

      <InviteToClaimForm
        canGrantRoles={access.isAdmin}
        defaultPersonId={personId ?? ""}
      />
      <PendingInvitations invitations={invitations} />
    </main>
  );
}
