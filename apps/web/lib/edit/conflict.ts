/**
 * The `ConflictDialog` (SPEC §8.3, WAYFINDER decision 26) is one component
 * shared by every edit section — this module is the shape each section's
 * pure `describe*Conflicts` mapper produces so the dialog never needs to know
 * whether it is looking at a person field, a name, an event, or a note.
 */

export interface ConflictField {
  readonly label: string;
  readonly yours: string;
  readonly theirs: string;
}

export interface ConflictItem {
  readonly id: string;
  /** What this row is, for the dialog's heading — "Given name", "Name: John
   * Smith", "Event: Birth", "Note". */
  readonly title: string;
  /** `null` when unknown (no `updated_by` column on this table) or when the
   * row was deleted rather than edited. */
  readonly changedBy: string | null;
  /** The row is gone by the time of the refetch — `fields` is empty and the
   * dialog offers only "discard my change", not a side-by-side compare. */
  readonly deleted: boolean;
  readonly fields: readonly ConflictField[];
}

export type ConflictResolution = "keep-mine" | "take-theirs";
