/**
 * Names of database constraints the application has to recognise by name.
 *
 * A unique violation reaches the client as SQLSTATE 23505 and a message that
 * names the constraint. Code that wants to tell one collision from another has
 * no other handle, so the name is part of the contract between a migration and
 * the code above it.
 *
 * Two guards keep this file honest, because a stale name here fails silently:
 * the collision stops being recognised and the user sees a raw error again.
 * `apps/web/lib/db/db-constraints.parity.test.ts` asserts each name below
 * appears in a migration, and `supabase/tests/schema_guards_test.sql`
 * asserts the index exists in a built database.
 *
 * The other half of the contract belongs to PostgREST, which forwards the
 * constraint name inside the error message. Nothing in this repository can
 * enforce that. If a future PostgREST stops doing it, `isUniqueViolationOn`
 * returns false and every caller falls back to reporting an error -- noisy,
 * but never wrong in the dangerous direction.
 *
 * Pure TypeScript, so the Edge Functions can import it too (decision 8).
 */

/**
 * One `pending` access_request per account (issue #49, migration
 * `20260922180000`). A second open request is the same request, so a collision
 * on this index means "already on file", not a failure.
 */
export const ACCESS_REQUEST_ONE_PENDING_PER_ACCOUNT =
  "access_request_one_pending_per_account";

/** SQLSTATE for `unique_violation`. */
export const SQLSTATE_UNIQUE_VIOLATION = "23505";

/**
 * True when a PostgREST error is a unique violation on `constraintName`.
 *
 * Both fields are checked. The SQLSTATE alone would match any unique index on
 * the table, and the message alone would match a different error that happens
 * to quote the name.
 *
 * The name is matched with its surrounding quotes, as Postgres writes it, so a
 * later index called `<name>_v2` is not mistaken for this one.
 */
export function isUniqueViolationOn(
  error: { code?: string | null; message?: string | null } | null,
  constraintName: string,
): boolean {
  if (error === null) return false;
  return (
    error.code === SQLSTATE_UNIQUE_VIOLATION &&
    (error.message ?? "").includes(`"${constraintName}"`)
  );
}
