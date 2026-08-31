/**
 * Access predicates shared by route guards and UI. Pure — no Supabase client,
 * no `next` imports — so they unit-test without a runtime and can run on either
 * side of the network boundary.
 *
 * The real session check (`auth.getUser()` + the `account` lookup) lives in
 * `require-moderator.ts`, which is `server-only`. Full auth — `/login`, the
 * session middleware, and the `account`-creation trigger — is issue #17; until
 * then an unauthenticated visitor is redirected to `/login` (the only public
 * route, decision 35) even though that page does not exist yet.
 */

import type { Database } from "@/lib/db";

export type AccountRole = Database["public"]["Enums"]["account_role"];
export type AccountStatus = Database["public"]["Enums"]["account_status"];

/** The two `account` columns every access decision needs. */
export interface AccountAccess {
  readonly role: AccountRole;
  readonly status: AccountStatus;
}

/**
 * Moderator+ gate for `/import`, `/moderation`, and the edit view. An account
 * must be `active` and hold `moderator` or `admin` — matching the
 * `is_moderator()` SQL helper the RLS policies and the `gedcom-import` function
 * enforce server-side (SPEC §5). A frontend check is convenience, never the
 * boundary.
 */
export function isActiveModerator(account: AccountAccess | null): boolean {
  return (
    account !== null &&
    account.status === "active" &&
    (account.role === "moderator" || account.role === "admin")
  );
}

/** Outcome of resolving `/import` access, so the page can branch on it. */
export type ImportAccess =
  | { readonly kind: "unauthenticated" }
  | { readonly kind: "forbidden" }
  | { readonly kind: "allowed"; readonly userId: string };

/**
 * What `/onboarding` should do for a signed-in visitor (SPEC §8.1 / §9.3).
 * `onboard` covers both a `pending` account and the brief window before the
 * `on_auth_user_created` trigger's row is readable — treat a missing row as
 * not-yet-approved rather than an error.
 */
export type OnboardingStage =
  | { readonly kind: "onboard" }
  | { readonly kind: "approved" }
  | { readonly kind: "suspended" };

export function resolveOnboardingStage(
  account: AccountAccess | null,
): OnboardingStage {
  if (account === null || account.status === "pending") {
    return { kind: "onboard" };
  }
  if (account.status === "suspended") {
    return { kind: "suspended" };
  }
  return { kind: "approved" };
}
