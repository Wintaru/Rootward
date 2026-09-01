import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { resolveModerationAccess } from "@/lib/auth/require-moderator";
import {
  listLinkedAccounts,
  listPendingAccessRequests,
  listPendingInvitations,
} from "@/lib/db";
import { createSupabaseServerClient } from "@/lib/supabase/server";

import { AccessRequestsQueue } from "./AccessRequestsQueue";
import { InviteToClaimForm } from "./InviteToClaimForm";
import { LinkedAccounts } from "./LinkedAccounts";
import { ModerationForbidden } from "./ModerationForbidden";
import { PendingInvitations } from "./PendingInvitations";

export const metadata: Metadata = {
  title: "Moderation · Rootward",
};

/**
 * `/moderation` — moderator+ only (SPEC §8.1, §10 item 36). The full queue:
 * pending access requests (approve/reject), linked accounts (reassign /
 * unlink a wrong claim), and the #20 "invite to claim" form + pending
 * invitations. Reading the session makes this route dynamic.
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

  const supabase = await createSupabaseServerClient();
  const [accessRequests, linkedAccounts, invitations] = await Promise.all([
    listPendingAccessRequests(supabase),
    listLinkedAccounts(supabase),
    listPendingInvitations(supabase),
  ]);
  const { personId } = await searchParams;

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-8 px-6 py-16">
      <header className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold tracking-tight">Moderation</h1>
        <p className="text-muted-foreground text-sm">
          Handle access requests and claims, invite people to claim their place
          in the tree, and track invitations that are still open.
        </p>
      </header>

      <AccessRequestsQueue
        requests={accessRequests}
        canApprove={access.isAdmin}
      />
      <LinkedAccounts accounts={linkedAccounts} canManage={access.isAdmin} />

      <InviteToClaimForm
        canGrantRoles={access.isAdmin}
        defaultPersonId={personId ?? ""}
      />
      <PendingInvitations invitations={invitations} />
    </main>
  );
}
