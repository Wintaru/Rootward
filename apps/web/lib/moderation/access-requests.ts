/**
 * Pure formatting for the `/moderation` access-request queue (SPEC §9.3, §10
 * item 36). No Supabase client, no `next` import — unit-tested without a
 * runtime, mirroring `lib/moderation/invite.ts`.
 */

const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

/**
 * `submitted_birth_month` / `submitted_birth_year` as free text a moderator
 * can compare against a candidate's actual birth date — "March 1990",
 * "1990" (month unset or out of range), "March" (year unset), or `null` when
 * neither was submitted.
 */
export function formatSubmittedBirth(
  month: number | null,
  year: number | null,
): string | null {
  const monthName =
    month !== null && month >= 1 && month <= 12
      ? (MONTH_NAMES[month - 1] ?? null)
      : null;

  if (monthName !== null && year !== null) {
    return `${monthName} ${String(year)}`;
  }
  if (year !== null) {
    return String(year);
  }
  return monthName;
}
