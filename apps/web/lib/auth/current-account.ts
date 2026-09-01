import "server-only";

import { cache } from "react";

import { createSupabaseServerClient } from "@/lib/supabase/server";

import type { AccountAccess } from "./access";

/** The signed-in user plus their `account` row (null until the trigger runs). */
export interface CurrentAccount {
  readonly userId: string;
  readonly email: string | null;
  readonly account: AccountAccess | null;
}

/**
 * Resolve the current request's identity for the routes that branch on approval
 * state (`/`, `/login`) and for the root layout's notification bell (#35).
 * Returns `null` when there is no valid session.
 *
 * `auth.getUser()` revalidates the token against the Auth server, so a tampered
 * cookie fails here even independently of the proxy. A genuine query failure
 * throws rather than reading as "signed out".
 *
 * Wrapped in React's `cache()` so the root layout and a page that also calls
 * this (`app/page.tsx`) share one lookup per request instead of two --
 * `cache()` memoizes by argument, and this takes none, so every call in the
 * same render tree resolves to the same in-flight/settled promise.
 */
export const getCurrentAccount = cache(
  async (): Promise<CurrentAccount | null> => {
    const supabase = await createSupabaseServerClient();

    const { data: userData, error: userError } = await supabase.auth.getUser();
    const user = userData.user;
    if (user === null) {
      if (
        userError !== null &&
        userError.status !== undefined &&
        userError.status >= 500
      ) {
        throw new Error(
          `getCurrentAccount: auth.getUser: ${userError.message}`,
        );
      }
      return null;
    }

    const { data: account, error: accountError } = await supabase
      .from("account")
      .select("role, status")
      .eq("id", user.id)
      .maybeSingle();

    if (accountError !== null) {
      throw new Error(
        `getCurrentAccount: account lookup: ${accountError.message}`,
      );
    }

    return {
      userId: user.id,
      email: user.email ?? null,
      account: account,
    };
  },
);
