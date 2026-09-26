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

/** Reads one candidate focus person, for {@link resolveTreeFocusPersonId}. */
export type PersonIdLoader = () => Promise<string | null>;

/**
 * The person the tree centres on for this member: their own record first, then
 * whatever the caller offers — the deployment's default root, and for `/tree`
 * the deterministic fallback behind it.
 *
 * A linked member's own record wins over the root, so the tree opens where they
 * belong in it. The root is one global setting for the whole deployment, so an
 * invited member landing on it sees a stranger in the middle of the tree and
 * has to find themselves. That is what happened to the first real invitee.
 *
 * The self rung of `person_is_visible` (SPEC §5) means a member can always read
 * their own person, so this destination cannot 404 the way an unchecked root
 * could (#82).
 *
 * `/` and `/tree` both resolve their focus here rather than each spelling the
 * order out, so the two cannot drift into sending one member to two different
 * people. Every loader is lazy and runs only when everything before it came
 * back null: a linked member costs no `tree_settings` read at all.
 */
export async function resolveTreeFocusPersonId(
  ownPersonId: string | null,
  ...fallbacks: readonly PersonIdLoader[]
): Promise<string | null> {
  if (ownPersonId !== null) {
    return ownPersonId;
  }
  for (const load of fallbacks) {
    const candidate = await load();
    if (candidate !== null) {
      return candidate;
    }
  }
  return null;
}

export interface HomeDestinationInput {
  /** `false` when there is no session. */
  readonly signedIn: boolean;
  /** `true` when the account row exists and `status = 'active'`. */
  readonly approved: boolean;
  /** Who the tree should open on, from {@link resolveTreeFocusPersonId}.
   * `null` when the caller found nobody — a fresh deployment, or a member who
   * can see no one. */
  readonly focusPersonId: string | null;
}

/**
 * Where `/` sends a visitor (SPEC §8.1). An approved member lands on the tree;
 * anyone signed-in-but-not-approved goes to onboarding; no session goes to
 * login. With nobody to centre the tree on the destination is the `/tree`
 * index (#51), which falls back to a deterministic person or shows the empty
 * state.
 */
export function resolveHomeDestination(input: HomeDestinationInput): string {
  if (!input.signedIn) {
    return "/login";
  }
  if (!input.approved) {
    return "/onboarding";
  }
  return input.focusPersonId === null
    ? "/tree"
    : `/tree/${input.focusPersonId}`;
}
