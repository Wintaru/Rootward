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
  CallbackFailure | "speculative fetch, not redeemed" | "signed in";

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
  const agentPart =
    agent === null ? "ua=none" : `ua="${sanitizeDetail(agent)}"`;
  return purpose === "" ? agentPart : `${agentPart} ${sanitizeDetail(purpose)}`;
}
