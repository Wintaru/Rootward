import "server-only";

import { createSupabaseServerClient } from "@/lib/supabase/server";

import { isActiveModerator, type ImportAccess } from "./access";

/**
 * Resolve whether the current request may use `/import`. Returns a discriminated
 * result rather than throwing so the page decides how to render each case
 * (redirect vs. an in-page notice).
 *
 * `auth.getUser()` re-validates the access token with the Auth server on every
 * call, so a tampered cookie fails here even without the session middleware
 * that issue #17 adds.
 */
export async function resolveImportAccess(): Promise<ImportAccess> {
  const supabase = await createSupabaseServerClient();

  const { data: userData, error: userError } = await supabase.auth.getUser();
  const user = userData.user;
  if (user === null) {
    // No / invalid session is the ordinary case (`status` 400/401). Anything
    // else — a 5xx or a transport failure — is a real error, not "logged out".
    if (
      userError !== null &&
      userError.status !== undefined &&
      userError.status >= 500
    ) {
      throw new Error(
        `resolveImportAccess: auth.getUser: ${userError.message}`,
      );
    }
    return { kind: "unauthenticated" };
  }

  const { data: account, error: accountError } = await supabase
    .from("account")
    .select("role, status")
    .eq("id", user.id)
    .maybeSingle();

  // A real query failure must not masquerade as "forbidden" — fail loud so it
  // reads as a 500, not a permissions problem, for a legitimate moderator.
  if (accountError !== null) {
    throw new Error(
      `resolveImportAccess: account lookup: ${accountError.message}`,
    );
  }
  if (!isActiveModerator(account)) {
    return { kind: "forbidden" };
  }

  return { kind: "allowed", userId: user.id };
}
