import type {
  NoteDeleteInput,
  NoteEditRow,
  NoteEventOption,
  NoteInsertInput,
  NoteUpdateInput,
  SectionNoteOwner,
} from "@/lib/db/note-edit";
import type { RowConflict } from "@/lib/db/conflict";
import { eventTypeLabel } from "@/lib/person/labels";

import type { ConflictItem } from "./conflict";

/**
 * Pure CRUD state for the Notes section (SPEC §8.3, §4.5, §10 item 31) — add
 * / reorder / delete over `note` rows owned by the person or one of the
 * person's own events (see `note-edit.ts`'s doc comment for the WAYFINDER
 * decision 21 scope call). Structurally the same shape as
 * `additional-names.ts` (client-assigned row ids, `updatedAt === null` marks
 * an unsaved row, a wholesale `reconciled` replace after save), with one
 * addition this section's multi-owner grouping forces: `moved` swaps with the
 * nearest row sharing the same owner, not the strictly adjacent array index
 * — the flat list mixes rows from every owner group, and only within-group
 * order is ever shown or saved (`sort_order` is scoped per `(owner_type,
 * owner_id)`, not global).
 */

export interface NoteDraft {
  readonly id: string;
  readonly updatedAt: string | null;
  readonly ownerType: SectionNoteOwner;
  readonly ownerId: string;
  readonly text: string;
}

export type NotesAction =
  | {
      readonly type: "added";
      readonly id: string;
      readonly ownerType: SectionNoteOwner;
      readonly ownerId: string;
    }
  | {
      readonly type: "field_changed";
      readonly id: string;
      readonly text: string;
    }
  | {
      readonly type: "moved";
      readonly id: string;
      readonly direction: "up" | "down";
    }
  | { readonly type: "removed"; readonly id: string }
  | {
      /** Wholesale replace after a save — safe only because the section
       * disables every control while a save is in flight, same convention as
       * `additionalNamesReducer`'s identical action. */
      readonly type: "reconciled";
      readonly rows: readonly NoteDraft[];
    }
  | {
      /** Applies a `ConflictDialog` resolution to one row (#31). `row: null`
       * means "take theirs" on a row deleted elsewhere — remove it locally;
       * otherwise `row` replaces the draft's fields with the server's current
       * values (a "take theirs" on a still-existing row). "Keep mine" never
       * dispatches this — it only bumps that row's baseline, handled by the
       * section component, and leaves the draft untouched so the retry save
       * resends the user's edit. */
      readonly type: "row_reset";
      readonly id: string;
      readonly row: NoteEditRow | null;
    };

export function notesFromLoaded(
  rows: readonly NoteEditRow[],
): readonly NoteDraft[] {
  return rows.map((row) => ({
    id: row.id,
    updatedAt: row.updatedAt,
    ownerType: row.ownerType,
    ownerId: row.ownerId,
    text: row.text,
  }));
}

function blankNote(
  id: string,
  ownerType: SectionNoteOwner,
  ownerId: string,
): NoteDraft {
  return { id, updatedAt: null, ownerType, ownerId, text: "" };
}

function sameOwner(a: NoteDraft, b: NoteDraft): boolean {
  return a.ownerType === b.ownerType && a.ownerId === b.ownerId;
}

export function notesReducer(
  state: readonly NoteDraft[],
  action: NotesAction,
): readonly NoteDraft[] {
  switch (action.type) {
    case "added":
      return [...state, blankNote(action.id, action.ownerType, action.ownerId)];

    case "field_changed":
      return state.map((row) =>
        row.id === action.id ? { ...row, text: action.text } : row,
      );

    case "moved": {
      const index = state.findIndex((row) => row.id === action.id);
      if (index === -1) {
        return state;
      }
      const anchor = state[index]!;
      const step = action.direction === "up" ? -1 : 1;
      let swapWith = index + step;
      while (
        swapWith >= 0 &&
        swapWith < state.length &&
        !sameOwner(state[swapWith]!, anchor)
      ) {
        swapWith += step;
      }
      if (swapWith < 0 || swapWith >= state.length) {
        return state;
      }
      const next = [...state];
      [next[index], next[swapWith]] = [next[swapWith]!, next[index]!];
      return next;
    }

    case "removed":
      return state.filter((row) => row.id !== action.id);

    case "reconciled":
      return action.rows;

    case "row_reset": {
      if (action.row === null) {
        return state.filter((row) => row.id !== action.id);
      }
      const restored = notesFromLoaded([action.row])[0]!;
      // "Take theirs" on a row this section had locally deleted has no
      // existing entry to replace — the row must be reinserted, not mapped
      // over (a `state.map` here would silently no-op and the restore would
      // never appear).
      return state.some((row) => row.id === action.id)
        ? state.map((row) => (row.id === action.id ? restored : row))
        : [...state, restored];
    }

    default:
      return assertNever(action);
  }
}

// --- save diff ------------------------------------------------------------

export interface NotesDiff {
  readonly inserts: readonly NoteInsertInput[];
  readonly updates: readonly NoteUpdateInput[];
  readonly deletes: readonly NoteDeleteInput[];
}

export function isNotesDiffEmpty(diff: NotesDiff): boolean {
  return (
    diff.inserts.length === 0 &&
    diff.updates.length === 0 &&
    diff.deletes.length === 0
  );
}

function ownerKey(ownerType: SectionNoteOwner, ownerId: string): string {
  return `${ownerType}:${ownerId}`;
}

/**
 * Diff the current draft list against its loaded baseline. `sortOrder` is
 * each row's position within its own owner group (not its position in the
 * flat `current` array) — a row whose within-group position moved gets
 * `sortOrder` in its patch even if its text did not change.
 */
export function diffNotes(
  loaded: readonly NoteEditRow[],
  current: readonly NoteDraft[],
): NotesDiff {
  const loadedById = new Map(loaded.map((row) => [row.id, row]));
  const groupIndex = new Map<string, number>();

  const inserts: NoteInsertInput[] = [];
  const updates: NoteUpdateInput[] = [];
  const keptIds = new Set<string>();

  for (const draft of current) {
    const key = ownerKey(draft.ownerType, draft.ownerId);
    const index = groupIndex.get(key) ?? 0;
    groupIndex.set(key, index + 1);

    const text = draft.text.trim();

    if (draft.updatedAt === null) {
      // A note added but left blank is not worth a save — skip it rather
      // than inserting an empty row.
      if (text !== "") {
        inserts.push({
          id: draft.id,
          ownerType: draft.ownerType,
          ownerId: draft.ownerId,
          text,
          sortOrder: index,
        });
      }
      continue;
    }
    keptIds.add(draft.id);

    const baseline = loadedById.get(draft.id);
    if (baseline === undefined) {
      // Not expected in practice — same defensive stance as
      // `diffAdditionalNames`.
      continue;
    }

    const patch: NoteUpdateInput["patch"] = {
      ...(text !== baseline.text ? { text } : {}),
      ...(baseline.sortOrder !== index ? { sortOrder: index } : {}),
    };
    if (Object.keys(patch).length > 0) {
      updates.push({ id: draft.id, expectedUpdatedAt: draft.updatedAt, patch });
    }
  }

  const deletes: NoteDeleteInput[] = loaded
    .filter((row) => !keptIds.has(row.id))
    .map((row) => ({ id: row.id, expectedUpdatedAt: row.updatedAt }));

  return { inserts, updates, deletes };
}

// --- post-save reconciliation ---------------------------------------------

/**
 * Fold a save result back into `baseline` / `current` (decision 26 — a
 * mismatch rejects only that row; the rest save). Same partial-success
 * contract as `reconcileAdditionalNamesAfterSave`: a saved row becomes the
 * new baseline and its draft resets to match; a conflicted row keeps its
 * local edit and stale baseline, surfaced separately via
 * `describeNoteConflicts` + the `ConflictDialog`.
 */
export function reconcileNotesAfterSave(
  baseline: readonly NoteEditRow[],
  current: readonly NoteDraft[],
  result: {
    readonly inserted: readonly NoteEditRow[];
    readonly updated: readonly NoteEditRow[];
  },
): {
  readonly baseline: readonly NoteEditRow[];
  readonly current: readonly NoteDraft[];
} {
  const savedById = new Map(
    [...result.inserted, ...result.updated].map((row) => [row.id, row]),
  );
  const baselineById = new Map(baseline.map((row) => [row.id, row]));

  const nextBaseline: NoteEditRow[] = [];
  const nextCurrent: NoteDraft[] = [];

  for (const draft of current) {
    const saved = savedById.get(draft.id);
    if (saved !== undefined) {
      nextBaseline.push(saved);
      nextCurrent.push(notesFromLoaded([saved])[0]!);
      continue;
    }

    nextCurrent.push(draft);
    const priorBaseline = baselineById.get(draft.id);
    if (priorBaseline !== undefined) {
      nextBaseline.push(priorBaseline);
    }
  }

  return { baseline: nextBaseline, current: nextCurrent };
}

// --- conflict description ---------------------------------------------

/** A note's owner as the `ConflictDialog` heading — "Note about this
 * person" or "Note about their <event label>". `events` supplies the label
 * for an event-owned note; a note whose owning event is not in the list
 * (should not happen — the section always loads them together) falls back to
 * a bare "Note". */
function conflictTitle(
  ownerType: SectionNoteOwner,
  ownerId: string,
  events: readonly NoteEventOption[],
): string {
  switch (ownerType) {
    case "person":
      return "Note about this person";
    case "event": {
      const event = events.find((candidate) => candidate.id === ownerId);
      // Not found is a data-shape gap (the caller passed an incomplete
      // `events` list), not a type gap — falls back to a bare label rather
      // than throwing, same posture as every other "loaded" fallback here.
      return event === undefined
        ? "Note"
        : `Note about their ${eventTypeLabel(event.type, event.typeOther)}`;
    }
    default:
      return assertNever(ownerType);
  }
}

/** Maps each conflicted note's `theirs`/`yours` text into the shared
 * `ConflictItem` shape the `ConflictDialog` renders (SPEC §8.3, decision 26).
 * `yours` is read from `current`, not `loaded` — the dialog compares the
 * edit the user is trying to save against the row's current state, not its
 * stale starting point. */
export function describeNoteConflicts(
  conflicts: readonly RowConflict<NoteEditRow>[],
  current: readonly NoteDraft[],
  events: readonly NoteEventOption[],
): readonly ConflictItem[] {
  const currentById = new Map(current.map((draft) => [draft.id, draft]));

  return conflicts.map((conflict): ConflictItem => {
    const mine = currentById.get(conflict.id);
    const ownerType = conflict.theirs?.ownerType ?? mine?.ownerType ?? "person";
    const ownerId = conflict.theirs?.ownerId ?? mine?.ownerId ?? "";

    return {
      id: conflict.id,
      title: conflictTitle(ownerType, ownerId, events),
      changedBy: conflict.changedBy,
      deleted: conflict.theirs === null,
      fields:
        conflict.theirs === null
          ? []
          : [
              {
                label: "Text",
                yours: mine?.text ?? "",
                theirs: conflict.theirs.text,
              },
            ],
    };
  });
}

function assertNever(value: never): never {
  throw new Error(`notes.ts: unreachable case: ${JSON.stringify(value)}`);
}
