import type { RowConflict } from "@/lib/db/conflict";
import type {
  SourceDeleteInput,
  SourceEditRow,
  SourceFieldValues,
  SourceInsertInput,
  SourceUpdateInput,
} from "@/lib/db/source-edit";

import type { ConflictItem } from "./conflict";
import { normalizeText } from "./diff";

/**
 * Pure CRUD state for the Sources section's Sources list (SPEC §8.3, §4.3,
 * §10 item 30) — add / edit / delete over `source` rows, and the diff that
 * turns the current list against its loaded baseline into a save payload.
 * Same shape as `repositories.ts`, plus `repositoryId` — a plain nullable
 * string identifying a row from the Repositories list above it (picked via a
 * `<select>`, not typed), so it diffs like any other field even though it is
 * chosen rather than typed.
 */

export type SourceFieldKey =
  "title" | "author" | "publicationInfo" | "repositoryId" | "sourceText";

export interface SourceDraft {
  readonly id: string;
  readonly updatedAt: string | null;
  readonly title: string;
  readonly author: string;
  readonly publicationInfo: string;
  readonly repositoryId: string | null;
  readonly sourceText: string;
}

export type SourcesAction =
  | { readonly type: "added"; readonly id: string }
  | {
      readonly type: "field_changed";
      readonly id: string;
      readonly field: SourceFieldKey;
      readonly value: string | null;
    }
  | { readonly type: "removed"; readonly id: string }
  | {
      /** Wholesale replace after a save, safe only because the section
       * disables every control while a save is in flight — see
       * `additional-names.ts`'s identical action. */
      readonly type: "reconciled";
      readonly rows: readonly SourceDraft[];
    }
  | {
      /** Applies a `ConflictDialog` resolution to one row (decision 26). */
      readonly type: "row_reset";
      readonly id: string;
      readonly row: SourceEditRow | null;
    };

export function sourcesFromLoaded(
  rows: readonly SourceEditRow[],
): readonly SourceDraft[] {
  return rows.map((row) => ({
    id: row.id,
    updatedAt: row.updatedAt,
    title: row.title ?? "",
    author: row.author ?? "",
    publicationInfo: row.publicationInfo ?? "",
    repositoryId: row.repositoryId,
    sourceText: row.sourceText ?? "",
  }));
}

function blankSource(id: string): SourceDraft {
  return {
    id,
    updatedAt: null,
    title: "",
    author: "",
    publicationInfo: "",
    repositoryId: null,
    sourceText: "",
  };
}

export function sourcesReducer(
  state: readonly SourceDraft[],
  action: SourcesAction,
): readonly SourceDraft[] {
  switch (action.type) {
    case "added":
      return [...state, blankSource(action.id)];

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
      const restored = sourcesFromLoaded([action.row])[0]!;
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

// --- save diff ----------------------------------------------------------

export interface SourcesDiff {
  readonly inserts: readonly SourceInsertInput[];
  readonly updates: readonly SourceUpdateInput[];
  readonly deletes: readonly SourceDeleteInput[];
}

export function isSourcesDiffEmpty(diff: SourcesDiff): boolean {
  return (
    diff.inserts.length === 0 &&
    diff.updates.length === 0 &&
    diff.deletes.length === 0
  );
}

function fieldValues(draft: SourceDraft): SourceFieldValues {
  return {
    title: normalizeText(draft.title),
    author: normalizeText(draft.author),
    publicationInfo: normalizeText(draft.publicationInfo),
    repositoryId: draft.repositoryId,
    sourceText: normalizeText(draft.sourceText),
  };
}

function isBlank(values: SourceFieldValues): boolean {
  return (
    values.title === null &&
    values.author === null &&
    values.publicationInfo === null &&
    values.repositoryId === null &&
    values.sourceText === null
  );
}

export function diffSources(
  loaded: readonly SourceEditRow[],
  current: readonly SourceDraft[],
): SourcesDiff {
  const loadedById = new Map(loaded.map((row) => [row.id, row]));

  const inserts: SourceInsertInput[] = [];
  const updates: SourceUpdateInput[] = [];
  const keptIds = new Set<string>();

  for (const draft of current) {
    const values = fieldValues(draft);

    if (draft.updatedAt === null) {
      // A row added but left entirely blank is not worth a save.
      if (!isBlank(values)) {
        inserts.push({ id: draft.id, ...values });
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

    const patch: Partial<SourceFieldValues> = {
      ...(values.title !== baseline.title ? { title: values.title } : {}),
      ...(values.author !== baseline.author ? { author: values.author } : {}),
      ...(values.publicationInfo !== baseline.publicationInfo
        ? { publicationInfo: values.publicationInfo }
        : {}),
      ...(values.repositoryId !== baseline.repositoryId
        ? { repositoryId: values.repositoryId }
        : {}),
      ...(values.sourceText !== baseline.sourceText
        ? { sourceText: values.sourceText }
        : {}),
    };
    if (Object.keys(patch).length > 0) {
      updates.push({ id: draft.id, expectedUpdatedAt: draft.updatedAt, patch });
    }
  }

  const deletes: SourceDeleteInput[] = loaded
    .filter((row) => !keptIds.has(row.id))
    .map((row) => ({ id: row.id, expectedUpdatedAt: row.updatedAt }));

  return { inserts, updates, deletes };
}

// --- post-save reconciliation -------------------------------------------

export function reconcileSourcesAfterSave(
  baseline: readonly SourceEditRow[],
  current: readonly SourceDraft[],
  result: {
    readonly inserted: readonly SourceEditRow[];
    readonly updated: readonly SourceEditRow[];
  },
): {
  readonly baseline: readonly SourceEditRow[];
  readonly current: readonly SourceDraft[];
} {
  const savedById = new Map(
    [...result.inserted, ...result.updated].map((row) => [row.id, row]),
  );
  const baselineById = new Map(baseline.map((row) => [row.id, row]));

  const nextBaseline: SourceEditRow[] = [];
  const nextCurrent: SourceDraft[] = [];

  for (const draft of current) {
    const saved = savedById.get(draft.id);
    if (saved !== undefined) {
      nextBaseline.push(saved);
      nextCurrent.push(sourcesFromLoaded([saved])[0]!);
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

/** Repository names, keyed by id — resolved by the caller (`SourcesSection`,
 * which already has the Repositories list loaded) so this pure module never
 * needs its own copy of that data just to label a conflict field. */
export type RepositoryNameLookup = ReadonlyMap<string, string>;

function repositoryLabel(
  repositoryId: string | null,
  names: RepositoryNameLookup,
): string {
  if (repositoryId === null) {
    return "";
  }
  return names.get(repositoryId) ?? "";
}

export function describeSourceConflicts(
  conflicts: readonly RowConflict<SourceEditRow>[],
  current: readonly SourceDraft[],
  repositoryNames: RepositoryNameLookup,
): readonly ConflictItem[] {
  const currentById = new Map(current.map((draft) => [draft.id, draft]));

  return conflicts.map((conflict): ConflictItem => {
    const mine = currentById.get(conflict.id);
    const mineRow: SourceEditRow | null =
      mine === undefined ? null : sourceDraftAsRow(mine);
    const title = mineRow?.title ?? conflict.theirs?.title ?? null;

    const fields: ConflictItem["fields"] =
      conflict.theirs === null || mineRow === null
        ? []
        : [
            {
              label: "Title",
              yours: mineRow.title ?? "",
              theirs: conflict.theirs.title ?? "",
            },
            {
              label: "Author",
              yours: mineRow.author ?? "",
              theirs: conflict.theirs.author ?? "",
            },
            {
              label: "Publication info",
              yours: mineRow.publicationInfo ?? "",
              theirs: conflict.theirs.publicationInfo ?? "",
            },
            {
              label: "Repository",
              yours: repositoryLabel(mineRow.repositoryId, repositoryNames),
              theirs: repositoryLabel(
                conflict.theirs.repositoryId,
                repositoryNames,
              ),
            },
            {
              label: "Source text",
              yours: mineRow.sourceText ?? "",
              theirs: conflict.theirs.sourceText ?? "",
            },
          ].filter((field) => field.yours !== field.theirs);

    return {
      id: conflict.id,
      title: title !== null && title !== "" ? `Source: ${title}` : "Source",
      changedBy: conflict.changedBy,
      deleted: conflict.theirs === null,
      fields,
    };
  });
}

function sourceDraftAsRow(draft: SourceDraft): SourceEditRow {
  return {
    id: draft.id,
    updatedAt: draft.updatedAt ?? "",
    title: draft.title,
    author: draft.author,
    publicationInfo: draft.publicationInfo,
    repositoryId: draft.repositoryId,
    sourceText: draft.sourceText,
  };
}

function assertNever(value: never): never {
  throw new Error(`Unhandled sources action: ${JSON.stringify(value)}`);
}
