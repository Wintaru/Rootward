/**
 * Pure validation for the `type` query parameter on an email sign-in link
 * (SPEC §9.1). Kept free of any Supabase client so it unit-tests without a
 * runtime, like the other helpers in this directory.
 *
 * `/auth/callback` reads `type` straight off a URL a stranger can edit, so it
 * is parsed against the closed set below rather than cast to `EmailOtpType`.
 * Supabase's own sample casts it, which would hand an attacker-chosen string
 * to `verifyOtp` and widen the route to flows the deployment never sends.
 */

/**
 * GoTrue's email OTP kinds, spelled out here rather than taken from the SDK's
 * `EmailOtpType`. That type ends in `(string & {})` to stay open to kinds a
 * future GoTrue adds, so every string satisfies it — a
 * `satisfies readonly EmailOtpType[]` constraint on the list below would
 * accept `"magic_link"` or `"sginup"` without complaint. This closed union
 * rejects them. Nothing can check it against GoTrue itself, so a new kind has
 * to be added here by hand.
 */
type KnownEmailOtpType =
  "signup" | "invite" | "magiclink" | "recovery" | "email_change" | "email";

/**
 * The three link kinds Rootward actually mails: a moderator's invite (§9.2), a
 * returning member's magic link, and the confirmation GoTrue sends when a
 * magic link creates the account (§9.1). Each value is fixed by the matching
 * template in `supabase/templates/`. Password recovery and email change are
 * not offered, so they are not accepted here.
 */
const ACCEPTED_TYPES = [
  "invite",
  "magiclink",
  "signup",
] as const satisfies readonly KnownEmailOtpType[];

export type AcceptedEmailOtpType = (typeof ACCEPTED_TYPES)[number];

/**
 * The narrowed type, or `null` when the parameter is missing or is not one of
 * the kinds this deployment sends.
 */
export function parseEmailOtpType(
  raw: string | null | undefined,
): AcceptedEmailOtpType | null {
  if (!raw) {
    return null;
  }
  const match = ACCEPTED_TYPES.find((accepted) => accepted === raw);
  return match ?? null;
}
