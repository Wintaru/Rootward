/**
 * Shared text-normalisation for the edit view's save paths (SPEC §8.3,
 * WAYFINDER decision 26). Pure, no Supabase / React — used by every section
 * that diffs a text field against its loaded baseline (`person-fields.ts`,
 * `additional-names.ts`).
 */

/** Empty-string form input reads as "cleared" — store it as `null`, not `""`,
 * so a blanked field round-trips the same way an unset one does. */
export function normalizeText(value: string): string | null {
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}
