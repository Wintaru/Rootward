"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";

import { resolveModerationAccess } from "@/lib/auth/require-moderator";
import {
  createInvitation,
  deletePendingInvitation,
  personExists,
} from "@/lib/db";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import {
  type InviteResult,
  type RawInviteInput,
  validateInviteInput,
} from "@/lib/moderation/invite";

/**
 * "Invite to claim" (SPEC §9.2, decision 12). A moderator invites an email to
 * claim a person: this sends the Supabase Auth invite and records the
 * `invitation` row. The link itself happens on the invitee's first sign-in
 * (`maybeAcceptInvitation` in `/auth/callback`).
 */

export async function inviteToClaim(
  raw: RawInviteInput,
): Promise<InviteResult> {
  const access = await resolveModerationAccess();
  if (access.kind !== "allowed") {
    return {
      ok: false,
      error: "You do not have permission to send invitations.",
    };
  }

  const validation = validateInviteInput(raw, access.isAdmin);
  if (!validation.ok) {
    return { ok: false, error: validation.error };
  }
  const { email, personId, role } = validation.value;

  const server = await createSupabaseServerClient();
  if (!(await personExists(server, personId))) {
    return { ok: false, error: "No person with that ID is visible to you." };
  }

  // Record the invitation first, as the moderator so `invitation_insert` RLS
  // re-checks the admin-only role rule. Doing this before the email send means a
  // failed send never leaves an `auth.users` row with no invitation to match on
  // sign-in.
  await createInvitation(server, {
    email,
    personId,
    role,
    invitedBy: access.userId,
  });

  // Sending the invite creates the `auth.users` row (and, via the
  // `on_auth_user_created` trigger, a pending `account`). Service role only.
  const service = createSupabaseServiceClient();
  const { error: inviteError } = await service.auth.admin.inviteUserByEmail(
    email,
    { redirectTo: await callbackUrl() },
  );
  if (inviteError !== null) {
    // Roll back the row so the moderator can retry cleanly. The usual cause is
    // an email that already has an account — re-inviting or relinking an
    // existing account is the moderation queue (issue #36).
    await deletePendingInvitation(server, { email, personId });
    return {
      ok: false,
      error: inviteError.message || "Could not send the invitation.",
    };
  }

  revalidatePath("/moderation");
  return { ok: true, email };
}

/**
 * The `/auth/callback` URL to embed in the invite email. Prefer the configured
 * `NEXT_PUBLIC_SITE_URL` — it is trusted and, in a real deployment, is the only
 * origin in Supabase's `additional_redirect_urls` allow-list anyway. Fall back
 * to the request host only for local dev where the var may be unset.
 */
async function callbackUrl(): Promise<string> {
  const configured = process.env.NEXT_PUBLIC_SITE_URL;
  if (configured) {
    return `${configured.replace(/\/$/, "")}/auth/callback`;
  }

  const requestHeaders = await headers();
  const host =
    requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host");
  if (!host) {
    throw new Error("inviteToClaim: cannot determine the site origin");
  }
  const proto = requestHeaders.get("x-forwarded-proto") ?? "http";
  return `${proto}://${host}/auth/callback`;
}
