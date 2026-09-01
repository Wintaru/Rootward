import type { RowConflict } from "@/lib/db/conflict";
import type {
  RepositoryDeleteInput,
  RepositoryEditRow,
  RepositoryFieldValues,
  RepositoryInsertInput,
  RepositoryUpdateInput,
} from "@/lib/db/source-edit";

import type { ConflictItem } from "./conflict";
import { normalizeText } from "./diff";

/**
 * Pure CRUD state for the Sources section's Repositories list (SPEC §8.3,
 * §4.3, §10 item 30) — add / edit / delete over `repository` rows, and the
 * diff that turns the current list against its loaded baseline into a save
 * payload. Structurally the same shape as `additional-names.ts`, minus the
 * reorder — a repository list has no meaningful position, so there is no
 * `moved` action and no `sortOrder` in the diff.
 */

export type RepositoryFieldKey =
  "name" | "address" | "phone" | "email" | "website";

export interface RepositoryDraft {
  readonly id: string;
  readonly updatedAt: string | null;
  readonly name: string;
  readonly address: string;
  readonly phone: string;
  readonly email: string;
  readonly website: string;
}

export type RepositoriesAction =
  | { readonly type: "added"; readonly id: string }
  | {
      readonly type: "field_changed";
      readonly id: string;
      readonly field: RepositoryFieldKey;
      readonly value: string;
    }
  | { readonly type: "removed"; readonly id: string }
  | {
      /** Wholesale replace after a save, safe only because the section
       * disables every control while a save is in flight — see
       * `additional-names.ts`'s identical action. */
      readonly type: "reconciled";
      readonly rows: readonly RepositoryDraft[];
    }
  | {
      /** Applies a `ConflictDialog` resolution to one row (decision 26). */
      readonly type: "row_reset";
      readonly id: string;
      readonly row: RepositoryEditRow | null;
    };

export function repositoriesFromLoaded(
  rows: readonly RepositoryEditRow[],
): readonly RepositoryDraft[] {
  return rows.map((row) => ({
    id: row.id,
    updatedAt: row.updatedAt,
    name: row.name ?? "",
    address: row.address ?? "",
    phone: row.phone ?? "",
    email: row.email ?? "",
    website: row.website ?? "",
  }));
}

function blankRepository(id: string): RepositoryDraft {
  return {
    id,
    updatedAt: null,
    name: "",
    address: "",
    phone: "",
    email: "",
    website: "",
  };
}

export function repositoriesReducer(
  state: readonly RepositoryDraft[],
  action: RepositoriesAction,
): readonly RepositoryDraft[] {
  switch (action.type) {
    case "added":
      return [...state, blankRepository(action.id)];

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
      const restored = repositoriesFromLoaded([action.row])[0]!;
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

export interface RepositoriesDiff {
  readonly inserts: readonly RepositoryInsertInput[];
  readonly updates: readonly RepositoryUpdateInput[];
  readonly deletes: readonly RepositoryDeleteInput[];
}

export function isRepositoriesDiffEmpty(diff: RepositoriesDiff): boolean {
  return (
    diff.inserts.length === 0 &&
    diff.updates.length === 0 &&
    diff.deletes.length === 0
  );
}

function fieldValues(draft: RepositoryDraft): RepositoryFieldValues {
  return {
    name: normalizeText(draft.name),
    address: normalizeText(draft.address),
    phone: normalizeText(draft.phone),
    email: normalizeText(draft.email),
    website: normalizeText(draft.website),
  };
}

function isBlank(values: RepositoryFieldValues): boolean {
  return Object.values(values).every((value) => value === null);
}

export function diffRepositories(
  loaded: readonly RepositoryEditRow[],
  current: readonly RepositoryDraft[],
): RepositoriesDiff {
  const loadedById = new Map(loaded.map((row) => [row.id, row]));

  const inserts: RepositoryInsertInput[] = [];
  const updates: RepositoryUpdateInput[] = [];
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

    const patch: Partial<RepositoryFieldValues> = {
      ...(values.name !== baseline.name ? { name: values.name } : {}),
      ...(values.address !== baseline.address
        ? { address: values.address }
        : {}),
      ...(values.phone !== baseline.phone ? { phone: values.phone } : {}),
      ...(values.email !== baseline.email ? { email: values.email } : {}),
      ...(values.website !== baseline.website
        ? { website: values.website }
        : {}),
    };
    if (Object.keys(patch).length > 0) {
      updates.push({ id: draft.id, expectedUpdatedAt: draft.updatedAt, patch });
    }
  }

  const deletes: RepositoryDeleteInput[] = loaded
    .filter((row) => !keptIds.has(row.id))
    .map((row) => ({ id: row.id, expectedUpdatedAt: row.updatedAt }));

  return { inserts, updates, deletes };
}

// --- post-save reconciliation -------------------------------------------

export function reconcileRepositoriesAfterSave(
  baseline: readonly RepositoryEditRow[],
  current: readonly RepositoryDraft[],
  result: {
    readonly inserted: readonly RepositoryEditRow[];
    readonly updated: readonly RepositoryEditRow[];
  },
): {
  readonly baseline: readonly RepositoryEditRow[];
  readonly current: readonly RepositoryDraft[];
} {
  const savedById = new Map(
    [...result.inserted, ...result.updated].map((row) => [row.id, row]),
  );
  const baselineById = new Map(baseline.map((row) => [row.id, row]));

  const nextBaseline: RepositoryEditRow[] = [];
  const nextCurrent: RepositoryDraft[] = [];

  for (const draft of current) {
    const saved = savedById.get(draft.id);
    if (saved !== undefined) {
      nextBaseline.push(saved);
      nextCurrent.push(repositoriesFromLoaded([saved])[0]!);
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

const REPOSITORY_CONFLICT_FIELDS: ReadonlyMap<
  string,
  (row: RepositoryEditRow) => string
> = new Map([
  ["Name", (row) => row.name ?? ""],
  ["Address", (row) => row.address ?? ""],
  ["Phone", (row) => row.phone ?? ""],
  ["Email", (row) => row.email ?? ""],
  ["Website", (row) => row.website ?? ""],
]);

export function describeRepositoryConflicts(
  conflicts: readonly RowConflict<RepositoryEditRow>[],
  current: readonly RepositoryDraft[],
): readonly ConflictItem[] {
  const currentById = new Map(current.map((draft) => [draft.id, draft]));

  return conflicts.map((conflict): ConflictItem => {
    const mine = currentById.get(conflict.id);
    const mineRow: RepositoryEditRow | null =
      mine === undefined ? null : repositoryDraftAsRow(mine);
    const name = mineRow?.name ?? conflict.theirs?.name ?? null;

    return {
      id: conflict.id,
      title:
        name !== null && name !== "" ? `Repository: ${name}` : "Repository",
      changedBy: conflict.changedBy,
      deleted: conflict.theirs === null,
      fields:
        conflict.theirs === null || mineRow === null
          ? []
          : [...REPOSITORY_CONFLICT_FIELDS.entries()]
              .map(([label, read]) => ({
                label,
                yours: read(mineRow),
                theirs: read(conflict.theirs!),
              }))
              .filter((field) => field.yours !== field.theirs),
    };
  });
}

function repositoryDraftAsRow(draft: RepositoryDraft): RepositoryEditRow {
  return {
    id: draft.id,
    updatedAt: draft.updatedAt ?? "",
    name: draft.name,
    address: draft.address,
    phone: draft.phone,
    email: draft.email,
    website: draft.website,
  };
}

function assertNever(value: never): never {
  throw new Error(`Unhandled repositories action: ${JSON.stringify(value)}`);
}
