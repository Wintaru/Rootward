/**
 * The canonical UUID shape check, shared by every guard that has to reject a
 * non-UUID id before it reaches Postgres (`getNeighborhood`, the tree route, the
 * invite action). One definition so the copies cannot drift.
 *
 * Deliberately loose — accepts any version/variant nibble. Postgres does the
 * authoritative validation; this only turns an obvious typo into a 404 or a
 * form error instead of a round trip or a 500.
 */
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}
