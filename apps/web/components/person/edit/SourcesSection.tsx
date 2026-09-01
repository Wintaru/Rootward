"use client";

import { useId, useReducer, useState } from "react";

import {
  saveCitations,
  saveRepositories,
  saveSources,
} from "@/app/person/[personId]/edit/actions";
import type { RowConflict } from "@/lib/db/conflict";
import type {
  CitationEditRow,
  RepositoryEditRow,
  SourceEditRow,
  SourcesSectionData,
} from "@/lib/db";
import type { ConflictResolution } from "@/lib/edit/conflict";
import {
  citationsFromLoaded,
  citationsReducer,
  describeCitationConflicts,
  diffCitations,
  isCitationsDiffEmpty,
  reconcileCitationsAfterSave,
  type CitationDraft,
  type CitationFieldKey,
  type CitationsDiff,
} from "@/lib/edit/citations";
import {
  describeRepositoryConflicts,
  diffRepositories,
  isRepositoriesDiffEmpty,
  reconcileRepositoriesAfterSave,
  repositoriesFromLoaded,
  repositoriesReducer,
  type RepositoriesDiff,
  type RepositoryDraft,
  type RepositoryFieldKey,
} from "@/lib/edit/repositories";
import {
  describeSourceConflicts,
  diffSources,
  isSourcesDiffEmpty,
  reconcileSourcesAfterSave,
  sourcesFromLoaded,
  sourcesReducer,
  type SourceDraft,
  type SourceFieldKey,
  type SourcesDiff,
} from "@/lib/edit/sources";
import { eventTypeLabel, factTypeLabel } from "@/lib/person/labels";

import { ConflictDialog } from "./ConflictDialog";
import { DateInput } from "./DateInput";
import { Field, inputClass, SaveBar } from "./form";

/**
 * Sources (SPEC §8.3, §4.3, §10 item 30) — three independently-saved lists,
 * stacked in save order: Repositories, then Sources (each may link to a
 * repository), then Citations (each links to a source, and is owned by the
 * person or one of their events/facts). Each list has its own add/edit/
 * delete state, `SaveBar`, and `ConflictDialog` — the same `performSave` /
 * `retryKeepMine` / `resolveConflict` shape every other multi-row section
 * uses (see `FactsSection.tsx` for the shared mechanics), tripled rather than
 * shared through a hook (a known, already-deferred piece of duplication
 * across every multi-row section — see `DECISIONS.md`).
 *
 * A source's repository picker and a citation's source picker only offer
 * *saved* rows (`repoBaseline` / `sourceBaseline`, not the in-progress
 * drafts) — each list's Save button is independent, so a citation cannot
 * reference a source id that has not actually round-tripped yet. Saving
 * order top-to-bottom (repository, then source, then citation) is how a
 * fresh link actually gets made; nothing in the schema enforces that order
 * within one save (see `source-edit.ts`'s module doc for the FK-ordering
 * note that applies if these three were ever combined into one save instead).
 */
export function SourcesSection({
  personId,
  loaded,
}: {
  readonly personId: string;
  readonly loaded: SourcesSectionData;
}) {
  const repositories = useRepositoriesList(personId, loaded.repositories);
  const sources = useSourcesList(personId, loaded.sources);
  const citations = useCitationsList(personId, loaded.citations);

  return (
    <div className="flex flex-col gap-10">
      <section className="flex flex-col gap-4">
        <h3 className="text-sm font-semibold">Repositories</h3>
        <ConflictDialog
          items={
            repositories.conflictState === null
              ? []
              : describeRepositoryConflicts(
                  repositories.conflictState.conflicts,
                  repositories.rows,
                )
          }
          disabled={repositories.saving}
          onResolve={repositories.resolveConflict}
        />
        <ul className="flex flex-col gap-3">
          {repositories.rows.map((row) => (
            <RepositoryRow
              key={row.id}
              row={row}
              disabled={repositories.saving}
              onField={(field, value) =>
                repositories.field(row.id, field, value)
              }
              onRemove={() => repositories.remove(row.id)}
            />
          ))}
          {repositories.rows.length === 0 && (
            <li className="text-muted-foreground text-sm">
              No repositories recorded.
            </li>
          )}
        </ul>
        <button
          type="button"
          onClick={repositories.addRow}
          disabled={repositories.saving}
          className="border-border hover:bg-accent w-fit rounded-md border px-3 py-1.5 text-sm font-medium disabled:opacity-50"
        >
          Add a repository
        </button>
        <SaveBar
          dirty={repositories.dirty}
          status={repositories.status}
          error={repositories.error}
          onSave={repositories.save}
          conflictMessage="Some repositories changed elsewhere and were not saved; the rest were."
        />
      </section>

      <section className="flex flex-col gap-4">
        <h3 className="text-sm font-semibold">Sources</h3>
        <ConflictDialog
          items={
            sources.conflictState === null
              ? []
              : describeSourceConflicts(
                  sources.conflictState.conflicts,
                  sources.rows,
                  repositories.nameLookup,
                )
          }
          disabled={sources.saving}
          onResolve={sources.resolveConflict}
        />
        <ul className="flex flex-col gap-3">
          {sources.rows.map((row) => (
            <SourceRow
              key={row.id}
              row={row}
              repositories={repositories.baseline}
              disabled={sources.saving}
              onField={(field, value) => sources.field(row.id, field, value)}
              onRemove={() => sources.remove(row.id)}
            />
          ))}
          {sources.rows.length === 0 && (
            <li className="text-muted-foreground text-sm">
              No sources recorded.
            </li>
          )}
        </ul>
        <button
          type="button"
          onClick={sources.addRow}
          disabled={sources.saving}
          className="border-border hover:bg-accent w-fit rounded-md border px-3 py-1.5 text-sm font-medium disabled:opacity-50"
        >
          Add a source
        </button>
        <SaveBar
          dirty={sources.dirty}
          status={sources.status}
          error={sources.error}
          onSave={sources.save}
          conflictMessage="Some sources changed elsewhere and were not saved; the rest were."
        />
      </section>

      <section className="flex flex-col gap-6">
        <h3 className="text-sm font-semibold">Citations</h3>
        <ConflictDialog
          items={
            citations.conflictState === null
              ? []
              : describeCitationConflicts(
                  citations.conflictState.conflicts,
                  citations.rows,
                  loaded.citations.events,
                  loaded.citations.facts,
                  sources.titleLookup,
                )
          }
          disabled={citations.saving}
          onResolve={citations.resolveConflict}
        />

        <CitationGroup
          title="About this person"
          rows={citations.rows.filter((row) => row.ownerType === "person")}
          sources={sources.baseline}
          disabled={citations.saving}
          onAdd={() => citations.addRow("person", personId)}
          onField={citations.field}
          onRemove={citations.remove}
        />

        {loaded.citations.events.map((event) => (
          <CitationGroup
            key={event.id}
            title={`About their ${eventTypeLabel(event.type, event.typeOther)}`}
            rows={citations.rows.filter(
              (row) => row.ownerType === "event" && row.ownerId === event.id,
            )}
            sources={sources.baseline}
            disabled={citations.saving}
            onAdd={() => citations.addRow("event", event.id)}
            onField={citations.field}
            onRemove={citations.remove}
          />
        ))}

        {loaded.citations.facts.map((fact) => (
          <CitationGroup
            key={fact.id}
            title={`About their ${factTypeLabel(fact.type, fact.typeOther)}`}
            rows={citations.rows.filter(
              (row) => row.ownerType === "fact" && row.ownerId === fact.id,
            )}
            sources={sources.baseline}
            disabled={citations.saving}
            onAdd={() => citations.addRow("fact", fact.id)}
            onField={citations.field}
            onRemove={citations.remove}
          />
        ))}

        <SaveBar
          dirty={citations.dirty}
          status={citations.status}
          error={citations.error}
          onSave={citations.save}
          conflictMessage="Some citations changed elsewhere and were not saved; the rest were."
        />
      </section>
    </div>
  );
}

// ===========================================================================
// Repositories
// ===========================================================================

function useRepositoriesList(
  personId: string,
  loaded: readonly RepositoryEditRow[],
) {
  const [baseline, setBaseline] = useState(loaded);
  const [rows, dispatch] = useReducer(
    repositoriesReducer,
    loaded,
    repositoriesFromLoaded,
  );
  const [status, setStatus] = useState<
    "idle" | "saving" | "saved" | "conflict" | "error"
  >("idle");
  const [error, setError] = useState<string | null>(null);
  const [conflictState, setConflictState] = useState<{
    readonly diff: RepositoriesDiff;
    readonly conflicts: readonly RowConflict<RepositoryEditRow>[];
  } | null>(null);

  const diff = diffRepositories(baseline, rows);
  const dirty = !isRepositoriesDiffEmpty(diff);
  const saving = status === "saving";

  function addRow() {
    dispatch({ type: "added", id: crypto.randomUUID() });
    setStatus("idle");
  }

  function field(id: string, fieldKey: RepositoryFieldKey, value: string) {
    dispatch({ type: "field_changed", id, field: fieldKey, value });
    setStatus("idle");
  }

  function remove(id: string) {
    dispatch({ type: "removed", id });
    setStatus("idle");
  }

  async function performSave(diffToSend: RepositoriesDiff) {
    setStatus("saving");
    setError(null);
    try {
      const outcome = await saveRepositories({ personId, ...diffToSend });
      if (outcome.status !== "saved") {
        setError(outcome.message);
        setStatus("error");
        return;
      }
      const reconciled = reconcileRepositoriesAfterSave(
        baseline,
        rows,
        outcome.result,
      );
      setBaseline(reconciled.baseline);
      dispatch({ type: "reconciled", rows: reconciled.current });

      const touchedIds = new Set([
        ...diffToSend.updates.map((update) => update.id),
        ...diffToSend.deletes.map((del) => del.id),
      ]);
      const previousConflicts = conflictState?.conflicts ?? [];
      const merged = [
        ...previousConflicts.filter((conflict) => !touchedIds.has(conflict.id)),
        ...outcome.result.conflicts,
      ];

      if (merged.length === 0) {
        setConflictState(null);
        setStatus("saved");
      } else {
        setConflictState({
          diff: conflictState?.diff ?? diffToSend,
          conflicts: merged,
        });
        setStatus("conflict");
      }
    } catch {
      setError("Something went wrong. Try again in a moment.");
      setStatus("error");
    }
  }

  async function save() {
    if (!dirty || status === "saving") {
      return;
    }
    await performSave(diff);
  }

  function retryKeepMine(id: string) {
    if (conflictState === null) {
      return;
    }
    const conflict = conflictState.conflicts.find((c) => c.id === id);
    if (conflict === undefined || conflict.theirs === null) {
      return;
    }
    const update = conflictState.diff.updates.find((u) => u.id === id);
    const del = conflictState.diff.deletes.find((d) => d.id === id);
    const singleDiff: RepositoriesDiff =
      update !== undefined
        ? {
            inserts: [],
            updates: [
              { ...update, expectedUpdatedAt: conflict.theirs.updatedAt },
            ],
            deletes: [],
          }
        : del !== undefined
          ? {
              inserts: [],
              updates: [],
              deletes: [
                { id: del.id, expectedUpdatedAt: conflict.theirs.updatedAt },
              ],
            }
          : { inserts: [], updates: [], deletes: [] };
    void performSave(singleDiff);
  }

  function resolveConflict(id: string, resolution: ConflictResolution) {
    if (conflictState === null || status === "saving") {
      return;
    }
    const conflict = conflictState.conflicts.find((c) => c.id === id);
    if (conflict === undefined) {
      return;
    }
    if (resolution === "keep-mine") {
      retryKeepMine(id);
      return;
    }
    const nextBaseline =
      conflict.theirs === null
        ? baseline.filter((row) => row.id !== id)
        : [...baseline.filter((row) => row.id !== id), conflict.theirs];
    setBaseline(nextBaseline);
    dispatch({ type: "row_reset", id, row: conflict.theirs });

    const remaining = conflictState.conflicts.filter((c) => c.id !== id);
    setConflictState(
      remaining.length === 0
        ? null
        : { ...conflictState, conflicts: remaining },
    );
    if (remaining.length === 0) {
      setStatus("saved");
    }
  }

  const nameLookup = new Map(
    baseline
      .filter((row) => row.name !== null)
      .map((row) => [row.id, row.name as string]),
  );

  return {
    baseline,
    rows,
    status,
    error,
    conflictState,
    dirty,
    saving,
    addRow,
    field,
    remove,
    save,
    resolveConflict,
    nameLookup,
  };
}

function RepositoryRow({
  row,
  disabled,
  onField,
  onRemove,
}: {
  readonly row: RepositoryDraft;
  readonly disabled: boolean;
  readonly onField: (field: RepositoryFieldKey, value: string) => void;
  readonly onRemove: () => void;
}) {
  const nameId = useId();
  const addressId = useId();
  const phoneId = useId();
  const emailId = useId();
  const websiteId = useId();

  return (
    <li className="border-border flex flex-col gap-3 rounded-lg border p-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Field label="Name" htmlFor={nameId}>
          <input
            id={nameId}
            value={row.name}
            disabled={disabled}
            onChange={(e) => onField("name", e.target.value)}
            className={inputClass}
          />
        </Field>
        <Field label="Address" htmlFor={addressId}>
          <input
            id={addressId}
            value={row.address}
            disabled={disabled}
            onChange={(e) => onField("address", e.target.value)}
            className={inputClass}
          />
        </Field>
        <Field label="Phone" htmlFor={phoneId}>
          <input
            id={phoneId}
            value={row.phone}
            disabled={disabled}
            onChange={(e) => onField("phone", e.target.value)}
            className={inputClass}
          />
        </Field>
        <Field label="Email" htmlFor={emailId}>
          <input
            id={emailId}
            value={row.email}
            disabled={disabled}
            onChange={(e) => onField("email", e.target.value)}
            className={inputClass}
          />
        </Field>
        <Field label="Website" htmlFor={websiteId}>
          <input
            id={websiteId}
            value={row.website}
            disabled={disabled}
            onChange={(e) => onField("website", e.target.value)}
            className={inputClass}
          />
        </Field>
      </div>
      <button
        type="button"
        onClick={onRemove}
        disabled={disabled}
        className="text-destructive w-fit rounded-md px-2 py-1 text-xs font-medium disabled:opacity-40"
      >
        Remove
      </button>
    </li>
  );
}

// ===========================================================================
// Sources
// ===========================================================================

function useSourcesList(personId: string, loaded: readonly SourceEditRow[]) {
  const [baseline, setBaseline] = useState(loaded);
  const [rows, dispatch] = useReducer(
    sourcesReducer,
    loaded,
    sourcesFromLoaded,
  );
  const [status, setStatus] = useState<
    "idle" | "saving" | "saved" | "conflict" | "error"
  >("idle");
  const [error, setError] = useState<string | null>(null);
  const [conflictState, setConflictState] = useState<{
    readonly diff: SourcesDiff;
    readonly conflicts: readonly RowConflict<SourceEditRow>[];
  } | null>(null);

  const diff = diffSources(baseline, rows);
  const dirty = !isSourcesDiffEmpty(diff);
  const saving = status === "saving";

  function addRow() {
    dispatch({ type: "added", id: crypto.randomUUID() });
    setStatus("idle");
  }

  function field(id: string, fieldKey: SourceFieldKey, value: string | null) {
    dispatch({ type: "field_changed", id, field: fieldKey, value });
    setStatus("idle");
  }

  function remove(id: string) {
    dispatch({ type: "removed", id });
    setStatus("idle");
  }

  async function performSave(diffToSend: SourcesDiff) {
    setStatus("saving");
    setError(null);
    try {
      const outcome = await saveSources({ personId, ...diffToSend });
      if (outcome.status !== "saved") {
        setError(outcome.message);
        setStatus("error");
        return;
      }
      const reconciled = reconcileSourcesAfterSave(
        baseline,
        rows,
        outcome.result,
      );
      setBaseline(reconciled.baseline);
      dispatch({ type: "reconciled", rows: reconciled.current });

      const touchedIds = new Set([
        ...diffToSend.updates.map((update) => update.id),
        ...diffToSend.deletes.map((del) => del.id),
      ]);
      const previousConflicts = conflictState?.conflicts ?? [];
      const merged = [
        ...previousConflicts.filter((conflict) => !touchedIds.has(conflict.id)),
        ...outcome.result.conflicts,
      ];

      if (merged.length === 0) {
        setConflictState(null);
        setStatus("saved");
      } else {
        setConflictState({
          diff: conflictState?.diff ?? diffToSend,
          conflicts: merged,
        });
        setStatus("conflict");
      }
    } catch {
      setError("Something went wrong. Try again in a moment.");
      setStatus("error");
    }
  }

  async function save() {
    if (!dirty || status === "saving") {
      return;
    }
    await performSave(diff);
  }

  function retryKeepMine(id: string) {
    if (conflictState === null) {
      return;
    }
    const conflict = conflictState.conflicts.find((c) => c.id === id);
    if (conflict === undefined || conflict.theirs === null) {
      return;
    }
    const update = conflictState.diff.updates.find((u) => u.id === id);
    const del = conflictState.diff.deletes.find((d) => d.id === id);
    const singleDiff: SourcesDiff =
      update !== undefined
        ? {
            inserts: [],
            updates: [
              { ...update, expectedUpdatedAt: conflict.theirs.updatedAt },
            ],
            deletes: [],
          }
        : del !== undefined
          ? {
              inserts: [],
              updates: [],
              deletes: [
                { id: del.id, expectedUpdatedAt: conflict.theirs.updatedAt },
              ],
            }
          : { inserts: [], updates: [], deletes: [] };
    void performSave(singleDiff);
  }

  function resolveConflict(id: string, resolution: ConflictResolution) {
    if (conflictState === null || status === "saving") {
      return;
    }
    const conflict = conflictState.conflicts.find((c) => c.id === id);
    if (conflict === undefined) {
      return;
    }
    if (resolution === "keep-mine") {
      retryKeepMine(id);
      return;
    }
    const nextBaseline =
      conflict.theirs === null
        ? baseline.filter((row) => row.id !== id)
        : [...baseline.filter((row) => row.id !== id), conflict.theirs];
    setBaseline(nextBaseline);
    dispatch({ type: "row_reset", id, row: conflict.theirs });

    const remaining = conflictState.conflicts.filter((c) => c.id !== id);
    setConflictState(
      remaining.length === 0
        ? null
        : { ...conflictState, conflicts: remaining },
    );
    if (remaining.length === 0) {
      setStatus("saved");
    }
  }

  const titleLookup = new Map(
    baseline
      .filter((row) => row.title !== null)
      .map((row) => [row.id, row.title as string]),
  );

  return {
    baseline,
    rows,
    status,
    error,
    conflictState,
    dirty,
    saving,
    addRow,
    field,
    remove,
    save,
    resolveConflict,
    titleLookup,
  };
}

function SourceRow({
  row,
  repositories,
  disabled,
  onField,
  onRemove,
}: {
  readonly row: SourceDraft;
  readonly repositories: readonly RepositoryEditRow[];
  readonly disabled: boolean;
  readonly onField: (field: SourceFieldKey, value: string | null) => void;
  readonly onRemove: () => void;
}) {
  const titleId = useId();
  const authorId = useId();
  const publicationId = useId();
  const repositoryId = useId();
  const sourceTextId = useId();

  return (
    <li className="border-border flex flex-col gap-3 rounded-lg border p-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Field label="Title" htmlFor={titleId}>
          <input
            id={titleId}
            value={row.title}
            disabled={disabled}
            onChange={(e) => onField("title", e.target.value)}
            className={inputClass}
          />
        </Field>
        <Field label="Author" htmlFor={authorId}>
          <input
            id={authorId}
            value={row.author}
            disabled={disabled}
            onChange={(e) => onField("author", e.target.value)}
            className={inputClass}
          />
        </Field>
        <Field label="Publication info" htmlFor={publicationId}>
          <input
            id={publicationId}
            value={row.publicationInfo}
            disabled={disabled}
            onChange={(e) => onField("publicationInfo", e.target.value)}
            className={inputClass}
          />
        </Field>
        <Field label="Repository" htmlFor={repositoryId}>
          <select
            id={repositoryId}
            value={row.repositoryId ?? ""}
            disabled={disabled}
            onChange={(e) =>
              onField(
                "repositoryId",
                e.target.value === "" ? null : e.target.value,
              )
            }
            className={inputClass}
          >
            <option value="">None</option>
            {repositories.map((repo) => (
              <option key={repo.id} value={repo.id}>
                {repo.name ?? "Unnamed repository"}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <Field label="Source text" htmlFor={sourceTextId}>
        <textarea
          id={sourceTextId}
          value={row.sourceText}
          disabled={disabled}
          onChange={(e) => onField("sourceText", e.target.value)}
          rows={2}
          className={inputClass}
        />
      </Field>
      {repositories.length === 0 && (
        <p className="text-muted-foreground text-xs">
          Save a new repository above before it can be linked here.
        </p>
      )}
      {row.updatedAt !== null && (
        <p className="text-destructive text-xs">
          Removing this source also removes every citation that references it —
          on this person and on anyone else in the tree.
        </p>
      )}
      <button
        type="button"
        onClick={onRemove}
        disabled={disabled}
        className="text-destructive w-fit rounded-md px-2 py-1 text-xs font-medium disabled:opacity-40"
      >
        Remove
      </button>
    </li>
  );
}

// ===========================================================================
// Citations
// ===========================================================================

const QUALITY_OPTIONS: readonly {
  readonly value: number;
  readonly label: string;
}[] = [
  { value: 0, label: "0 — Unreliable" },
  { value: 1, label: "1 — Questionable" },
  { value: 2, label: "2 — Secondary" },
  { value: 3, label: "3 — Direct/primary" },
];

function useCitationsList(
  personId: string,
  loaded: { readonly citations: readonly CitationEditRow[] },
) {
  const [baseline, setBaseline] = useState(loaded.citations);
  const [rows, dispatch] = useReducer(
    citationsReducer,
    loaded.citations,
    citationsFromLoaded,
  );
  const [status, setStatus] = useState<
    "idle" | "saving" | "saved" | "conflict" | "error"
  >("idle");
  const [error, setError] = useState<string | null>(null);
  const [conflictState, setConflictState] = useState<{
    readonly diff: CitationsDiff;
    readonly conflicts: readonly RowConflict<CitationEditRow>[];
  } | null>(null);

  const diff = diffCitations(baseline, rows);
  const dirty = !isCitationsDiffEmpty(diff);
  const saving = status === "saving";

  function addRow(ownerType: CitationDraft["ownerType"], ownerId: string) {
    dispatch({ type: "added", id: crypto.randomUUID(), ownerType, ownerId });
    setStatus("idle");
  }

  function field(
    id: string,
    fieldKey: CitationFieldKey,
    value: string | number | null,
  ) {
    dispatch({ type: "field_changed", id, field: fieldKey, value });
    setStatus("idle");
  }

  function remove(id: string) {
    dispatch({ type: "removed", id });
    setStatus("idle");
  }

  async function performSave(diffToSend: CitationsDiff) {
    setStatus("saving");
    setError(null);
    try {
      const outcome = await saveCitations({ personId, ...diffToSend });
      if (outcome.status !== "saved") {
        setError(outcome.message);
        setStatus("error");
        return;
      }
      const reconciled = reconcileCitationsAfterSave(
        baseline,
        rows,
        outcome.result,
      );
      setBaseline(reconciled.baseline);
      dispatch({ type: "reconciled", rows: reconciled.current });

      const touchedIds = new Set([
        ...diffToSend.updates.map((update) => update.id),
        ...diffToSend.deletes.map((del) => del.id),
      ]);
      const previousConflicts = conflictState?.conflicts ?? [];
      const merged = [
        ...previousConflicts.filter((conflict) => !touchedIds.has(conflict.id)),
        ...outcome.result.conflicts,
      ];

      if (merged.length === 0) {
        setConflictState(null);
        setStatus("saved");
      } else {
        setConflictState({
          diff: conflictState?.diff ?? diffToSend,
          conflicts: merged,
        });
        setStatus("conflict");
      }
    } catch {
      setError("Something went wrong. Try again in a moment.");
      setStatus("error");
    }
  }

  async function save() {
    if (!dirty || status === "saving") {
      return;
    }
    await performSave(diff);
  }

  function retryKeepMine(id: string) {
    if (conflictState === null) {
      return;
    }
    const conflict = conflictState.conflicts.find((c) => c.id === id);
    if (conflict === undefined || conflict.theirs === null) {
      return;
    }
    const update = conflictState.diff.updates.find((u) => u.id === id);
    const del = conflictState.diff.deletes.find((d) => d.id === id);
    const singleDiff: CitationsDiff =
      update !== undefined
        ? {
            inserts: [],
            updates: [
              { ...update, expectedUpdatedAt: conflict.theirs.updatedAt },
            ],
            deletes: [],
          }
        : del !== undefined
          ? {
              inserts: [],
              updates: [],
              deletes: [
                { id: del.id, expectedUpdatedAt: conflict.theirs.updatedAt },
              ],
            }
          : { inserts: [], updates: [], deletes: [] };
    void performSave(singleDiff);
  }

  function resolveConflict(id: string, resolution: ConflictResolution) {
    if (conflictState === null || status === "saving") {
      return;
    }
    const conflict = conflictState.conflicts.find((c) => c.id === id);
    if (conflict === undefined) {
      return;
    }
    if (resolution === "keep-mine") {
      retryKeepMine(id);
      return;
    }
    const nextBaseline =
      conflict.theirs === null
        ? baseline.filter((row) => row.id !== id)
        : [...baseline.filter((row) => row.id !== id), conflict.theirs];
    setBaseline(nextBaseline);
    dispatch({ type: "row_reset", id, row: conflict.theirs });

    const remaining = conflictState.conflicts.filter((c) => c.id !== id);
    setConflictState(
      remaining.length === 0
        ? null
        : { ...conflictState, conflicts: remaining },
    );
    if (remaining.length === 0) {
      setStatus("saved");
    }
  }

  return {
    rows,
    status,
    error,
    conflictState,
    dirty,
    saving,
    addRow,
    field,
    remove,
    save,
    resolveConflict,
  };
}

function CitationGroup({
  title,
  rows,
  sources,
  disabled,
  onAdd,
  onField,
  onRemove,
}: {
  readonly title: string;
  readonly rows: readonly CitationDraft[];
  readonly sources: readonly SourceEditRow[];
  readonly disabled: boolean;
  readonly onAdd: () => void;
  readonly onField: (
    id: string,
    field: CitationFieldKey,
    value: string | number | null,
  ) => void;
  readonly onRemove: (id: string) => void;
}) {
  return (
    <div className="flex flex-col gap-3">
      <h4 className="text-sm font-medium">{title}</h4>
      <ul className="flex flex-col gap-3">
        {rows.map((row) => (
          <CitationRow
            key={row.id}
            row={row}
            sources={sources}
            disabled={disabled}
            onField={(field, value) => onField(row.id, field, value)}
            onRemove={() => onRemove(row.id)}
          />
        ))}
        {rows.length === 0 && (
          <li className="text-muted-foreground text-sm">
            No citations recorded.
          </li>
        )}
      </ul>
      <button
        type="button"
        onClick={onAdd}
        disabled={disabled}
        className="border-border hover:bg-accent w-fit rounded-md border px-3 py-1.5 text-sm font-medium disabled:opacity-50"
      >
        Add a citation
      </button>
    </div>
  );
}

function CitationRow({
  row,
  sources,
  disabled,
  onField,
  onRemove,
}: {
  readonly row: CitationDraft;
  readonly sources: readonly SourceEditRow[];
  readonly disabled: boolean;
  readonly onField: (
    field: CitationFieldKey,
    value: string | number | null,
  ) => void;
  readonly onRemove: () => void;
}) {
  const sourceId = useId();
  const pageId = useId();
  const dataId = useId();
  const qualityId = useId();
  const dateId = useId();

  return (
    <li className="border-border flex flex-col gap-3 rounded-lg border p-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Field label="Source" htmlFor={sourceId}>
          <select
            id={sourceId}
            value={row.sourceId ?? ""}
            disabled={disabled}
            onChange={(e) =>
              onField("sourceId", e.target.value === "" ? null : e.target.value)
            }
            className={inputClass}
          >
            <option value="" disabled={row.sourceId !== null}>
              Choose a source…
            </option>
            {sources.map((source) => (
              <option key={source.id} value={source.id}>
                {source.title ?? "Untitled source"}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Page" htmlFor={pageId}>
          <input
            id={pageId}
            value={row.page}
            disabled={disabled}
            onChange={(e) => onField("page", e.target.value)}
            className={inputClass}
          />
        </Field>

        <DateInput
          id={dateId}
          label="Date"
          value={row.dateRaw}
          disabled={disabled}
          onChange={(value) => onField("dateRaw", value)}
        />

        <Field label="Quality" htmlFor={qualityId}>
          <select
            id={qualityId}
            value={row.quality ?? ""}
            disabled={disabled}
            onChange={(e) =>
              onField(
                "quality",
                e.target.value === "" ? null : Number(e.target.value),
              )
            }
            className={inputClass}
          >
            <option value="">Not set</option>
            {QUALITY_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Data" htmlFor={dataId}>
          <input
            id={dataId}
            value={row.dataText}
            disabled={disabled}
            onChange={(e) => onField("dataText", e.target.value)}
            className={inputClass}
          />
        </Field>
      </div>

      {sources.length === 0 && (
        <p className="text-muted-foreground text-xs">
          Save a source above before it can be cited here.
        </p>
      )}

      <button
        type="button"
        onClick={onRemove}
        disabled={disabled}
        className="text-destructive w-fit rounded-md px-2 py-1 text-xs font-medium disabled:opacity-40"
      >
        Remove
      </button>
    </li>
  );
}
