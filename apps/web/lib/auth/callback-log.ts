import type { AcceptedEmailOtpType } from "./email-otp-type";

/**
 * Pure helpers that describe a failed `/auth/callback` in a log line, kept out
 * of the route so they unit-test without a request (a Next route file may only
 * export its HTTP handlers).
 *
 * Several distinct failures send the visitor to the same page. The server used
 * to record none of them, so a report of "the link does not work" could not be
 * diagnosed without reproducing it. These turn the arriving request into a
 * fixed vocabulary — enough to tell a spent link from a wrong `type` from a
 * template that was never updated.
 *
 * Nothing here returns the token or the address. The token is a live
 * credential until it is redeemed, and the address is personal data.
 */

/**
 * Every reason `/auth/callback` may log. A closed union rather than a string,
 * so no future caller can interpolate part of the request into the one field
 * that is otherwise trusted to be a literal.
 */
export type CallbackFailure =
  | "no credentials in the callback URL"
  | "unsupported link type"
  | "code exchange failed"
  | "token verification failed"
  | "redeemed but no session"
  | "admin bootstrap failed";

/**
 * Everything `/auth/callback` may log, failures and the two outcomes that are
 * not failures. The log line is built from this in one place, so a reason can
 * never exist as a hand-written string that drifts from the union.
 */
export type CallbackOutcome =
  | CallbackFailure
  | "speculative fetch, not redeemed"
  | "not a browser navigation, not redeemed"
  | "signed in";

/** Which credential the link arrived with. Never the credential itself. */
export function describeShape(
  code: string | null,
  tokenHash: string | null,
): "code" | "token_hash" | "none" {
  if (code !== null) {
    return "code";
  }
  return tokenHash !== null ? "token_hash" : "none";
}

/**
 * The `type` parameter reduced to a fixed word. The raw value comes off a URL
 * a stranger can edit, so echoing it would let a crafted link write newlines
 * into the log and forge entries around them.
 */
export function describeType(
  raw: string | null,
  parsed: AcceptedEmailOtpType | null,
): string {
  if (parsed !== null) {
    return parsed;
  }
  return raw === null ? "none" : "rejected";
}

/** A thrown value's message, without assuming it is an `Error`. */
export function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** How much of a third-party message is worth keeping in one log line. */
const MAX_DETAIL_LENGTH = 200;

/**
 * The only part of a log line that comes from outside this module: a Supabase
 * error message. Today those are fixed strings, so this changes nothing. It is
 * here because the guarantee above says no value from the request can forge a
 * log entry, and an unsanitised passthrough would leave that guarantee resting
 * on a third party never echoing input back.
 */
export function sanitizeDetail(raw: string): string {
  const flattened = raw.replaceAll(/[\r\n]+/gu, " ").trim();
  return flattened.length > MAX_DETAIL_LENGTH
    ? `${flattened.slice(0, MAX_DETAIL_LENGTH)}…`
    : flattened;
}

/**
 * The headers a client sets when it fetches a URL speculatively rather than
 * because a person asked for it: browser prefetch and prerender, and the
 * preview fetchers in mail clients and chat apps.
 *
 * `Sec-Purpose` is the current standard (`prefetch`, `prefetch;prerender`).
 * The rest are the older spellings still sent by Chrome, Safari and Firefox,
 * and they cost nothing to keep.
 */
const SPECULATIVE_HEADERS = [
  "sec-purpose",
  "purpose",
  "x-purpose",
  "x-moz",
] as const;

/** Values in those headers that mean "nobody is waiting for this response". */
const SPECULATIVE_VALUES = ["prefetch", "prerender", "preview"] as const;

/**
 * Whether this request announced itself as speculative.
 *
 * A sign-in link is a one-time credential, so anything that fetches it spends
 * it — and a speculative fetch discards the session it gets. The person then
 * clicks the same link and is told it is invalid, which is exactly the report
 * this guards against. A fetcher that announces nothing still gets through;
 * this closes the polite half of the problem.
 */
export function isSpeculativeRequest(headers: Headers): boolean {
  return SPECULATIVE_HEADERS.some((name) => {
    const value = headers.get(name);
    if (value === null) {
      return false;
    }
    const lowered = value.toLowerCase();
    return SPECULATIVE_VALUES.some((marker) => lowered.includes(marker));
  });
}

/**
 * What the caller says it is, for the log line. Truncated and flattened like
 * any other outside string, and it is the one field that identifies a fetcher
 * a person never saw.
 */
export function describeCaller(headers: Headers): string {
  const agent = headers.get("user-agent");
  const purpose = SPECULATIVE_HEADERS.map((name) => {
    const value = headers.get(name);
    return value === null ? null : `${name}=${value}`;
  })
    .filter((entry): entry is string => entry !== null)
    .join(" ");
  // An empty header is as good as absent, and a quote inside the value would
  // break the `ua="…"` framing for anything parsing these lines.
  const agentPart =
    agent === null || agent.trim() === ""
      ? "ua=none"
      : `ua="${sanitizeDetail(agent).replaceAll('"', "'")}"`;
  return purpose === "" ? agentPart : `${agentPart} ${sanitizeDetail(purpose)}`;
}

/**
 * Whether this request looks like a person's browser opening the page: a
 * top-level document navigation, not a fetch of any other kind.
 *
 * On 2026-09-26 a production invite was redeemed by
 * `facebookexternalhit/1.1 Facebot Twitterbot/1.0`, a link-preview crawler,
 * 2.6 seconds before the person's own browser arrived. It announces nothing —
 * no `Sec-Purpose`, no `Purpose` — so the prefetch headers could not see it.
 * Matching crawlers by name is an arms race that one unknown fetcher wins, and
 * every win costs somebody their sign-in. Fetch Metadata inverts the question
 * to "prove you are a navigation", so an unknown fetcher fails by default.
 *
 * It is a heuristic, not a boundary. `Sec-Fetch-Mode` is a forbidden header
 * for in-page `fetch` and XHR, but that rule binds only browsers: any
 * server-side client can set it, and `curl -H 'Sec-Fetch-Mode: navigate'` is
 * how this path was verified. What it buys is that today's crawlers and mail
 * scanners do not send it, at no cost to a person signing in. Whoever holds
 * the URL can still redeem it, which is inherent to a link sent by email. If a
 * crawler ever starts sending these headers, the `signed in` log line records
 * the user agent that succeeded, which is how we would find out.
 *
 * Absence is a property of the CLIENT, not of one request. A browser that does
 * not send these headers will not send them on the next click either, so this
 * can never be the only way in — see the POST route the continue page submits
 * to. Fetch Metadata reached Safari only in 16.4 (March 2023), and every
 * browser and in-app webview on iOS is WebKit, so "old browser" here means a
 * current iPad that cannot update, not a rarity.
 */
export function isBrowserNavigation(headers: Headers): boolean {
  const mode = headers.get("sec-fetch-mode")?.toLowerCase();
  const dest = headers.get("sec-fetch-dest")?.toLowerCase();
  // `navigate` alone also covers an iframe load; a top-level document says so.
  return mode === "navigate" && dest === "document";
}

/**
 * Whether to redeem the one-time token on this request.
 *
 * Two checks covering DISJOINT classes — neither is redundant:
 *   - `isSpeculativeRequest` catches a browser prefetch or prerender, which
 *     IS a navigation and sends `Sec-Fetch-Mode: navigate` alongside
 *     `Sec-Purpose: prefetch`. Only this check stops it.
 *   - `isBrowserNavigation` catches the server-side fetchers that announce
 *     nothing at all: crawlers, scanners, link checkers.
 *
 * Deleting either one reopens a bug that has already happened in production.
 */
export function shouldRedeem(headers: Headers): boolean {
  return isBrowserNavigation(headers) && !isSpeculativeRequest(headers);
}
