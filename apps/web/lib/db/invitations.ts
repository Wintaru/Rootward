import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "./database.types";
import type { AccountRole } from "./types";

type Db = SupabaseClient<Database>;

type InvitationRow = Database["public"]["Tables"]["invitation"]["Row"];
type InvitationInsert = Database["public"]["Tables"]["invitation"]["Insert"];

/**
 * The invite path (SPEC §9.2, decision 12). A moderator invites an email to
 * claim a person; on the invitee's first sign-in the `/auth/callback` handler
 * (`maybeAcceptInvitation`) links their account to that person.
 *
 * Reads run under the caller's identity — RLS `invitation_select` limits them to
 * moderators. The insert also runs as the moderator so `invitation_insert`
 * enforces the admin-only rule for a non-`viewer` role as defence in depth; the
 * server action checks the same rule first for a clean error message.
 */

/** One pending invitation with the target person's name for the queue view. */
export interface PendingInvitation {
  readonly id: string;
  readonly email: string;
  readonly personId: string;
  readonly personName: string;
  readonly role: AccountRole;
  readonly createdAt: string;
}

/** Shared with `lib/db/moderation.ts`'s `listLinkedAccounts` — same "given +
 * surname, else 'Unknown person'" fallback both modules need for a person
 * embedded through an `account`/`invitation` row. */
export function personName(
  person: { given_name: string | null; surname: string | null } | null,
): string {
  const parts = [person?.given_name, person?.surname].filter(
    (part): part is string => typeof part === "string" && part.trim() !== "",
  );
  return parts.length === 0 ? "Unknown person" : parts.join(" ");
}

/**
 * Pending invitations, newest first — the `/moderation` stub list (the full
 * queue is issue #36). One round trip: the target person's name comes back
 * through an embedded select on the `invitation.person_id` FK.
 */
export async function listPendingInvitations(
  client: Db,
): Promise<readonly PendingInvitation[]> {
  const { data, error } = await client
    .from("invitation")
    .select(
      "id, email, person_id, role, created_at, person(given_name, surname)",
    )
    .eq("status", "pending")
    .order("created_at", { ascending: false });

  if (error !== null) {
    throw new Error(`listPendingInvitations: ${error.message}`);
  }

  return (data ?? []).map((row) => ({
    id: row.id,
    email: row.email,
    personId: row.person_id,
    personName: personName(row.person),
    role: row.role,
    createdAt: row.created_at,
  }));
}

/** Whether a person already exists — checked before sending an invite. */
export async function personExists(
  client: Db,
  personId: string,
): Promise<boolean> {
  const { data, error } = await client
    .from("person")
    .select("id")
    .eq("id", personId)
    .maybeSingle();

  if (error !== null) {
    throw new Error(`personExists: ${error.message}`);
  }
  return data !== null;
}

/** Insert a pending invitation row. `invitedBy` is the acting moderator. */
export async function createInvitation(
  client: Db,
  input: {
    readonly email: string;
    readonly personId: string;
    readonly role: AccountRole;
    readonly invitedBy: string;
  },
): Promise<string> {
  const row: InvitationInsert = {
    email: input.email,
    person_id: input.personId,
    role: input.role,
    invited_by: input.invitedBy,
  };
  // Return the new id so a failed email send can roll back exactly this row
  // and nothing else — see `deleteInvitationById`.
  const { data, error } = await client
    .from("invitation")
    .insert(row)
    .select("id")
    .single();
  if (error !== null) {
    throw new Error(`createInvitation: ${error.message}`);
  }
  return data.id;
}

/**
 * Remove one invitation by id — the rollback when the Supabase Auth invite
 * email fails to send after the row was written.
 *
 * By id, not by `(email, personId)`. That matched every pending row for the
 * pair, so a re-send that failed deleted the invitation already sitting there
 * as well as the one it had just written. Re-sending to an address whose first
 * link was already clicked fails every time (GoTrue answers "already
 * registered"), which made revoking a good invitation the normal outcome of an
 * ordinary mistake.
 *
 * Still scoped to `pending`, so a rollback can never withdraw an invitation
 * somebody accepted in the moment between the insert and the failed send.
 */
export async function deleteInvitationById(
  client: Db,
  invitationId: string,
): Promise<void> {
  const { error } = await client
    .from("invitation")
    .delete()
    .eq("id", invitationId)
    .eq("status", "pending");
  if (error !== null) {
    throw new Error(`deleteInvitationById: ${error.message}`);
  }
}

/**
 * The most recent pending invitation for `email`, or `null`. Used by the
 * acceptance handler with the service-role client — the invitee is not a
 * moderator, so RLS would hide the row.
 *
 * Exact match on a lower-cased address (invitations are stored lower-cased by
 * `validateInviteInput`, and GoTrue lower-cases too). `ilike` is wrong here —
 * `_` and `%` are common in addresses and PostgREST would read them as
 * wildcards, matching an unrelated invitation.
 */
export async function findPendingInvitationByEmail(
  client: Db,
  email: string,
): Promise<InvitationRow | null> {
  const { data, error } = await client
    .from("invitation")
    .select("*")
    .eq("email", email.trim().toLowerCase())
    .eq("status", "pending")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error !== null) {
    throw new Error(`findPendingInvitationByEmail: ${error.message}`);
  }
  return data;
}

/**
 * Mark `invitationId` accepted by `accountId`, and expire every other pending
 * invitation for the same email so the queue does not keep showing stale rows
 * for someone who is already linked.
 */
export async function markInvitationAccepted(
  client: Db,
  args: {
    readonly invitationId: string;
    readonly email: string;
    readonly accountId: string;
  },
): Promise<void> {
  const now = new Date().toISOString();

  const accepted = await client
    .from("invitation")
    .update({
      status: "accepted",
      accepted_by: args.accountId,
      accepted_at: now,
    })
    .eq("id", args.invitationId);
  if (accepted.error !== null) {
    throw new Error(
      `markInvitationAccepted: accept: ${accepted.error.message}`,
    );
  }

  const expired = await client
    .from("invitation")
    .update({ status: "expired" })
    .eq("email", args.email.trim().toLowerCase())
    .eq("status", "pending")
    .neq("id", args.invitationId);
  if (expired.error !== null) {
    throw new Error(`markInvitationAccepted: expire: ${expired.error.message}`);
  }
}
