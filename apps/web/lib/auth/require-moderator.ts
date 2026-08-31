import "server-only";

import { createSupabaseServerClient } from "@/lib/supabase/server";

import {
  type AccountAccess,
  type ImportAccess,
  isActiveModerator,
} from "./access";

/**
 * Server-only moderator gate for `/import`, `/moderation`, and the edit view.
 * Returns a discriminated result rather than throwing so each page decides how
 * to render every case (redirect vs. an in-page notice).
 *
 * `auth.getUser()` re-validates the access token with the Auth server on every
 * call, so a tampered cookie fails here independently of the `proxy.ts` session
 * gate. A real query failure throws — a legitimate moderator must never see a
 * 5xx read as "forbidden".
 */

type SessionAccount =
  | { readonly kind: "unauthenticated" }
  | {
      readonly kind: "authenticated";
      readonly userId: string;
      readonly account: AccountAccess | null;
    };

async function loadSessionAccount(context: string): Promise<SessionAccount> {
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
      throw new Error(`${context}: auth.getUser: ${userError.message}`);
    }
    return { kind: "unauthenticated" };
  }

  const { data: account, error: accountError } = await supabase
    .from("account")
    .select("role, status")
    .eq("id", user.id)
    .maybeSingle();
  if (accountError !== null) {
    throw new Error(`${context}: account lookup: ${accountError.message}`);
  }

  return { kind: "authenticated", userId: user.id, account };
}

/** Resolve whether the current request may use `/import`. */
export async function resolveImportAccess(): Promise<ImportAccess> {
  const session = await loadSessionAccount("resolveImportAccess");
  if (session.kind === "unauthenticated") {
    return { kind: "unauthenticated" };
  }
  if (!isActiveModerator(session.account)) {
    return { kind: "forbidden" };
  }
  return { kind: "allowed", userId: session.userId };
}

/** Outcome of resolving `/moderation` access. `isAdmin` gates the role field on
 * the invite form (only an admin may invite a moderator/admin — SPEC §4.7). */
export type ModerationAccess =
  | { readonly kind: "unauthenticated" }
  | { readonly kind: "forbidden" }
  | {
      readonly kind: "allowed";
      readonly userId: string;
      readonly isAdmin: boolean;
    };

/** Resolve whether the current request may use `/moderation`. */
export async function resolveModerationAccess(): Promise<ModerationAccess> {
  const session = await loadSessionAccount("resolveModerationAccess");
  if (session.kind === "unauthenticated") {
    return { kind: "unauthenticated" };
  }
  if (!isActiveModerator(session.account)) {
    return { kind: "forbidden" };
  }
  return {
    kind: "allowed",
    userId: session.userId,
    isAdmin: session.account?.role === "admin",
  };
}
