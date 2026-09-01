import { parseGenealogyDate } from "@rootward/shared";

import type { RowConflict } from "@/lib/db/conflict";
import type { GenealogyDateColumns } from "@/lib/db/genealogy-date";
import type {
  CitationDeleteInput,
  CitationEditRow,
  CitationEventOption,
  CitationFactOption,
  CitationFieldValues,
  CitationInsertInput,
  CitationSectionOwner,
  CitationUpdateInput,
} from "@/lib/db/source-edit";
import { eventTypeLabel, factTypeLabel } from "@/lib/person/labels";

import type { ConflictItem } from "./conflict";
import { normalizeText } from "./diff";

/**
 * Pure CRUD state for the Sources section's Citations list (SPEC §8.3, §4.1,
 * §4.3, §10 item 30) — add / edit / delete over `citation` rows owned by the
 * person or by one of the person's own events or facts (the issue's exact
 * scope — see `source-edit.ts`'s module doc). Grouped by owner, same shape as
 * `notes.ts` extended from one dependent owner kind (`event`) to two (`event`
 * and `fact`); each group add/delete independently, one combined diff across
 * every group.
 *
 * `sourceId` identifies a row from the Sources list above this one in the
 * section (picked via a `<select>`, not typed) — `citation.source_id` is
 * `not null`, so an added row is skipped on save only when no source has been
 * picked yet, the same "the one not-null column decides whether a blank row
 * is worth saving" rule `facts.ts` and `events.ts` use for `type`.
 */

export type CitationFieldKey =
  "sourceId" | "page" | "dataText" | "quality" | "dateRaw";

export interface CitationDraft {
  readonly id: string;
  readonly updatedAt: string | null;
  readonly ownerType: CitationSectionOwner;
  readonly ownerId: string;
  readonly sourceId: string | null;
  readonly page: string;
  readonly dataText: string;
  readonly quality: number | null;
  /** The raw text a `DateInput` shows — `citation.date_value_raw` on load,
   * always round-trips (SPEC §4.1). */
  readonly dateRaw: string;
}

export type CitationsAction =
  | {
      readonly type: "added";
      readonly id: string;
      readonly ownerType: CitationSectionOwner;
      readonly ownerId: string;
    }
  | {
      readonly type: "field_changed";
      readonly id: string;
      readonly field: CitationFieldKey;
      readonly value: string | number | null;
    }
  | { readonly type: "removed"; readonly id: string }
  | {
      /** Wholesale replace after a save, safe only because the section
       * disables every control while a save is in flight — see
       * `additional-names.ts`'s identical action. */
      readonly type: "reconciled";
      readonly rows: readonly CitationDraft[];
    }
  | {
      /** Applies a `ConflictDialog` resolution to one row (decision 26). */
      readonly type: "row_reset";
      readonly id: string;
      readonly row: CitationEditRow | null;
    };

export function citationsFromLoaded(
  rows: readonly CitationEditRow[],
): readonly CitationDraft[] {
  return rows.map((row) => ({
    id: row.id,
    updatedAt: row.updatedAt,
    ownerType: row.ownerType,
    ownerId: row.ownerId,
    sourceId: row.sourceId,
    page: row.page ?? "",
    dataText: row.dataText ?? "",
    quality: row.quality,
    dateRaw: row.dateRaw,
  }));
}

function blankCitation(
  id: string,
  ownerType: CitationSectionOwner,
  ownerId: string,
): CitationDraft {
  return {
    id,
    updatedAt: null,
    ownerType,
    ownerId,
    sourceId: null,
    page: "",
    dataText: "",
    quality: null,
    dateRaw: "",
  };
}

export function citationsReducer(
  state: readonly CitationDraft[],
  action: CitationsAction,
): readonly CitationDraft[] {
  switch (action.type) {
    case "added":
      return [
        ...state,
        blankCitation(action.id, action.ownerType, action.ownerId),
      ];

    case "field_changed":
      return state.map((row) =>
        row.id === action.id ? { ...row, [action.field]: action.value } : row,
      );

    case "removed":
      return state.filter((row) => row.id !== action.id);

    case "reconciled":
      return action.rows;

    case "row_reset": {
      if (action.row === null) {
        return state.filter((row) => row.id !== action.id);
      }
      const restored = citationsFromLoaded([action.row])[0]!;
      // "Take theirs" on a row this list had locally deleted has no existing
      // entry to replace — the row must be reinserted, not mapped over (a
      // `state.map` here would silently no-op and the restore would never
      // appear).
      return state.some((row) => row.id === action.id)
        ? state.map((row) => (row.id === action.id ? restored : row))
        : [...state, restored];
    }

    default:
      return assertNever(action);
  }
}

// --- date column derivation -------------------------------------------

/** Identical to `events.ts` / `facts.ts`'s `CLEARED_DATE` — the citation has
 * no date at all, distinct from `parseGenealogyDate("")`'s `date_kind:
 * "unknown"`. */
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

export function dateColumnsFromRaw(raw: string): GenealogyDateColumns {
  const trimmed = raw.trim();
  return trimmed === "" ? CLEARED_DATE : parseGenealogyDate(trimmed);
}

// --- save diff ----------------------------------------------------------

export interface CitationsDiff {
  readonly inserts: readonly CitationInsertInput[];
  readonly updates: readonly CitationUpdateInput[];
  readonly deletes: readonly CitationDeleteInput[];
}

export function isCitationsDiffEmpty(diff: CitationsDiff): boolean {
  return (
    diff.inserts.length === 0 &&
    diff.updates.length === 0 &&
    diff.deletes.length === 0
  );
}

export function diffCitations(
  loaded: readonly CitationEditRow[],
  current: readonly CitationDraft[],
): CitationsDiff {
  const loadedById = new Map(loaded.map((row) => [row.id, row]));

  const inserts: CitationInsertInput[] = [];
  const updates: CitationUpdateInput[] = [];
  const keptIds = new Set<string>();

  for (const draft of current) {
    if (draft.updatedAt === null) {
      // A row with no source picked yet cannot be inserted (`citation.source_id`
      // is not-null) and is not worth saving as a placeholder — skip it rather
      // than surfacing a save error for a row the user has not finished.
      if (draft.sourceId !== null) {
        inserts.push({
          id: draft.id,
          ownerType: draft.ownerType,
          ownerId: draft.ownerId,
          ...fieldValues(draft, draft.sourceId),
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

    const patch = diffOneCitation(baseline, draft);
    if (Object.keys(patch).length > 0) {
      updates.push({ id: draft.id, expectedUpdatedAt: draft.updatedAt, patch });
    }
  }

  const deletes: CitationDeleteInput[] = loaded
    .filter((row) => !keptIds.has(row.id))
    .map((row) => ({ id: row.id, expectedUpdatedAt: row.updatedAt }));

  return { inserts, updates, deletes };
}

function fieldValues(
  draft: CitationDraft,
  sourceId: string,
): CitationFieldValues {
  return {
    sourceId,
    page: normalizeText(draft.page),
    dataText: normalizeText(draft.dataText),
    quality: draft.quality,
    date: dateColumnsFromRaw(draft.dateRaw),
  };
}

function diffOneCitation(
  baseline: CitationEditRow,
  draft: CitationDraft,
): Partial<CitationFieldValues> {
  const page = normalizeText(draft.page);
  const dataText = normalizeText(draft.dataText);

  return {
    ...(draft.sourceId !== null && draft.sourceId !== baseline.sourceId
      ? { sourceId: draft.sourceId }
      : {}),
    ...(page !== baseline.page ? { page } : {}),
    ...(dataText !== baseline.dataText ? { dataText } : {}),
    ...(draft.quality !== baseline.quality ? { quality: draft.quality } : {}),
    ...(draft.dateRaw.trim() !== baseline.dateRaw
      ? { date: dateColumnsFromRaw(draft.dateRaw) }
      : {}),
  };
}

// --- post-save reconciliation -------------------------------------------

export function reconcileCitationsAfterSave(
  baseline: readonly CitationEditRow[],
  current: readonly CitationDraft[],
  result: {
    readonly inserted: readonly CitationEditRow[];
    readonly updated: readonly CitationEditRow[];
  },
): {
  readonly baseline: readonly CitationEditRow[];
  readonly current: readonly CitationDraft[];
} {
  const savedById = new Map(
    [...result.inserted, ...result.updated].map((row) => [row.id, row]),
  );
  const baselineById = new Map(baseline.map((row) => [row.id, row]));

  const nextBaseline: CitationEditRow[] = [];
  const nextCurrent: CitationDraft[] = [];

  for (const draft of current) {
    const saved = savedById.get(draft.id);
    if (saved !== undefined) {
      nextBaseline.push(saved);
      nextCurrent.push(citationsFromLoaded([saved])[0]!);
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

/** Source titles, keyed by id — resolved by the caller (`SourcesSection`,
 * which already has the Sources list loaded), same reason as
 * `sources.ts`'s `RepositoryNameLookup`. */
export type SourceTitleLookup = ReadonlyMap<string, string>;

/** A citation's owner as the `ConflictDialog` heading. `events` / `facts`
 * supply the label for an event-/fact-owned citation; an owner not found in
 * either list (should not happen — the section always loads them together)
 * falls back to a bare label, same posture as `notes.ts`'s `conflictTitle`. */
function conflictOwnerLabel(
  ownerType: CitationSectionOwner,
  ownerId: string,
  events: readonly CitationEventOption[],
  facts: readonly CitationFactOption[],
): string {
  switch (ownerType) {
    case "person":
      return "this person";
    case "event": {
      const event = events.find((candidate) => candidate.id === ownerId);
      return event === undefined
        ? "an event"
        : `their ${eventTypeLabel(event.type, event.typeOther)}`;
    }
    case "fact": {
      const fact = facts.find((candidate) => candidate.id === ownerId);
      return fact === undefined
        ? "a fact"
        : `their ${factTypeLabel(fact.type, fact.typeOther)}`;
    }
    default:
      return assertNever(ownerType);
  }
}

export function describeCitationConflicts(
  conflicts: readonly RowConflict<CitationEditRow>[],
  current: readonly CitationDraft[],
  events: readonly CitationEventOption[],
  facts: readonly CitationFactOption[],
  sourceTitles: SourceTitleLookup,
): readonly ConflictItem[] {
  const currentById = new Map(current.map((draft) => [draft.id, draft]));

  return conflicts.map((conflict): ConflictItem => {
    const mine = currentById.get(conflict.id);
    const ownerType = conflict.theirs?.ownerType ?? mine?.ownerType ?? "person";
    const ownerId = conflict.theirs?.ownerId ?? mine?.ownerId ?? "";

    const fields: ConflictItem["fields"] =
      conflict.theirs === null || mine === undefined
        ? []
        : [
            {
              label: "Source",
              yours: sourceTitles.get(mine.sourceId ?? "") ?? "",
              theirs: sourceTitles.get(conflict.theirs.sourceId) ?? "",
            },
            {
              label: "Page",
              yours: mine.page,
              theirs: conflict.theirs.page ?? "",
            },
            {
              label: "Data",
              yours: mine.dataText,
              theirs: conflict.theirs.dataText ?? "",
            },
            {
              label: "Quality",
              yours: mine.quality === null ? "" : String(mine.quality),
              theirs:
                conflict.theirs.quality === null
                  ? ""
                  : String(conflict.theirs.quality),
            },
            {
              label: "Date",
              yours: mine.dateRaw,
              theirs: conflict.theirs.dateRaw,
            },
          ].filter((field) => field.yours !== field.theirs);

    return {
      id: conflict.id,
      title: `Citation on ${conflictOwnerLabel(ownerType, ownerId, events, facts)}`,
      changedBy: conflict.changedBy,
      deleted: conflict.theirs === null,
      fields,
    };
  });
}

function assertNever(value: never): never {
  throw new Error(`Unhandled citations action: ${JSON.stringify(value)}`);
}
