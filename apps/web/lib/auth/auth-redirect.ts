import { parseEmailOtpType } from "./email-otp-type";

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

/** The one route that redeems a sign-in link (SPEC §9.1). */
export const AUTH_CALLBACK_PATH = "/auth/callback";

/**
 * Every route reachable without a session — the exhaustive list, not a prefix,
 * so a future `/auth/*` route is gated by default rather than public by
 * accident. SPEC §8.1 / decision 35.
 */
const PUBLIC_PATHS = ["/login", AUTH_CALLBACK_PATH, "/auth/auth-code-error"];

/**
 * Whether this request is an emailed sign-in link that landed on the wrong
 * path, and must be forwarded to `/auth/callback` with its query intact.
 *
 * GoTrue, not Rootward, decides the link's host and path: it validates the
 * `redirect_to` the app asked for against the project's redirect allow-list,
 * and silently substitutes the bare Site URL when the check fails. A
 * deployment that sets Site URL but forgets to allow-list
 * `<site>/auth/callback` therefore mails links to `https://<site>?token_hash=…`.
 * Without this, the visitor lands on `/`, gets gated to `/login`, and the
 * one-time token is spent — the exact failure this whole flow exists to fix,
 * back again through a config slip. Verified against the local stack: an
 * allow-listed `redirect_to` survives, anything else becomes the bare origin.
 */
export function needsEmailOtpForwarding(
  pathname: string,
  params: URLSearchParams,
): boolean {
  if (pathname === AUTH_CALLBACK_PATH) {
    return false;
  }
  return (
    params.get("token_hash") !== null &&
    parseEmailOtpType(params.get("type")) !== null
  );
}

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
 * login. With no default root set the destination is the `/tree` index (#51),
 * which falls back to a deterministic person or shows the empty state.
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
