"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";

import { resolveModerationAccess } from "@/lib/auth/require-moderator";
import {
  approveAccessRequest,
  createInvitation,
  deletePendingInvitation,
  type PersonSearchOption,
  personExists,
  reassignAccount,
  rejectAccessRequest,
  searchPersonsForModeration,
  unlinkAccount,
} from "@/lib/db";
import { isUuid } from "@/lib/db/uuid";
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

/** Shared result shape for the queue actions below. */
export type ModerationActionResult =
  { readonly ok: true } | { readonly ok: false; readonly error: string };

/** Reject a pending access request — moderator+ (SPEC §5 `access_request_update`,
 * no `account` write). */
export async function rejectAccessRequestAction(
  requestId: string,
): Promise<ModerationActionResult> {
  const access = await resolveModerationAccess();
  if (access.kind !== "allowed") {
    return { ok: false, error: "You do not have permission to do that." };
  }

  const server = await createSupabaseServerClient();
  const result = await rejectAccessRequest(server, {
    requestId,
    resolvedByAccountId: access.userId,
  });
  if (!result.ok) {
    return {
      ok: false,
      error: "Someone already resolved this request.",
    };
  }

  revalidatePath("/moderation");
  return { ok: true };
}

/**
 * Approve a pending access request, linking the account to `personId` and
 * activating it. Admin-only — `account_update` RLS (SPEC §5) is `is_admin()`
 * with no per-column carve-out, so this re-checks `access.isAdmin` for a
 * clean error before the write hits that boundary.
 *
 * `accountId` comes from the caller's own copy of the pending request (the
 * queue already fetched it via `listPendingAccessRequests`) rather than a
 * second server-side lookup by `requestId` — `approveAccessRequest` still
 * re-checks `status = 'pending'` on both rows, so a stale/mismatched pair
 * fails the same way a fresh lookup would.
 */
export async function approveAccessRequestAction(
  requestId: string,
  accountId: string,
  personId: string,
): Promise<ModerationActionResult> {
  const access = await resolveModerationAccess();
  if (access.kind !== "allowed") {
    return { ok: false, error: "You do not have permission to do that." };
  }
  if (!access.isAdmin) {
    return {
      ok: false,
      error: "Only an administrator can approve and link a request.",
    };
  }
  if (!isUuid(personId)) {
    return { ok: false, error: "Choose a person to link." };
  }

  const server = await createSupabaseServerClient();
  if (!(await personExists(server, personId))) {
    return { ok: false, error: "No person with that ID is visible to you." };
  }

  const result = await approveAccessRequest(server, {
    requestId,
    accountId,
    personId,
    resolvedByAccountId: access.userId,
  });
  if (!result.ok) {
    const messages: Record<typeof result.reason, string> = {
      "already-resolved": "Someone already resolved this request.",
      "account-already-linked": "That account is already linked to a person.",
      "person-already-linked":
        "That person is already linked to another account.",
    };
    return { ok: false, error: messages[result.reason] };
  }

  revalidatePath("/moderation");
  return { ok: true };
}

/** Point an already-linked account at a different person. Admin-only. */
export async function reassignAccountAction(
  accountId: string,
  personId: string,
): Promise<ModerationActionResult> {
  const access = await resolveModerationAccess();
  if (access.kind !== "allowed") {
    return { ok: false, error: "You do not have permission to do that." };
  }
  if (!access.isAdmin) {
    return {
      ok: false,
      error: "Only an administrator can reassign a linked account.",
    };
  }
  if (!isUuid(personId)) {
    return { ok: false, error: "Choose a person to link." };
  }

  const server = await createSupabaseServerClient();
  if (!(await personExists(server, personId))) {
    return { ok: false, error: "No person with that ID is visible to you." };
  }

  const result = await reassignAccount(server, { accountId, personId });
  if (!result.ok) {
    const messages: Record<typeof result.reason, string> = {
      "person-already-linked":
        "That person is already linked to another account.",
      "account-not-found": "That account no longer exists.",
    };
    return { ok: false, error: messages[result.reason] };
  }

  revalidatePath("/moderation");
  return { ok: true };
}

/** Unlink an account from its person, reverting it to `pending`. Admin-only. */
export async function unlinkAccountAction(
  accountId: string,
): Promise<ModerationActionResult> {
  const access = await resolveModerationAccess();
  if (access.kind !== "allowed") {
    return { ok: false, error: "You do not have permission to do that." };
  }
  if (!access.isAdmin) {
    return {
      ok: false,
      error: "Only an administrator can unlink an account.",
    };
  }

  const server = await createSupabaseServerClient();
  const result = await unlinkAccount(server, accountId);
  if (!result.ok) {
    return { ok: false, error: "That account no longer exists." };
  }

  revalidatePath("/moderation");
  return { ok: true };
}

/** Name search backing the approve/reassign person picker. Moderator+. */
export async function searchModerationPersons(
  query: string,
): Promise<readonly PersonSearchOption[]> {
  const access = await resolveModerationAccess();
  if (access.kind !== "allowed") {
    return [];
  }
  const server = await createSupabaseServerClient();
  return searchPersonsForModeration(server, query);
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
