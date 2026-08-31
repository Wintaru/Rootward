/**
 * The proxy's redirect decision, as a pure function so it unit-tests without a
 * request or a Supabase client. Mirrors the reducer pattern the `/import` flow
 * uses (WAYFINDER decision 10 / frontend-arch).
 *
 * The rule (SPEC §8.1, decision 35): nothing is public except `/login` and the
 * `/auth/*` handlers. An unauthenticated visitor anywhere else goes to `/login`;
 * an authenticated visitor on `/login` goes to `/`, which resolves where they
 * actually belong (tree vs. onboarding).
 */

/**
 * Every route reachable without a session — the exhaustive list, not a prefix,
 * so a future `/auth/*` route is gated by default rather than public by
 * accident. SPEC §8.1 / decision 35.
 */
const PUBLIC_PATHS = ["/login", "/auth/callback", "/auth/auth-code-error"];

export interface ProxyRedirectInput {
  readonly hasSession: boolean;
  readonly pathname: string;
}

function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.includes(pathname);
}

/**
 * The path to redirect to, or `null` to let the request through untouched.
 */
export function decideProxyRedirect(input: ProxyRedirectInput): string | null {
  const { hasSession, pathname } = input;

  if (!hasSession) {
    return isPublicPath(pathname) ? null : "/login";
  }

  // Signed in: keep them off the login page, let everything else through.
  if (pathname === "/login") {
    return "/";
  }
  return null;
}

export interface HomeDestinationInput {
  /** `false` when there is no session. */
  readonly signedIn: boolean;
  /** `true` when the account row exists and `status = 'active'`. */
  readonly approved: boolean;
  /** `tree_settings.default_root_person_id`, or `null` on a fresh deployment. */
  readonly rootPersonId: string | null;
}

/**
 * Where `/` sends a visitor (SPEC §8.1). An approved member lands on the tree;
 * anyone signed-in-but-not-approved goes to onboarding; no session goes to
 * login. `/onboarding` and `/tree/*` do not exist until issues #19 / #21 — the
 * redirect target is correct ahead of the page, the same way `/import` already
 * points at `/login`.
 */
export function resolveHomeDestination(input: HomeDestinationInput): string {
  if (!input.signedIn) {
    return "/login";
  }
  if (!input.approved) {
    return "/onboarding";
  }
  return input.rootPersonId === null ? "/tree" : `/tree/${input.rootPersonId}`;
}
