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
