import "server-only";

import { findPendingInvitationByEmail, markInvitationAccepted } from "@/lib/db";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

import {
  type AcceptInvitationResult,
  decideInvitationAcceptance,
} from "./invitation-decision";

/**
 * Link an invited account to its target person on first sign-in (SPEC §9.2,
 * decision 12).
 *
 * Runs in `/auth/callback`, right after `maybeBootstrapAdmin`, for the same
 * reason: the moderator sent a Supabase Auth invite, the `on_auth_user_created`
 * trigger created the `account` row (`viewer` / `pending`), and the web tier now
 * finishes the link the trigger cannot — it has no view of the `invitation`
 * table's intent.
 *
 * Uses the service-role client: the invitee is still `pending`, so RLS on
 * `invitation` (moderator-only SELECT) and `account` (admin-only UPDATE) would
 * both hide the work from them.
 *
 * Safe to re-enter. It acts only on a `pending` account with no person linked,
 * so a second full sign-in (or an admin who was also invited) is a no-op.
 *
 * The account link and the `invitation` status update are separate round trips,
 * not one transaction. The link is the load-bearing write and goes first; if the
 * status update then fails, the account is correctly linked and active but the
 * invitation stays `pending` in the moderation queue for a moderator to close
 * (issue #36). The reverse — an accepted invitation with an unlinked account —
 * cannot happen.
 */

/** Postgres unique-violation — `account.person_id` is already taken. */
const UNIQUE_VIOLATION = "23505";

export async function maybeAcceptInvitation(user: {
  readonly id: string;
  readonly email: string | null | undefined;
}): Promise<AcceptInvitationResult> {
  if (!user.email) {
    return "skipped";
  }

  const supabase = createSupabaseServiceClient();

  const { data: account, error: accountError } = await supabase
    .from("account")
    .select("status, person_id")
    .eq("id", user.id)
    .maybeSingle();
  if (accountError !== null) {
    throw new Error(
      `maybeAcceptInvitation: account read: ${accountError.message}`,
    );
  }
  if (account === null) {
    // The `on_auth_user_created` trigger has not landed yet — the next full
    // sign-in retries.
    return "skipped";
  }
  if (account.status !== "pending" || account.person_id !== null) {
    // Not a fresh invitee — skip the invitation lookup entirely. This path runs
    // on every full sign-in, so it stays cheap for established accounts.
    return "skipped";
  }

  const invitation = await findPendingInvitationByEmail(supabase, user.email);

  const decision = decideInvitationAcceptance(
    { status: account.status, personId: account.person_id },
    invitation === null
      ? null
      : {
          id: invitation.id,
          email: invitation.email,
          personId: invitation.person_id,
          role: invitation.role,
        },
  );
  if (decision.action === "skip") {
    return decision.reason;
  }

  const { error: linkError, count } = await supabase
    .from("account")
    .update(
      { person_id: decision.personId, role: decision.role, status: "active" },
      { count: "exact" },
    )
    .eq("id", user.id)
    .eq("status", "pending")
    .is("person_id", null);

  if (linkError !== null) {
    if (linkError.code === UNIQUE_VIOLATION) {
      return "conflict";
    }
    throw new Error(
      `maybeAcceptInvitation: account link: ${linkError.message}`,
    );
  }
  if (count === 0) {
    // A concurrent write linked the account first.
    return "conflict";
  }

  await markInvitationAccepted(supabase, {
    invitationId: decision.invitationId,
    email: decision.email,
    accountId: user.id,
  });

  return "linked";
}
