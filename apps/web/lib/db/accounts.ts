import type { SupabaseClient } from "@supabase/supabase-js";

import { personName } from "./invitations";
import type { Database } from "./database.types";
import type { AccountRole, AccountStatus } from "./types";

type Db = SupabaseClient<Database>;

/**
 * `/settings` role management (SPEC §8.1, §9.4, §10 item 37, WAYFINDER
 * decision 18): the full account roster, role changes, and suspend /
 * reactivate. Every write here is admin-only at the RLS boundary
 * (`account_update` is `is_admin()`, no column carve-out — see
 * `lib/db/moderation.ts`'s module doc for the same rule on the same table).
 * `resolveSettingsAccess()` in `lib/auth/require-moderator.ts` is the
 * app-tier gate `app/settings/actions.ts` checks before calling any of
 * these; that layer also refuses to let an admin change their own role or
 * status, so the tree can never end up with zero reachable admins.
 */

export interface AccountSummary {
  readonly accountId: string;
  readonly displayName: string | null;
  readonly role: AccountRole;
  readonly status: AccountStatus;
  readonly personId: string | null;
  readonly personName: string | null;
  readonly updatedAt: string;
}

/** Every `account_role` value, in the order the invite form and the
 * settings role picker both show it — one list so a role added to the enum
 * cannot drift between the two pickers and the guards that validate them. */
export const ACCOUNT_ROLES: readonly AccountRole[] = [
  "viewer",
  "moderator",
  "admin",
];

export function isAccountRole(value: string): value is AccountRole {
  return (ACCOUNT_ROLES as readonly string[]).includes(value);
}

const ACCOUNT_LIMIT = 200;

/**
 * Every account on the tree, most recently changed first. Capped at
 * {@link ACCOUNT_LIMIT} — same "family-tree sized, not the person tree
 * itself" reasoning as `listLinkedAccounts`. Unlike that list, this is not
 * filtered to linked accounts: an admin needs to see (and act on) a
 * `pending` or unlinked `viewer` row too.
 */
export async function listAllAccounts(
  client: Db,
): Promise<readonly AccountSummary[]> {
  const { data, error } = await client
    .from("account")
    .select(
      "id, display_name, role, status, person_id, updated_at, person(given_name, surname)",
    )
    .order("updated_at", { ascending: false })
    .limit(ACCOUNT_LIMIT);

  if (error !== null) {
    throw new Error(`listAllAccounts: ${error.message}`);
  }

  return (data ?? []).map((row) => ({
    accountId: row.id,
    displayName: row.display_name,
    role: row.role,
    status: row.status,
    personId: row.person_id,
    personName: row.person_id === null ? null : personName(row.person),
    updatedAt: row.updated_at,
  }));
}

export type ChangeAccountRoleResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: "account-not-found" };

/** Set an account's role. Admin-only (RLS `account_update`). Unguarded on
 * the account's current role or status — an admin correcting or promoting
 * a roster entry is the authority here, the same "the admin action is the
 * authority" shape as `reassignAccount`. */
export async function changeAccountRole(
  client: Db,
  args: { readonly accountId: string; readonly role: AccountRole },
): Promise<ChangeAccountRoleResult> {
  const { data, error } = await client
    .from("account")
    .update({ role: args.role })
    .eq("id", args.accountId)
    .select("id")
    .maybeSingle();

  if (error !== null) {
    throw new Error(`changeAccountRole: ${error.message}`);
  }
  if (data === null) {
    return { ok: false, reason: "account-not-found" };
  }
  return { ok: true };
}

export type SetAccountStatusResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: "account-not-found" };

/**
 * Suspend or reactivate an account. Deliberately typed to just these two
 * values, not the full {@link AccountStatus} enum — `pending` is the
 * onboarding-only state `unlinkAccount` (`lib/db/moderation.ts`) already
 * owns, not something this action should be able to set. Reactivating goes
 * straight to `active`, restoring exactly the access the account had before
 * suspension rather than routing it back through onboarding.
 */
export async function setAccountStatus(
  client: Db,
  args: {
    readonly accountId: string;
    readonly status: Extract<AccountStatus, "active" | "suspended">;
  },
): Promise<SetAccountStatusResult> {
  const { data, error } = await client
    .from("account")
    .update({ status: args.status })
    .eq("id", args.accountId)
    .select("id")
    .maybeSingle();

  if (error !== null) {
    throw new Error(`setAccountStatus: ${error.message}`);
  }
  if (data === null) {
    return { ok: false, reason: "account-not-found" };
  }
  return { ok: true };
}
