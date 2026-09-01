import type {
  MediaEditRow,
  MediaLinkDeleteInput,
  MediaLinkUpdateInput,
  SectionMediaOwner,
} from "@/lib/db/media-edit";
import type { RowConflict } from "@/lib/db/conflict";

import type { ConflictItem } from "./conflict";
import { normalizeText } from "./diff";

/**
 * Pure CRUD state for the Media section (SPEC §8.3, §4.4, §10 item 34) —
 * caption / reorder / delete over `media_link` rows already attached to the
 * person. Structurally close to `notes.ts`, with one deliberate difference:
 * there is no "added blank row" action. A new row only ever enters this list
 * already saved — `media-process` (issue #33) inserts the `media_link` row
 * itself once the upload finishes, so `row_added` appends a row that is
 * already at its server-assigned baseline, not a draft awaiting its first
 * save (see `MediaSection.tsx`'s upload flow). Every row in this section
 * shares one owner (the person being edited), unlike `notes.ts`'s
 * multi-owner grouping, so `moved` is a plain adjacent-index swap.
 *
 * `isPrimary` is carried on the draft for rendering only — it is never part
 * of {@link diffMediaLinks}'s patch. Setting the primary photo is its own
 * immediate action (`setPrimaryMedia`, `media-edit.ts`); the caller folds its
 * result back in through {@link reconcileMediaLinksAfterSave} (the same path
 * a batched save uses) rather than a dedicated reducer action, because
 * `set_updated_at` bumps `updated_at` on every touched row — reusing the
 * reconciliation keeps both rows' cached versions correct for the next save,
 * where a bespoke "just flip `isPrimary` locally" action would leave them
 * stale.
 */

export interface MediaDraft {
  readonly id: string;
  readonly updatedAt: string;
  readonly mediaId: string;
  readonly ownerType: SectionMediaOwner;
  readonly ownerId: string;
  readonly caption: string;
  readonly isPrimary: boolean;
  readonly originalFilename: string | null;
  readonly mimeType: string | null;
  readonly title: string | null;
  readonly storagePathThumb: string | null;
  readonly storagePathDisplay: string | null;
}

export type MediaAction =
  | { readonly type: "row_added"; readonly row: MediaEditRow }
  | {
      readonly type: "field_changed";
      readonly id: string;
      readonly caption: string;
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
       * `notesReducer`'s identical action. */
      readonly type: "reconciled";
      readonly rows: readonly MediaDraft[];
    }
  | {
      /** Applies a `ConflictDialog` resolution to one row (decision 26).
       * `row: null` means "take theirs" on a row deleted elsewhere — remove
       * it locally; otherwise `row` replaces the draft with the server's
       * current values. */
      readonly type: "row_reset";
      readonly id: string;
      readonly row: MediaEditRow | null;
    };

export function mediaFromLoaded(
  rows: readonly MediaEditRow[],
): readonly MediaDraft[] {
  return rows.map(toDraft);
}

function toDraft(row: MediaEditRow): MediaDraft {
  return {
    id: row.id,
    updatedAt: row.updatedAt,
    mediaId: row.mediaId,
    ownerType: row.ownerType,
    ownerId: row.ownerId,
    caption: row.caption ?? "",
    isPrimary: row.isPrimary,
    originalFilename: row.originalFilename,
    mimeType: row.mimeType,
    title: row.title,
    storagePathThumb: row.storagePathThumb,
    storagePathDisplay: row.storagePathDisplay,
  };
}

export function mediaReducer(
  state: readonly MediaDraft[],
  action: MediaAction,
): readonly MediaDraft[] {
  switch (action.type) {
    case "row_added":
      return [...state, toDraft(action.row)];

    case "field_changed":
      return state.map((row) =>
        row.id === action.id ? { ...row, caption: action.caption } : row,
      );

    case "moved": {
      const index = state.findIndex((row) => row.id === action.id);
      if (index === -1) {
        return state;
      }
      const swapWith = action.direction === "up" ? index - 1 : index + 1;
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
      const restored = toDraft(action.row);
      return state.some((row) => row.id === action.id)
        ? state.map((row) => (row.id === action.id ? restored : row))
        : [...state, restored];
    }

    default:
      return assertNever(action);
  }
}

// --- save diff --------------------------------------------------------

export interface MediaDiff {
  readonly updates: readonly MediaLinkUpdateInput[];
  readonly deletes: readonly MediaLinkDeleteInput[];
}

export function isMediaDiffEmpty(diff: MediaDiff): boolean {
  return diff.updates.length === 0 && diff.deletes.length === 0;
}

/**
 * Diff the current draft list against its loaded baseline. `sortOrder` is
 * each row's position in `current` — a row whose position moved gets
 * `sortOrder` in its patch even if its caption did not change. `isPrimary` is
 * never diffed here (see the module doc).
 */
export function diffMediaLinks(
  loaded: readonly MediaEditRow[],
  current: readonly MediaDraft[],
): MediaDiff {
  const loadedById = new Map(loaded.map((row) => [row.id, row]));
  const updates: MediaLinkUpdateInput[] = [];
  const keptIds = new Set<string>();

  current.forEach((draft, index) => {
    keptIds.add(draft.id);
    const baseline = loadedById.get(draft.id);
    if (baseline === undefined) {
      // Not expected in practice — every draft here started life as an
      // already-saved row (see the module doc); defensive stance only.
      return;
    }

    const caption = normalizeText(draft.caption);
    const patch: MediaLinkUpdateInput["patch"] = {
      ...(caption !== baseline.caption ? { caption } : {}),
      ...(baseline.sortOrder !== index ? { sortOrder: index } : {}),
    };
    if (Object.keys(patch).length > 0) {
      updates.push({
        id: draft.id,
        expectedUpdatedAt: draft.updatedAt,
        patch,
      });
    }
  });

  const deletes: MediaLinkDeleteInput[] = loaded
    .filter((row) => !keptIds.has(row.id))
    .map((row) => ({ id: row.id, expectedUpdatedAt: row.updatedAt }));

  return { updates, deletes };
}

// --- post-save reconciliation -------------------------------------------

/** Fold a save result back into `baseline` / `current` (decision 26 — a
 * mismatch rejects only that row; the rest save). Same partial-success
 * contract as `reconcileNotesAfterSave`. */
export function reconcileMediaLinksAfterSave(
  baseline: readonly MediaEditRow[],
  current: readonly MediaDraft[],
  result: { readonly updated: readonly MediaEditRow[] },
): {
  readonly baseline: readonly MediaEditRow[];
  readonly current: readonly MediaDraft[];
} {
  const savedById = new Map(result.updated.map((row) => [row.id, row]));
  const baselineById = new Map(baseline.map((row) => [row.id, row]));

  const nextBaseline: MediaEditRow[] = [];
  const nextCurrent: MediaDraft[] = [];

  for (const draft of current) {
    const saved = savedById.get(draft.id);
    if (saved !== undefined) {
      nextBaseline.push(saved);
      nextCurrent.push(toDraft(saved));
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

// --- conflict description -----------------------------------------------

/** Maps each conflicted media link's `theirs`/`yours` caption into the
 * shared `ConflictItem` shape (SPEC §8.3, decision 26). */
export function describeMediaConflicts(
  conflicts: readonly RowConflict<MediaEditRow>[],
  current: readonly MediaDraft[],
): readonly ConflictItem[] {
  const currentById = new Map(current.map((draft) => [draft.id, draft]));

  return conflicts.map((conflict): ConflictItem => {
    const mine = currentById.get(conflict.id);
    const title =
      conflict.theirs?.originalFilename ??
      mine?.originalFilename ??
      conflict.theirs?.title ??
      mine?.title ??
      "Media";

    return {
      id: conflict.id,
      title,
      changedBy: conflict.changedBy,
      deleted: conflict.theirs === null,
      fields:
        conflict.theirs === null
          ? []
          : [
              {
                label: "Caption",
                yours: mine?.caption ?? "",
                theirs: conflict.theirs.caption ?? "",
              },
            ],
    };
  });
}

function assertNever(value: never): never {
  throw new Error(`media.ts: unreachable case: ${JSON.stringify(value)}`);
}
