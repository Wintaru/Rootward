/**
 * Pure validation for the "Invite to claim" action (SPEC §9.2, decision 12).
 * No Supabase client, no `next` import — unit-tested without a runtime, and
 * runnable on either side of the form submit. The side-effecting invite lives
 * in `app/moderation/actions.ts`.
 */

import type { AccountRole } from "@/lib/db";
import { isUuid } from "@/lib/db/uuid";

// A deliberately loose check — GoTrue does the authoritative validation when
// the invite is sent. This only catches obvious typos before a round trip.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const ROLES: readonly AccountRole[] = ["viewer", "moderator", "admin"];

/** The raw form fields. `role` is a free string until validated. */
export interface RawInviteInput {
  readonly email: string;
  readonly personId: string;
  readonly role: string;
}

/** A validated, normalised invite ready to send. */
export interface InviteInput {
  readonly email: string;
  readonly personId: string;
  readonly role: AccountRole;
}

export type InviteValidation =
  | { readonly ok: true; readonly value: InviteInput }
  | { readonly ok: false; readonly error: string };

/** Result of the `inviteToClaim` server action, shared with the form. */
export type InviteResult =
  | { readonly ok: true; readonly email: string }
  | { readonly ok: false; readonly error: string };

/**
 * Validate and normalise the invite form. `callerIsAdmin` gates the role: only
 * an admin may invite someone as `moderator` or `admin` (SPEC §4.7). The RLS
 * `invitation_insert` policy enforces the same rule server-side — this is for a
 * readable error, not the boundary.
 */
export function validateInviteInput(
  raw: RawInviteInput,
  callerIsAdmin: boolean,
): InviteValidation {
  const email = raw.email.trim().toLowerCase();
  if (!EMAIL_RE.test(email)) {
    return { ok: false, error: "Enter a valid email address." };
  }

  const personId = raw.personId.trim().toLowerCase();
  if (!isUuid(personId)) {
    return {
      ok: false,
      error: "Enter the person's ID (a UUID from their page).",
    };
  }

  if (!isAccountRole(raw.role)) {
    return { ok: false, error: "Choose a role for the invitation." };
  }
  if (raw.role !== "viewer" && !callerIsAdmin) {
    return {
      ok: false,
      error: "Only an administrator can invite a moderator or admin.",
    };
  }

  return { ok: true, value: { email, personId, role: raw.role } };
}

function isAccountRole(value: string): value is AccountRole {
  return (ROLES as readonly string[]).includes(value);
}
