/**
 * Which links the global header shows (SPEC §8.1 "Global chrome", #50). Pure —
 * the layout feeds it the current account and renders whatever comes back, so
 * the role-gating decision unit-tests without a session.
 *
 * Links are convenience only: `/import`, `/moderation`, and `/settings` each
 * re-check access server-side, and RLS is the real boundary (SPEC §5).
 */

import { isActiveAdmin, isActiveModerator, isApproved } from "./access";
// Type-only: erased at compile time, so the `server-only` guard never runs.
import type { CurrentAccount } from "./current-account";

export interface HeaderNavLink {
  readonly href: string;
  readonly label: string;
}

/** The two `CurrentAccount` fields the decision reads. */
export type HeaderNavInput = Pick<CurrentAccount, "account" | "personId">;

/**
 * The header's link list, in display order. Empty for an account that is not
 * yet approved: a pending member on `/onboarding` still gets the header (for
 * sign-out), just with nowhere else to go.
 */
export function resolveHeaderNav({
  account,
  personId,
}: HeaderNavInput): readonly HeaderNavLink[] {
  if (!isApproved(account)) {
    return [];
  }

  const links: HeaderNavLink[] = [{ href: "/", label: "Home" }];
  if (personId !== null) {
    links.push({ href: `/person/${personId}`, label: "My record" });
  }
  if (isActiveModerator(account)) {
    links.push({ href: "/person/new", label: "New person" });
    links.push({ href: "/import", label: "Import / Export" });
    links.push({ href: "/moderation", label: "Moderation" });
  }
  if (isActiveAdmin(account)) {
    links.push({ href: "/settings", label: "Settings" });
  }
  return links;
}

/**
 * Whether a header link points at the page being shown, for `aria-current`
 * (#79). "Home" is the tree, so `/` also claims every `/tree/…` route; every
 * other link claims itself and its sub-routes, never a sibling (`/person/new`
 * is not under `/person/<id>` and vice versa).
 */
export function isActiveHref(pathname: string, href: string): boolean {
  if (href === "/") {
    return (
      pathname === "/" || pathname === "/tree" || pathname.startsWith("/tree/")
    );
  }
  return pathname === href || pathname.startsWith(`${href}/`);
}
