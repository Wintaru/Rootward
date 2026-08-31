import "server-only";

import { createSupabaseServiceClient } from "@/lib/supabase/service";

import { isAdminEmail } from "./admin-email";

/**
 * Promote the deployment's `ADMIN_EMAIL` account to active admin on sign-in
 * (WAYFINDER decision 19, SPEC §9.1).
 *
 * This runs in `/auth/callback`, not a Postgres trigger: a trigger on
 * `auth.users` cannot read the deployment environment, and passing a secret to
 * Postgres locally has no portable hook. The `account` row itself is always
 * created by the `on_auth_user_created` trigger — this only raises its role.
 *
 * Uses the service-role client because the RLS `account_update` policy is
 * `is_admin()` only, and the very first admin is not yet an admin. Idempotent:
 * re-writing `admin` / `active` over the same values is a harmless no-op, and
 * the promotion is re-attempted on the admin's next *full* sign-in (they must
 * sign out first — an established session never re-enters `/auth/callback`).
 *
 * Throws on a real query failure, and when the email matches but no `account`
 * row was updated (the `on_auth_user_created` trigger should have created it),
 * so the caller sends the user to the error page instead of leaving them
 * silently unapproved.
 */
export async function maybeBootstrapAdmin(user: {
  readonly id: string;
  readonly email: string | null | undefined;
}): Promise<void> {
  if (!isAdminEmail(user.email, process.env.ADMIN_EMAIL)) {
    return;
  }

  const supabase = createSupabaseServiceClient();
  const { error, count } = await supabase
    .from("account")
    .update({ role: "admin", status: "active" }, { count: "exact" })
    .eq("id", user.id);

  if (error !== null) {
    throw new Error(`maybeBootstrapAdmin: account promote: ${error.message}`);
  }
  if (count === 0) {
    throw new Error(
      `maybeBootstrapAdmin: no account row for ${user.id} to promote`,
    );
  }
}
