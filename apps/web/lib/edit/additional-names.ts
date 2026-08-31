import type { RowConflict } from "@/lib/db/conflict";
import type {
  PersonNameDeleteInput,
  PersonNameEditRow,
  PersonNameInsertInput,
  PersonNameUpdateInput,
} from "@/lib/db/person-edit";
import type { NameType } from "@/lib/db/types";
import { nameTypeLabel } from "@/lib/person/labels";

import type { ConflictItem } from "./conflict";
import { normalizeText } from "./diff";

/**
 * Pure CRUD state for the Additional Names section (SPEC §8.3, §4.2, §10 item
 * 27) — add / reorder / delete over `person_name` rows, and the diff that
 * turns the current list against its loaded baseline into a save payload.
 *
 * `id` is the row's identity from the moment it exists client-side: a saved
 * row keeps its database id, and a new row is assigned one up front by the
 * caller (e.g. `crypto.randomUUID()` at the "add" click — this module stays
 * pure and does not generate its own randomness). Assigning the id at
 * creation rather than on save means an insert never needs to be correlated
 * back from the server response by array position. `updatedAt === null` is
 * what actually distinguishes "not yet saved" from "loaded from the server".
 */

export type NameFieldKey =
  "type" | "givenName" | "surname" | "prefix" | "suffix" | "nickname";

export interface AdditionalNameDraft {
  readonly id: string;
  readonly updatedAt: string | null;
  readonly type: NameType | null;
  readonly givenName: string;
  readonly surname: string;
  readonly prefix: string;
  readonly suffix: string;
  readonly nickname: string;
}

export type AdditionalNamesAction =
  | { readonly type: "added"; readonly id: string }
  | {
      readonly type: "field_changed";
      readonly id: string;
      readonly field: NameFieldKey;
      readonly value: string | NameType | null;
    }
  | {
      readonly type: "moved";
      readonly id: string;
      readonly direction: "up" | "down";
    }
  | { readonly type: "removed"; readonly id: string }
  | {
      /** Wholesale replace after a save (`reconcileAdditionalNamesAfterSave`).
       * Safe only because the section disables every add/edit/move/remove
       * control while a save is in flight — otherwise an edit made during the
       * request would be silently dropped by the replace. */
      readonly type: "reconciled";
      readonly rows: readonly AdditionalNameDraft[];
    }
  | {
      /** Applies a `ConflictDialog` resolution to one row (#31) — see
       * `notes.ts`'s identical action for the full contract. */
      readonly type: "row_reset";
      readonly id: string;
      readonly row: PersonNameEditRow | null;
    };

export function namesFromLoaded(
  rows: readonly PersonNameEditRow[],
): readonly AdditionalNameDraft[] {
  return rows.map((row) => ({
    id: row.id,
    updatedAt: row.updatedAt,
    type: row.type,
    givenName: row.givenName ?? "",
    surname: row.surname ?? "",
    prefix: row.prefix ?? "",
    suffix: row.suffix ?? "",
    nickname: row.nickname ?? "",
  }));
}

function blankName(id: string): AdditionalNameDraft {
  return {
    id,
    updatedAt: null,
    type: null,
    givenName: "",
    surname: "",
    prefix: "",
    suffix: "",
    nickname: "",
  };
}

export function additionalNamesReducer(
  state: readonly AdditionalNameDraft[],
  action: AdditionalNamesAction,
): readonly AdditionalNameDraft[] {
  switch (action.type) {
    case "added":
      return [...state, blankName(action.id)];

    case "field_changed":
      return state.map((row) =>
        row.id === action.id ? { ...row, [action.field]: action.value } : row,
      );

    case "moved": {
      const index = state.findIndex((row) => row.id === action.id);
      const swapWith = action.direction === "up" ? index - 1 : index + 1;
      if (index === -1 || swapWith < 0 || swapWith >= state.length) {
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
      const restored = namesFromLoaded([action.row])[0]!;
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

export interface AdditionalNamesDiff {
  readonly inserts: readonly PersonNameInsertInput[];
  readonly updates: readonly PersonNameUpdateInput[];
  readonly deletes: readonly PersonNameDeleteInput[];
}

/** `true` when the diff has nothing to save — the caller's cue to skip the
 * round trip entirely, same convention as the single-row sections. */
export function isAdditionalNamesDiffEmpty(diff: AdditionalNamesDiff): boolean {
  return (
    diff.inserts.length === 0 &&
    diff.updates.length === 0 &&
    diff.deletes.length === 0
  );
}

/**
 * Diff the current draft list against its loaded baseline. Position in the
 * array is the sort order — every row's index becomes its `sortOrder`, and an
 * existing row whose index moved gets `sortOrder` in its update patch even if
 * no other field changed (this is what makes reordering alone a save-worthy
 * change).
 */
export function diffAdditionalNames(
  loaded: readonly PersonNameEditRow[],
  current: readonly AdditionalNameDraft[],
): AdditionalNamesDiff {
  const loadedById = new Map(loaded.map((row) => [row.id, row]));

  const inserts: PersonNameInsertInput[] = [];
  const updates: PersonNameUpdateInput[] = [];
  const keptIds = new Set<string>();

  current.forEach((draft, index) => {
    const values = fieldValues(draft);

    if (draft.updatedAt === null) {
      // A row added but never filled in (every field still blank) is not
      // worth a save — skip it rather than inserting an empty person_name
      // row.
      if (!isBlank(values)) {
        inserts.push({ id: draft.id, ...values, sortOrder: index });
      }
      return;
    }
    keptIds.add(draft.id);

    const baseline = loadedById.get(draft.id);
    if (baseline === undefined) {
      // Not expected in practice (a saved row's baseline came from this same
      // load) — nothing to diff against, so there is nothing safe to save.
      return;
    }

    const patch: PersonNameUpdateInput["patch"] = {
      ...(values.type !== baseline.type ? { type: values.type } : {}),
      ...(values.givenName !== baseline.givenName
        ? { givenName: values.givenName }
        : {}),
      ...(values.surname !== baseline.surname
        ? { surname: values.surname }
        : {}),
      ...(values.prefix !== baseline.prefix ? { prefix: values.prefix } : {}),
      ...(values.suffix !== baseline.suffix ? { suffix: values.suffix } : {}),
      ...(values.nickname !== baseline.nickname
        ? { nickname: values.nickname }
        : {}),
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

  const deletes: PersonNameDeleteInput[] = loaded
    .filter((row) => !keptIds.has(row.id))
    .map((row) => ({ id: row.id, expectedUpdatedAt: row.updatedAt }));

  return { inserts, updates, deletes };
}

// --- post-save reconciliation ---------------------------------------------

/**
 * Fold a save result back into `baseline` / `current` (decision 26 — "a
 * mismatch rejects only that row; the rest save," so the UI must reflect a
 * partial save, not treat the whole batch as one pass/fail unit).
 *
 * A row that came back in `inserted` or `updated` becomes the new baseline
 * (and its draft resets to match — no longer dirty). A row missing from
 * both — an update that lost the version check, or (in principle) an insert
 * that somehow did not round-trip — keeps its local edit and its old
 * baseline untouched, so the next save attempts it again rather than
 * silently dropping the change or overwriting someone else's. A deleted row
 * is already absent from `current` (the reducer removed it before the save
 * was even issued); a delete that conflicted is not restored here — the row
 * simply stays out of view until a reload picks up the current server state
 * (the full `ConflictDialog` treatment for this is #31).
 */
export function reconcileAdditionalNamesAfterSave(
  baseline: readonly PersonNameEditRow[],
  current: readonly AdditionalNameDraft[],
  result: {
    readonly inserted: readonly PersonNameEditRow[];
    readonly updated: readonly PersonNameEditRow[];
  },
): {
  readonly baseline: readonly PersonNameEditRow[];
  readonly current: readonly AdditionalNameDraft[];
} {
  const savedById = new Map(
    [...result.inserted, ...result.updated].map((row) => [row.id, row]),
  );
  const baselineById = new Map(baseline.map((row) => [row.id, row]));

  const nextBaseline: PersonNameEditRow[] = [];
  const nextCurrent: AdditionalNameDraft[] = [];

  for (const draft of current) {
    const saved = savedById.get(draft.id);
    if (saved !== undefined) {
      nextBaseline.push(saved);
      nextCurrent.push(namesFromLoaded([saved])[0]!);
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

function fieldValues(draft: AdditionalNameDraft) {
  return {
    type: draft.type,
    givenName: normalizeText(draft.givenName),
    surname: normalizeText(draft.surname),
    prefix: normalizeText(draft.prefix),
    suffix: normalizeText(draft.suffix),
    nickname: normalizeText(draft.nickname),
  };
}

function isBlank(values: ReturnType<typeof fieldValues>): boolean {
  return Object.values(values).every((value) => value === null);
}

// --- conflict description ---------------------------------------------

const NAME_CONFLICT_FIELDS: ReadonlyMap<
  string,
  (row: PersonNameEditRow) => string
> = new Map([
  ["Type", (row) => nameTypeLabel(row.type)],
  ["Given name", (row) => row.givenName ?? ""],
  ["Surname", (row) => row.surname ?? ""],
  ["Prefix", (row) => row.prefix ?? ""],
  ["Suffix", (row) => row.suffix ?? ""],
  ["Nickname", (row) => row.nickname ?? ""],
]);

/** Maps each conflicted `person_name` row's `theirs`/`yours` values into the
 * shared `ConflictItem` shape (SPEC §8.3, decision 26) — see
 * `describeEventConflicts` for the identical "only differing fields" and
 * "`yours` reads from `current`" rationale. `person_name` has no
 * `updated_by`, so `changedBy` is always `null` on the incoming conflict. */
export function describeNameConflicts(
  conflicts: readonly RowConflict<PersonNameEditRow>[],
  current: readonly AdditionalNameDraft[],
): readonly ConflictItem[] {
  const currentById = new Map(current.map((draft) => [draft.id, draft]));

  return conflicts.map((conflict): ConflictItem => {
    const mine = currentById.get(conflict.id);
    const mineRow: PersonNameEditRow | null =
      mine === undefined ? null : nameDraftAsRow(mine);
    const title =
      mineRow !== null
        ? nameConflictTitle(mineRow)
        : conflict.theirs !== null
          ? nameConflictTitle(conflict.theirs)
          : "Name";

    return {
      id: conflict.id,
      title,
      changedBy: conflict.changedBy,
      deleted: conflict.theirs === null,
      fields:
        conflict.theirs === null || mineRow === null
          ? []
          : [...NAME_CONFLICT_FIELDS.entries()]
              .map(([label, read]) => ({
                label,
                yours: read(mineRow),
                theirs: read(conflict.theirs!),
              }))
              .filter((field) => field.yours !== field.theirs),
    };
  });
}

function nameConflictTitle(row: PersonNameEditRow): string {
  const name = [row.givenName, row.surname].filter(Boolean).join(" ").trim();
  return name === "" ? "Name" : `Name: ${name}`;
}

/** `AdditionalNameDraft`'s field set is a strict subset of
 * `PersonNameEditRow`'s (see `eventDraftAsRow` in `events.ts` for the
 * identical stand-in-without-a-round-trip rationale). `sortOrder` is not
 * read by any `NAME_CONFLICT_FIELDS` entry, so its placeholder value here
 * never surfaces. */
function nameDraftAsRow(draft: AdditionalNameDraft): PersonNameEditRow {
  return {
    id: draft.id,
    updatedAt: draft.updatedAt ?? "",
    type: draft.type,
    givenName: draft.givenName,
    surname: draft.surname,
    prefix: draft.prefix,
    suffix: draft.suffix,
    nickname: draft.nickname,
    sortOrder: null,
  };
}

function assertNever(value: never): never {
  throw new Error(
    `Unhandled additional-names action: ${JSON.stringify(value)}`,
  );
}
