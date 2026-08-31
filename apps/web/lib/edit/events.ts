import { parseGenealogyDate } from "@rootward/shared";

import type { RowConflict } from "@/lib/db/conflict";
import type {
  EventDeleteInput,
  EventEditRow,
  EventFieldValues,
  EventInsertInput,
  EventUpdateInput,
} from "@/lib/db/event-edit";
import type { GenealogyDateColumns } from "@/lib/db/genealogy-date";
import type { EventType } from "@/lib/db/types";
import { eventTypeLabel } from "@/lib/person/labels";

import type { ConflictItem } from "./conflict";
import { normalizeText } from "./diff";

/**
 * Pure CRUD state for the Events section (SPEC §8.3, §4.1, §4.2, §10 item 28)
 * — add / edit / delete over person-owned `event` rows, and the diff that
 * turns the current list against its loaded baseline into a save payload.
 * Structurally the same pattern as `additional-names.ts` (client-assigned
 * row ids, `updatedAt === null` marks an unsaved row, a wholesale
 * `reconciled` replace after save), with two differences that Events'
 * different shape forces:
 *
 * - No `moved` action / `sortOrder` diffing. `event.sort_key` is server
 *   computed (a trigger over the date plus a per-`type` ordinal — see
 *   `event-edit.ts`), not client-assigned, so there is nothing to reorder;
 *   `reconcileEventsAfterSave` re-sorts the display list by the `sortKey`
 *   each saved row comes back with instead.
 * - An added row is skipped on save only when `type` is still unset — not
 *   "every field blank" (`additional-names.ts`'s rule). A `person_name` row
 *   with no type and no name text is meaningless; an `event` row with a type
 *   chosen and nothing else is a legitimate sparse record ("a birth event
 *   exists, no date or place known").
 */

export type EventFieldKey =
  "type" | "typeOther" | "dateRaw" | "placeName" | "value" | "ageText";

export interface EventDraft {
  readonly id: string;
  readonly updatedAt: string | null;
  readonly type: EventType | null;
  readonly typeOther: string;
  /** The raw text a `DateInput` shows — `event.date_value_raw` on load,
   * always round-trips (SPEC §4.1). */
  readonly dateRaw: string;
  readonly placeName: string;
  readonly value: string;
  readonly ageText: string;
  /** Read-only display order, not part of any diff — see the module doc. */
  readonly sortKey: string | null;
}

export type EventsAction =
  | { readonly type: "added"; readonly id: string }
  | {
      readonly type: "field_changed";
      readonly id: string;
      readonly field: EventFieldKey;
      readonly value: string | EventType | null;
    }
  | { readonly type: "removed"; readonly id: string }
  | {
      /** Wholesale replace after a save, safe only because the section
       * disables every control while a save is in flight — see
       * `additional-names.ts`'s identical action. */
      readonly type: "reconciled";
      readonly rows: readonly EventDraft[];
    }
  | {
      /** Applies a `ConflictDialog` resolution to one row (#31) — see
       * `notes.ts`'s identical action for the full contract. */
      readonly type: "row_reset";
      readonly id: string;
      readonly row: EventEditRow | null;
    };

export function eventsFromLoaded(
  rows: readonly EventEditRow[],
): readonly EventDraft[] {
  return rows.map((row) => ({
    id: row.id,
    updatedAt: row.updatedAt,
    type: row.type,
    typeOther: row.typeOther ?? "",
    dateRaw: row.dateRaw,
    placeName: row.placeName ?? "",
    value: row.value ?? "",
    ageText: row.ageText ?? "",
    sortKey: row.sortKey,
  }));
}

function blankEvent(id: string): EventDraft {
  return {
    id,
    updatedAt: null,
    type: null,
    typeOther: "",
    dateRaw: "",
    placeName: "",
    value: "",
    ageText: "",
    sortKey: null,
  };
}

export function eventsReducer(
  state: readonly EventDraft[],
  action: EventsAction,
): readonly EventDraft[] {
  switch (action.type) {
    case "added":
      return [...state, blankEvent(action.id)];

    case "field_changed":
      return state.map((row) => {
        if (row.id !== action.id) {
          return row;
        }
        const next = { ...row, [action.field]: action.value };
        // `typeOther` is only meaningful — and only shown — while
        // `type === "other"` (`EventsSection.tsx`). Clearing it the moment
        // `type` changes away from that makes "carries a leftover custom
        // label after switching types" unrepresentable, rather than relying
        // on every diff/save path to re-derive the same exclusion.
        if (action.field === "type" && action.value !== "other") {
          next.typeOther = "";
        }
        return next;
      });

    case "removed":
      return state.filter((row) => row.id !== action.id);

    case "reconciled":
      return action.rows;

    case "row_reset": {
      if (action.row === null) {
        return state.filter((row) => row.id !== action.id);
      }
      const restored = eventsFromLoaded([action.row])[0]!;
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

// --- date column derivation -------------------------------------------

/** The event has no date at all — distinct from `parseGenealogyDate("")`'s
 * `date_kind: "unknown"` (GEDCOM's explicit-but-empty `DATE`), which is not
 * reachable by clearing this field. `date_calendar` stays at its column
 * default (`gregorian`, not-null) since there is no calendar to clear it to. */
const CLEARED_DATE: GenealogyDateColumns = {
  date_value_raw: null,
  date_kind: null,
  date_year1: null,
  date_month1: null,
  date_day1: null,
  date_year2: null,
  date_month2: null,
  date_day2: null,
  date_calendar: "gregorian",
  date_dual_year: null,
  date_phrase: null,
};

/** `DateInput`'s raw text → the embedded date column set (SPEC §4.1), via
 * `parseGenealogyDate` (WAYFINDER decision 22 — never re-implemented here). */
export function dateColumnsFromRaw(raw: string): GenealogyDateColumns {
  const trimmed = raw.trim();
  return trimmed === "" ? CLEARED_DATE : parseGenealogyDate(trimmed);
}

// --- save diff ----------------------------------------------------------

export interface EventsDiff {
  readonly inserts: readonly EventInsertInput[];
  readonly updates: readonly EventUpdateInput[];
  readonly deletes: readonly EventDeleteInput[];
}

export function isEventsDiffEmpty(diff: EventsDiff): boolean {
  return (
    diff.inserts.length === 0 &&
    diff.updates.length === 0 &&
    diff.deletes.length === 0
  );
}

export function diffEvents(
  loaded: readonly EventEditRow[],
  current: readonly EventDraft[],
): EventsDiff {
  const loadedById = new Map(loaded.map((row) => [row.id, row]));

  const inserts: EventInsertInput[] = [];
  const updates: EventUpdateInput[] = [];
  const keptIds = new Set<string>();

  for (const draft of current) {
    if (draft.updatedAt === null) {
      // A row with no type chosen yet cannot be inserted (`event.type` is
      // not-null) and is not worth saving as a placeholder — skip it rather
      // than surfacing a save error for a row the user has not finished.
      if (draft.type !== null) {
        inserts.push({ id: draft.id, ...fieldValues(draft, draft.type) });
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

    const patch = diffOneEvent(baseline, draft);
    if (Object.keys(patch).length > 0) {
      updates.push({ id: draft.id, expectedUpdatedAt: draft.updatedAt, patch });
    }
  }

  const deletes: EventDeleteInput[] = loaded
    .filter((row) => !keptIds.has(row.id))
    .map((row) => ({ id: row.id, expectedUpdatedAt: row.updatedAt }));

  return { inserts, updates, deletes };
}

function fieldValues(draft: EventDraft, type: EventType): EventFieldValues {
  return {
    type,
    typeOther: normalizeText(draft.typeOther),
    value: normalizeText(draft.value),
    ageText: normalizeText(draft.ageText),
    date: dateColumnsFromRaw(draft.dateRaw),
    placeName: normalizeText(draft.placeName),
  };
}

function diffOneEvent(
  baseline: EventEditRow,
  draft: EventDraft,
): Partial<EventFieldValues> {
  const typeOther = normalizeText(draft.typeOther);
  const value = normalizeText(draft.value);
  const ageText = normalizeText(draft.ageText);
  const placeName = normalizeText(draft.placeName);

  return {
    ...(draft.type !== null && draft.type !== baseline.type
      ? { type: draft.type }
      : {}),
    ...(typeOther !== baseline.typeOther ? { typeOther } : {}),
    ...(value !== baseline.value ? { value } : {}),
    ...(ageText !== baseline.ageText ? { ageText } : {}),
    ...(draft.dateRaw.trim() !== baseline.dateRaw
      ? { date: dateColumnsFromRaw(draft.dateRaw) }
      : {}),
    ...(placeName !== baseline.placeName ? { placeName } : {}),
  };
}

// --- post-save reconciliation -------------------------------------------

/** Ascending by `sortKey`, undated (`null`) last — matches `getPersonEvents`'
 * own query order (SPEC §10 item 28's "re-sort by `sort_key`"). */
function bySortKey(a: EventDraft, b: EventDraft): number {
  if (a.sortKey === b.sortKey) return 0;
  if (a.sortKey === null) return 1;
  if (b.sortKey === null) return -1;
  return a.sortKey < b.sortKey ? -1 : 1;
}

/**
 * Fold a save result back into `baseline` / `current`, same partial-success
 * contract as `reconcileAdditionalNamesAfterSave` (decision 26 — a
 * conflicted row keeps its local edit and stale baseline so the next save
 * retries it; a conflicted delete stays out of view until a reload). Then
 * re-sort the display list by the freshly saved `sortKey`s — the one thing
 * this reconciliation does that the names version does not, since Events has
 * no client-controlled order to preserve instead.
 */
export function reconcileEventsAfterSave(
  baseline: readonly EventEditRow[],
  current: readonly EventDraft[],
  result: {
    readonly inserted: readonly EventEditRow[];
    readonly updated: readonly EventEditRow[];
  },
): {
  readonly baseline: readonly EventEditRow[];
  readonly current: readonly EventDraft[];
} {
  const savedById = new Map(
    [...result.inserted, ...result.updated].map((row) => [row.id, row]),
  );
  const baselineById = new Map(baseline.map((row) => [row.id, row]));

  const nextBaseline: EventEditRow[] = [];
  const nextCurrent: EventDraft[] = [];

  for (const draft of current) {
    const saved = savedById.get(draft.id);
    if (saved !== undefined) {
      nextBaseline.push(saved);
      nextCurrent.push(eventsFromLoaded([saved])[0]!);
      continue;
    }

    nextCurrent.push(draft);
    const priorBaseline = baselineById.get(draft.id);
    if (priorBaseline !== undefined) {
      nextBaseline.push(priorBaseline);
    }
  }

  return { baseline: nextBaseline, current: [...nextCurrent].sort(bySortKey) };
}

// --- conflict description -----------------------------------------------

const EVENT_CONFLICT_FIELDS: ReadonlyMap<
  string,
  (row: EventEditRow) => string
> = new Map([
  ["Type", (row) => eventTypeLabel(row.type, row.typeOther)],
  ["Date", (row) => row.dateRaw],
  ["Place", (row) => row.placeName ?? ""],
  ["Value", (row) => row.value ?? ""],
  ["Age", (row) => row.ageText ?? ""],
]);

/** Maps each conflicted event's `theirs`/`yours` values into the shared
 * `ConflictItem` shape the `ConflictDialog` renders (SPEC §8.3, decision 26).
 * Only fields that actually differ are shown — an event carries several
 * columns, and most of a conflict is one or two of them, not the whole row.
 * `yours` reads from `current`, not the stale `loaded` baseline. */
export function describeEventConflicts(
  conflicts: readonly RowConflict<EventEditRow>[],
  current: readonly EventDraft[],
): readonly ConflictItem[] {
  const currentById = new Map(current.map((draft) => [draft.id, draft]));

  return conflicts.map((conflict): ConflictItem => {
    const mine = currentById.get(conflict.id);
    const mineRow: EventEditRow | null =
      mine === undefined ? null : eventDraftAsRow(mine);

    return {
      id: conflict.id,
      title:
        mineRow !== null
          ? `Event: ${eventTypeLabel(mineRow.type, mineRow.typeOther)}`
          : conflict.theirs !== null
            ? `Event: ${eventTypeLabel(conflict.theirs.type, conflict.theirs.typeOther)}`
            : "Event",
      changedBy: conflict.changedBy,
      deleted: conflict.theirs === null,
      fields:
        conflict.theirs === null || mineRow === null
          ? []
          : [...EVENT_CONFLICT_FIELDS.entries()]
              .map(([label, read]) => ({
                label,
                yours: read(mineRow),
                theirs: read(conflict.theirs!),
              }))
              .filter((field) => field.yours !== field.theirs),
    };
  });
}

/** `EventDraft`'s field set is a strict subset of `EventEditRow`'s — every
 * `EVENT_CONFLICT_FIELDS` reader only reads fields the draft already has —
 * so a draft can stand in for a row without a round trip. `sortKey` is
 * carried through unchanged since no reader touches it. */
function eventDraftAsRow(draft: EventDraft): EventEditRow {
  return {
    id: draft.id,
    updatedAt: draft.updatedAt ?? "",
    type: draft.type ?? "other",
    typeOther: draft.typeOther,
    value: draft.value,
    ageText: draft.ageText,
    sortKey: draft.sortKey,
    placeName: draft.placeName,
    dateRaw: draft.dateRaw,
  };
}

function assertNever(value: never): never {
  throw new Error(`Unhandled events action: ${JSON.stringify(value)}`);
}
