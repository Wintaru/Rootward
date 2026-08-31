/**
 * The row-level version-check conflict shape every edit-section write
 * returns from (SPEC §8.3, WAYFINDER decision 26) — shared so `ConflictDialog`
 * (`components/person/edit/ConflictDialog.tsx`) renders every section's
 * conflicts the same way instead of each save function inventing its own.
 *
 * `theirs: null` means the row is gone by the time of the refetch (deleted
 * elsewhere, or no longer RLS-visible) — there is nothing to compare against,
 * so the only sane resolution is discarding the local change.
 * `changedBy` is the display name of whoever holds the row now, when it is
 * knowable: only `person`, `event`, and `fact` carry an `updated_by` column
 * (issue #7) — `person_name`, `note`, and `family` do not, so their conflicts
 * always carry `changedBy: null` and the dialog omits the "by <user>" clause.
 */
export interface RowConflict<Row> {
  readonly id: string;
  readonly theirs: Row | null;
  readonly changedBy: string | null;
}
