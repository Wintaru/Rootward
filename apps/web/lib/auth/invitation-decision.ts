/**
 * Pure decision for the invite-acceptance handler (SPEC §9.2, decision 12).
 * Kept free of any Supabase client or `server-only` import so it unit-tests
 * without a runtime — the same split as `admin-email.ts` / `bootstrap-admin.ts`.
 * The side-effecting link lives in `accept-invitation.ts`.
 */

import type { AccountRole } from "@/lib/db";

import type { AccountStatus } from "./access";

export type AcceptInvitationResult =
  "linked" | "no_invitation" | "skipped" | "conflict";

/** The `account` fields the decision needs. */
export interface InviteeAccount {
  readonly status: AccountStatus;
  readonly personId: string | null;
}

/** The `invitation` fields the decision needs. */
export interface AcceptableInvitation {
  readonly id: string;
  readonly email: string;
  readonly personId: string;
  readonly role: AccountRole;
}

export type AcceptanceDecision =
  | { readonly action: "skip"; readonly reason: AcceptInvitationResult }
  | {
      readonly action: "link";
      readonly invitationId: string;
      readonly email: string;
      readonly personId: string;
      readonly role: AccountRole;
    };

/**
 * Given the account state and any pending invitation, decide whether to link.
 *
 * Skips unless the account is still `pending` with no person linked: an active
 * or suspended member is never overwritten, and neither is one a concurrent
 * self-claim (decision 24) already linked.
 */
export function decideInvitationAcceptance(
  account: InviteeAccount,
  invitation: AcceptableInvitation | null,
): AcceptanceDecision {
  if (invitation === null) {
    return { action: "skip", reason: "no_invitation" };
  }
  if (account.status !== "pending" || account.personId !== null) {
    return { action: "skip", reason: "skipped" };
  }
  return {
    action: "link",
    invitationId: invitation.id,
    email: invitation.email,
    personId: invitation.personId,
    role: invitation.role,
  };
}
