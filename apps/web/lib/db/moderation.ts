import type { SupabaseClient } from "@supabase/supabase-js";

import { personName } from "./invitations";
import { escapeLikePattern } from "./place";
import type { Database } from "./database.types";
import type { AccountRole, AccountStatus } from "./types";

type Db = SupabaseClient<Database>;

/**
 * The `/moderation` full queue (SPEC §8.1 `/moderation`, §9.2–§9.4, §10 item
 * 36, WAYFINDER decisions 12, 13, 18). Three surfaces:
 *
 * - Pending `access_request` rows — approve (link + activate) or reject.
 * - Linked accounts — reassign or unlink a wrong self-claim or invite link
 *   (decision 12: "Moderators can reassign or unlink a wrong claim").
 * - Person search, backing the picker both of the above need.
 *
 * `access_request` reads/writes run under the caller's own identity: RLS
 * (`access_request_select` / `access_request_update`, both `is_moderator()`)
 * is the boundary, no service role needed. `account` is different — RLS
 * `account_update` is `is_admin()` **only**, with no carve-out by column
 * (SPEC §5: "`account`: … `is_admin()` is the only writer"), so approving a
 * request or reassigning/unlinking a claim is an admin-only action here, not
 * merely an admin-only *role field*. Every account write below still goes
 * through the caller's own RLS-scoped client, not the service role — the
 * auto-resolve trigger on `account` (migration `20260901205718`) reads
 * `auth.uid()` to attribute the change, which is only meaningful for a
 * signed-in admin acting as themselves (see that migration's own comment).
 * `resolveModerationAccess().isAdmin` is the app-tier gate the actions in
 * `app/moderation/actions.ts` check before calling any of the account writes
 * below; RLS is the real boundary underneath it.
 */

// --- access requests -------------------------------------------------------

export interface PendingAccessRequest {
  readonly id: string;
  readonly accountId: string;
  readonly accountDisplayName: string | null;
  readonly submittedName: string | null;
  readonly submittedBirthMonth: number | null;
  readonly submittedBirthYear: number | null;
  readonly message: string | null;
  readonly createdAt: string;
}

// `account!access_request_account_id_fkey` disambiguates the embed:
// `access_request` also has `resolved_by → account`, so PostgREST cannot
// infer which FK "account(...)" means without a hint.
const ACCESS_REQUEST_COLUMNS =
  "id, account_id, submitted_name, submitted_birth_month, submitted_birth_year, message, created_at, account:account!access_request_account_id_fkey(display_name)";

/** Pending `access_request` rows, oldest first (a queue, not a feed). */
export async function listPendingAccessRequests(
  client: Db,
): Promise<readonly PendingAccessRequest[]> {
  const { data, error } = await client
    .from("access_request")
    .select(ACCESS_REQUEST_COLUMNS)
    .eq("status", "pending")
    .order("created_at", { ascending: true });

  if (error !== null) {
    throw new Error(`listPendingAccessRequests: ${error.message}`);
  }

  return (data ?? []).map((row) => ({
    id: row.id,
    accountId: row.account_id,
    accountDisplayName: row.account?.display_name ?? null,
    submittedName: row.submitted_name,
    submittedBirthMonth: row.submitted_birth_month,
    submittedBirthYear: row.submitted_birth_year,
    message: row.message,
    createdAt: row.created_at,
  }));
}

export type ResolveAccessRequestResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: "already-resolved" };

/**
 * Reject a pending request — moderator+, no `account` write. The guard on
 * `status = 'pending'` makes a double-click (or two moderators racing the
 * same row) a no-op rather than a second resolution.
 */
export async function rejectAccessRequest(
  client: Db,
  args: { readonly requestId: string; readonly resolvedByAccountId: string },
): Promise<ResolveAccessRequestResult> {
  const { data, error, count } = await client
    .from("access_request")
    .update(
      {
        status: "rejected",
        resolved_by: args.resolvedByAccountId,
        resolved_at: new Date().toISOString(),
      },
      { count: "exact" },
    )
    .eq("id", args.requestId)
    .eq("status", "pending")
    .select("id");

  if (error !== null) {
    throw new Error(`rejectAccessRequest: ${error.message}`);
  }
  if (count === 0 || data === null || data.length === 0) {
    return { ok: false, reason: "already-resolved" };
  }
  return { ok: true };
}

export type ApproveAccessRequestResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: "already-resolved" }
  | { readonly ok: false; readonly reason: "account-already-linked" }
  | { readonly ok: false; readonly reason: "person-already-linked" };

/**
 * Approve a pending request: link `account.person_id` to the chosen person
 * and activate it, then mark the request approved. Admin-only (RLS
 * `account_update`).
 *
 * The account link goes first and is guarded on `status = 'pending' and
 * person_id is null` — the same "load-bearing write first, guarded against a
 * concurrent link" shape as `maybeAcceptInvitation` (`accept-invitation.ts`):
 * a second approval, or a self-claim that lands in the same moment, cannot
 * silently overwrite an existing link. If the link succeeds but the
 * `access_request` update then fails, the account is correctly linked and
 * active while the request sits resolved-but-still-`pending` for a moderator
 * to close by hand — the reverse (an approved request with no linked
 * account) cannot happen.
 */
export async function approveAccessRequest(
  client: Db,
  args: {
    readonly requestId: string;
    readonly accountId: string;
    readonly personId: string;
    readonly resolvedByAccountId: string;
  },
): Promise<ApproveAccessRequestResult> {
  const linkResult = await client
    .from("account")
    .update({ person_id: args.personId, status: "active" }, { count: "exact" })
    .eq("id", args.accountId)
    .eq("status", "pending")
    .is("person_id", null)
    .select("id");

  if (linkResult.error !== null) {
    if (linkResult.error.code === "23505") {
      return { ok: false, reason: "person-already-linked" };
    }
    throw new Error(`approveAccessRequest: link: ${linkResult.error.message}`);
  }
  if (
    linkResult.count === 0 ||
    linkResult.data === null ||
    linkResult.data.length === 0
  ) {
    return { ok: false, reason: "account-already-linked" };
  }

  const requestResult = await client
    .from("access_request")
    .update(
      {
        status: "approved",
        resolved_by: args.resolvedByAccountId,
        resolved_at: new Date().toISOString(),
      },
      { count: "exact" },
    )
    .eq("id", args.requestId)
    .eq("status", "pending")
    .select("id");

  if (requestResult.error !== null) {
    throw new Error(
      `approveAccessRequest: resolve: ${requestResult.error.message}`,
    );
  }
  if (
    requestResult.count === 0 ||
    requestResult.data === null ||
    requestResult.data.length === 0
  ) {
    // The account is linked (the load-bearing part); the request record just
    // did not close cleanly (see the module doc). Not a failure the caller
    // should retry — retrying would re-run the (already satisfied) link
    // guard and report `account-already-linked`, which is misleading here.
    return { ok: false, reason: "already-resolved" };
  }

  return { ok: true };
}

// --- linked accounts (reassign / unlink) -----------------------------------

export interface LinkedAccount {
  readonly accountId: string;
  readonly displayName: string | null;
  readonly role: AccountRole;
  readonly status: AccountStatus;
  readonly personId: string;
  readonly personName: string;
  readonly updatedAt: string;
}

const LINKED_ACCOUNT_LIMIT = 100;

/**
 * Every account currently linked to a person, most recently updated first —
 * self-claims and invite-accepts both land here (decision 12 draws no
 * distinction for the reassign/unlink action). Capped at
 * {@link LINKED_ACCOUNT_LIMIT}: this project's own account roster is family-tree
 * sized (dozens, not thousands), not the person tree itself.
 */
export async function listLinkedAccounts(
  client: Db,
): Promise<readonly LinkedAccount[]> {
  const { data, error } = await client
    .from("account")
    .select(
      "id, display_name, role, status, person_id, updated_at, person(given_name, surname)",
    )
    .not("person_id", "is", null)
    .order("updated_at", { ascending: false })
    .limit(LINKED_ACCOUNT_LIMIT);

  if (error !== null) {
    throw new Error(`listLinkedAccounts: ${error.message}`);
  }

  return (data ?? [])
    .filter(
      (row): row is typeof row & { person_id: string } =>
        row.person_id !== null,
    )
    .map((row) => ({
      accountId: row.id,
      displayName: row.display_name,
      role: row.role,
      status: row.status,
      personId: row.person_id,
      personName: personName(row.person),
      updatedAt: row.updated_at,
    }));
}

export type ReassignAccountResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: "person-already-linked" }
  | { readonly ok: false; readonly reason: "account-not-found" };

/**
 * Point an already-linked account at a different person, and (re)activate
 * it. Admin-only. Deliberately unguarded on the account's prior `status` /
 * `person_id` — unlike `approveAccessRequest`'s `status = 'pending' and
 * person_id is null` guard, this is an admin correcting a claim they can
 * already see is wrong (decision 12), not a race two independent flows could
 * both win; the admin action itself is the authority here.
 */
export async function reassignAccount(
  client: Db,
  args: { readonly accountId: string; readonly personId: string },
): Promise<ReassignAccountResult> {
  const { data, error } = await client
    .from("account")
    .update({ person_id: args.personId, status: "active" })
    .eq("id", args.accountId)
    .select("id")
    .maybeSingle();

  if (error !== null) {
    if (error.code === "23505") {
      return { ok: false, reason: "person-already-linked" };
    }
    throw new Error(`reassignAccount: ${error.message}`);
  }
  if (data === null) {
    // The account row is gone (its `auth.users` row was deleted concurrently)
    // — not something a retry fixes, but distinct from the write itself
    // failing, so the caller can show a clearer message than "try again".
    return { ok: false, reason: "account-not-found" };
  }
  return { ok: true };
}

export type UnlinkAccountResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: "account-not-found" };

/**
 * Unlink an account from its person. Reverts `status` to `pending` — the
 * `account_status` enum's own definition of `pending` is "signed in but not
 * yet approved/linked" (SPEC §4.6), so an unlinked account is exactly that
 * again, not a still-`active` member with nothing linked. Admin-only.
 */
export async function unlinkAccount(
  client: Db,
  accountId: string,
): Promise<UnlinkAccountResult> {
  const { data, error } = await client
    .from("account")
    .update({ person_id: null, status: "pending" })
    .eq("id", accountId)
    .select("id")
    .maybeSingle();

  if (error !== null) {
    throw new Error(`unlinkAccount: ${accountId}: ${error.message}`);
  }
  if (data === null) {
    return { ok: false, reason: "account-not-found" };
  }
  return { ok: true };
}

// --- person search (the approve / reassign picker) --------------------------

export interface PersonSearchOption {
  readonly id: string;
  readonly name: string;
}

const PERSON_SEARCH_LIMIT = 8;

function personSearchLabel(row: {
  given_name: string | null;
  surname: string | null;
  nickname: string | null;
}): string {
  const full = [row.given_name, row.surname]
    .map((part) => part?.trim() ?? "")
    .filter((part) => part !== "")
    .join(" ");
  return full || row.nickname?.trim() || "Unnamed person";
}

/**
 * Name search backing the approve/reassign person picker — a moderator has
 * only the requester's submitted name/birth info to go on, not a person id
 * (unlike the invite form's `?personId=` prefill from an existing profile
 * page). Case-insensitive substring match on given name, surname, or
 * nickname — `personSearchLabel` below falls back to nickname when neither
 * name part is set, so the search has to cover it too, or a
 * nickname-only person (common for an infant or an unidentified relative)
 * would be unreachable through this picker. Empty query → no round trip, no
 * results.
 */
export async function searchPersonsForModeration(
  client: Db,
  query: string,
): Promise<readonly PersonSearchOption[]> {
  const trimmed = query.trim();
  if (trimmed === "") {
    return [];
  }
  const pattern = `%${escapeLikePattern(trimmed)}%`;

  const { data, error } = await client
    .from("person")
    .select("id, given_name, surname, nickname")
    .or(
      `given_name.ilike.${pattern},surname.ilike.${pattern},nickname.ilike.${pattern}`,
    )
    .order("surname", { ascending: true, nullsFirst: false })
    .limit(PERSON_SEARCH_LIMIT);

  if (error !== null) {
    throw new Error(`searchPersonsForModeration: ${error.message}`);
  }
  return (data ?? []).map((row) => ({
    id: row.id,
    name: personSearchLabel(row),
  }));
}
