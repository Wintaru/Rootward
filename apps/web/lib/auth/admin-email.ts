/**
 * Pure helpers for the `ADMIN_EMAIL` bootstrap (WAYFINDER decision 19). Kept
 * free of any Supabase client or `next` import so they unit-test without a
 * runtime. The side-effecting promotion lives in `bootstrap-admin.ts`.
 */

/** The `.env.example` placeholder — never treat it as a real admin address. */
const PLACEHOLDER_ADMIN_EMAIL = "you@example.com";

/** Normalise an email for comparison: trimmed, lower-cased. */
function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

/**
 * Whether `candidate` is the deployment's configured admin address.
 *
 * `configured` is `process.env.ADMIN_EMAIL`, which may be undefined (unset),
 * empty, or the shipped placeholder — all of which mean "no admin bootstrap",
 * so every one returns `false`. A missing `candidate` (a user with no email)
 * never matches.
 */
export function isAdminEmail(
  candidate: string | null | undefined,
  configured: string | null | undefined,
): boolean {
  if (!candidate || !configured) {
    return false;
  }
  const target = normalizeEmail(configured);
  if (target === "" || target === PLACEHOLDER_ADMIN_EMAIL) {
    return false;
  }
  return normalizeEmail(candidate) === target;
}
