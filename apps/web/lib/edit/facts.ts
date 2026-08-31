import { parseGenealogyDate } from "@rootward/shared";

import type { RowConflict } from "@/lib/db/conflict";
import type {
  FactDeleteInput,
  FactEditRow,
  FactFieldValues,
  FactInsertInput,
  FactUpdateInput,
} from "@/lib/db/fact-edit";
import type { GenealogyDateColumns } from "@/lib/db/genealogy-date";
import type { FactType, FactVisibility } from "@/lib/db/types";
import { factTypeLabel } from "@/lib/person/labels";

import type { ConflictItem } from "./conflict";
import { normalizeText } from "./diff";

/**
 * Pure CRUD state for the Facts section (SPEC §8.3, §4.1, §4.2, §10 item 29)
 * — add / edit / delete over person-owned `fact` rows, and the diff that
 * turns the current list against its loaded baseline into a save payload.
 * Structurally the same pattern as `events.ts`, with the differences `fact`'s
 * own shape forces:
 *
 * - `visibility` is part of every draft and diff — the one field `event`
 *   does not carry. The MVP UI restricts the control to
 *   `FACT_VISIBILITY_OPTIONS` below (`everyone_approved` / `hidden`, issue
 *   #29 scope — same restriction decisions 7/31 apply to `person.visibility`)
 *   even though the column's full enum has four values; `close_family` /
 *   `moderators_only` stay reachable only by a future admin-facing surface,
 *   not this one.
 * - `isSensitive` is derived, not stored on the draft as separately-diffed
 *   state — `factIsSensitive(type)` recomputes it from `type` alone on every
 *   render (`FactsSection.tsx`), mirroring `is_sensitive`'s own generated-
 *   column expression (`type in ('ssn', 'national_id', 'medical')`, SPEC
 *   §4.2) so the UI reflects it the instant a sensitive type is chosen,
 *   before any save round trip.
 * - No `sortKey` / re-sort after save. `fact` has no server-computed order
 *   column the way `event.sort_key` is — `reconcileFactsAfterSave` is the
 *   simpler, no-resort shape `additional-names.ts` uses.
 * - No `ageText`. `fact` has no `age_text` column.
 * - An added row is skipped on save only when `type` is still unset — same
 *   rule as `events.ts`, for the same reason (`fact.type` is the one
 *   not-null column; a type with nothing else is a legitimate sparse
 *   record).
 */

export const FACT_VISIBILITY_OPTIONS: readonly {
  readonly value: FactVisibility;
  readonly label: string;
}[] = [
  { value: "everyone_approved", label: "Everyone (approved members)" },
  { value: "hidden", label: "Hidden (moderators only)" },
];

const SENSITIVE_FACT_TYPES: ReadonlySet<FactType> = new Set([
  "ssn",
  "national_id",
  "medical",
]);

/** Mirrors `fact.is_sensitive`'s generated-column expression (SPEC §4.2) so
 * the UI can show it instantly, before any save round trip. `null` (no type
 * chosen yet on an unsaved row) is never sensitive. */
export function factIsSensitive(type: FactType | null): boolean {
  return type !== null && SENSITIVE_FACT_TYPES.has(type);
}

export type FactFieldKey =
  "type" | "typeOther" | "dateRaw" | "placeName" | "value" | "visibility";

export interface FactDraft {
  readonly id: string;
  readonly updatedAt: string | null;
  readonly type: FactType | null;
  readonly typeOther: string;
  /** The raw text a `DateInput` shows — `fact.date_value_raw` on load,
   * always round-trips (SPEC §4.1). */
  readonly dateRaw: string;
  readonly placeName: string;
  readonly value: string;
  readonly visibility: FactVisibility;
}

export type FactsAction =
  | { readonly type: "added"; readonly id: string }
  | {
      readonly type: "field_changed";
      readonly id: string;
      readonly field: FactFieldKey;
      readonly value: string | FactType | FactVisibility | null;
    }
  | { readonly type: "removed"; readonly id: string }
  | {
      /** Wholesale replace after a save, safe only because the section
       * disables every control while a save is in flight — see
       * `additional-names.ts`'s identical action. */
      readonly type: "reconciled";
      readonly rows: readonly FactDraft[];
    }
  | {
      /** Applies a `ConflictDialog` resolution to one row (#31) — see
       * `notes.ts`'s identical action for the full contract. */
      readonly type: "row_reset";
      readonly id: string;
      readonly row: FactEditRow | null;
    };

const DEFAULT_VISIBILITY: FactVisibility = "everyone_approved";

export function factsFromLoaded(
  rows: readonly FactEditRow[],
): readonly FactDraft[] {
  return rows.map((row) => ({
    id: row.id,
    updatedAt: row.updatedAt,
    type: row.type,
    typeOther: row.typeOther ?? "",
    dateRaw: row.dateRaw,
    placeName: row.placeName ?? "",
    value: row.value ?? "",
    visibility: row.visibility,
  }));
}

function blankFact(id: string): FactDraft {
  return {
    id,
    updatedAt: null,
    type: null,
    typeOther: "",
    dateRaw: "",
    placeName: "",
    value: "",
    visibility: DEFAULT_VISIBILITY,
  };
}

export function factsReducer(
  state: readonly FactDraft[],
  action: FactsAction,
): readonly FactDraft[] {
  switch (action.type) {
    case "added":
      return [...state, blankFact(action.id)];

    case "field_changed":
      return state.map((row) => {
        if (row.id !== action.id) {
          return row;
        }
        const next = { ...row, [action.field]: action.value };
        // `typeOther` is only meaningful — and only shown — while
        // `type === "other"` (`FactsSection.tsx`), same rule as
        // `events.ts`'s reducer.
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
      const restored = factsFromLoaded([action.row])[0]!;
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

/** The fact has no date at all — distinct from `parseGenealogyDate("")`'s
 * `date_kind: "unknown"` (GEDCOM's explicit-but-empty `DATE`), which is not
 * reachable by clearing this field. `date_calendar` stays at its column
 * default (`gregorian`, not-null) since there is no calendar to clear it to.
 * Identical to `events.ts`'s `CLEARED_DATE`. */
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

export interface FactsDiff {
  readonly inserts: readonly FactInsertInput[];
  readonly updates: readonly FactUpdateInput[];
  readonly deletes: readonly FactDeleteInput[];
}

export function isFactsDiffEmpty(diff: FactsDiff): boolean {
  return (
    diff.inserts.length === 0 &&
    diff.updates.length === 0 &&
    diff.deletes.length === 0
  );
}

export function diffFacts(
  loaded: readonly FactEditRow[],
  current: readonly FactDraft[],
): FactsDiff {
  const loadedById = new Map(loaded.map((row) => [row.id, row]));

  const inserts: FactInsertInput[] = [];
  const updates: FactUpdateInput[] = [];
  const keptIds = new Set<string>();

  for (const draft of current) {
    if (draft.updatedAt === null) {
      // A row with no type chosen yet cannot be inserted (`fact.type` is
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

    const patch = diffOneFact(baseline, draft);
    if (Object.keys(patch).length > 0) {
      updates.push({ id: draft.id, expectedUpdatedAt: draft.updatedAt, patch });
    }
  }

  const deletes: FactDeleteInput[] = loaded
    .filter((row) => !keptIds.has(row.id))
    .map((row) => ({ id: row.id, expectedUpdatedAt: row.updatedAt }));

  return { inserts, updates, deletes };
}

function fieldValues(draft: FactDraft, type: FactType): FactFieldValues {
  return {
    type,
    typeOther: normalizeText(draft.typeOther),
    value: normalizeText(draft.value),
    visibility: draft.visibility,
    date: dateColumnsFromRaw(draft.dateRaw),
    placeName: normalizeText(draft.placeName),
  };
}

function diffOneFact(
  baseline: FactEditRow,
  draft: FactDraft,
): Partial<FactFieldValues> {
  const typeOther = normalizeText(draft.typeOther);
  const value = normalizeText(draft.value);
  const placeName = normalizeText(draft.placeName);

  return {
    ...(draft.type !== null && draft.type !== baseline.type
      ? { type: draft.type }
      : {}),
    ...(typeOther !== baseline.typeOther ? { typeOther } : {}),
    ...(value !== baseline.value ? { value } : {}),
    ...(draft.visibility !== baseline.visibility
      ? { visibility: draft.visibility }
      : {}),
    ...(draft.dateRaw.trim() !== baseline.dateRaw
      ? { date: dateColumnsFromRaw(draft.dateRaw) }
      : {}),
    ...(placeName !== baseline.placeName ? { placeName } : {}),
  };
}

// --- post-save reconciliation -------------------------------------------

/**
 * Fold a save result back into `baseline` / `current`, same partial-success
 * contract as `reconcileAdditionalNamesAfterSave` (decision 26 — a
 * conflicted row keeps its local edit and stale baseline so the next save
 * retries it; a conflicted delete stays out of view until a reload). No
 * re-sort — `fact` has no server-computed order column the way
 * `event.sort_key` is, so the list stays in whatever order `current` already
 * has it (new rows appended at "Add" time, existing rows in load order).
 */
export function reconcileFactsAfterSave(
  baseline: readonly FactEditRow[],
  current: readonly FactDraft[],
  result: {
    readonly inserted: readonly FactEditRow[];
    readonly updated: readonly FactEditRow[];
  },
): {
  readonly baseline: readonly FactEditRow[];
  readonly current: readonly FactDraft[];
} {
  const savedById = new Map(
    [...result.inserted, ...result.updated].map((row) => [row.id, row]),
  );
  const baselineById = new Map(baseline.map((row) => [row.id, row]));

  const nextBaseline: FactEditRow[] = [];
  const nextCurrent: FactDraft[] = [];

  for (const draft of current) {
    const saved = savedById.get(draft.id);
    if (saved !== undefined) {
      nextBaseline.push(saved);
      nextCurrent.push(factsFromLoaded([saved])[0]!);
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

const FACT_CONFLICT_FIELDS: ReadonlyMap<string, (row: FactEditRow) => string> =
  new Map([
    ["Type", (row) => factTypeLabel(row.type, row.typeOther)],
    ["Date", (row) => row.dateRaw],
    ["Place", (row) => row.placeName ?? ""],
    ["Value", (row) => row.value ?? ""],
    [
      "Visibility",
      (row) =>
        FACT_VISIBILITY_OPTIONS.find(
          (option) => option.value === row.visibility,
        )?.label ?? row.visibility,
    ],
  ]);

/** Maps each conflicted fact's `theirs`/`yours` values into the shared
 * `ConflictItem` shape the `ConflictDialog` renders (SPEC §8.3, decision 26).
 * Only fields that actually differ are shown — a fact carries several
 * columns, and most of a conflict is one or two of them, not the whole row.
 * `yours` reads from `current`, not the stale `loaded` baseline. */
export function describeFactConflicts(
  conflicts: readonly RowConflict<FactEditRow>[],
  current: readonly FactDraft[],
): readonly ConflictItem[] {
  const currentById = new Map(current.map((draft) => [draft.id, draft]));

  return conflicts.map((conflict): ConflictItem => {
    const mine = currentById.get(conflict.id);
    const mineRow: FactEditRow | null =
      mine === undefined ? null : factDraftAsRow(mine);

    return {
      id: conflict.id,
      title:
        mineRow !== null
          ? `Fact: ${factTypeLabel(mineRow.type, mineRow.typeOther)}`
          : conflict.theirs !== null
            ? `Fact: ${factTypeLabel(conflict.theirs.type, conflict.theirs.typeOther)}`
            : "Fact",
      changedBy: conflict.changedBy,
      deleted: conflict.theirs === null,
      fields:
        conflict.theirs === null || mineRow === null
          ? []
          : [...FACT_CONFLICT_FIELDS.entries()]
              .map(([label, read]) => ({
                label,
                yours: read(mineRow),
                theirs: read(conflict.theirs!),
              }))
              .filter((field) => field.yours !== field.theirs),
    };
  });
}

/** `FactDraft`'s field set is a strict subset of `FactEditRow`'s — every
 * `FACT_CONFLICT_FIELDS` reader only reads fields the draft already has —
 * so a draft can stand in for a row without a round trip. `isSensitive` is
 * derived from `type` alone (`factIsSensitive`), matching the server's own
 * generated column. */
function factDraftAsRow(draft: FactDraft): FactEditRow {
  return {
    id: draft.id,
    updatedAt: draft.updatedAt ?? "",
    type: draft.type ?? "other",
    typeOther: draft.typeOther,
    value: draft.value,
    visibility: draft.visibility,
    isSensitive: factIsSensitive(draft.type),
    placeName: draft.placeName,
    dateRaw: draft.dateRaw,
  };
}

function assertNever(value: never): never {
  throw new Error(`Unhandled facts action: ${JSON.stringify(value)}`);
}
