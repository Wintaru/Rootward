"use client";

import { useId, useReducer, useState } from "react";

import { saveNotes } from "@/app/person/[personId]/edit/actions";
import type { RowConflict } from "@/lib/db/conflict";
import type {
  NoteEditRow,
  PersonNotesData,
  SectionNoteOwner,
} from "@/lib/db/note-edit";
import type { ConflictResolution } from "@/lib/edit/conflict";
import {
  describeNoteConflicts,
  diffNotes,
  isNotesDiffEmpty,
  notesFromLoaded,
  notesReducer,
  reconcileNotesAfterSave,
  type NoteDraft,
  type NotesDiff,
} from "@/lib/edit/notes";
import { eventTypeLabel } from "@/lib/person/labels";

import { ConflictDialog } from "./ConflictDialog";
import { inputClass, SaveBar } from "./form";

/**
 * Notes (SPEC §8.3, §4.5, §10 item 31) — CRUD over `note` rows owned by the
 * person or by one of the person's own events (WAYFINDER decision 21's exact
 * MVP scope; see `note-edit.ts`'s doc comment). Grouped by owner, each group
 * add/reorder/delete independently; Save sends the combined diff across every
 * group in one round trip, each row version-checked (WAYFINDER decision 26).
 * Conflict handling reuses the same `performSave` / "keep mine retries just
 * that row" contract as `EventsSection` — see its doc comment for the
 * mechanics shared across every multi-row section.
 */
export function NotesSection({
  personId,
  loaded,
}: {
  readonly personId: string;
  readonly loaded: PersonNotesData;
}) {
  const [baseline, setBaseline] = useState(loaded.notes);
  const [rows, dispatch] = useReducer(
    notesReducer,
    loaded.notes,
    notesFromLoaded,
  );
  const [status, setStatus] = useState<
    "idle" | "saving" | "saved" | "conflict" | "error"
  >("idle");
  const [error, setError] = useState<string | null>(null);
  const [conflictState, setConflictState] = useState<{
    readonly diff: NotesDiff;
    readonly conflicts: readonly RowConflict<NoteEditRow>[];
  } | null>(null);

  const diff = diffNotes(baseline, rows);
  const dirty = !isNotesDiffEmpty(diff);
  const saving = status === "saving";

  function addRow(ownerType: SectionNoteOwner, ownerId: string) {
    dispatch({ type: "added", id: crypto.randomUUID(), ownerType, ownerId });
    setStatus("idle");
  }

  function field(id: string, text: string) {
    dispatch({ type: "field_changed", id, text });
    setStatus("idle");
  }

  function move(id: string, direction: "up" | "down") {
    dispatch({ type: "moved", id, direction });
    setStatus("idle");
  }

  function remove(id: string) {
    dispatch({ type: "removed", id });
    setStatus("idle");
  }

  async function performSave(diffToSend: NotesDiff) {
    setStatus("saving");
    setError(null);
    try {
      const outcome = await saveNotes({ personId, ...diffToSend });
      if (outcome.status !== "saved") {
        setError(outcome.message);
        setStatus("error");
        return;
      }
      const reconciled = reconcileNotesAfterSave(
        baseline,
        rows,
        outcome.result,
      );
      setBaseline(reconciled.baseline);
      // Safe wholesale replace — every control is disabled while
      // `status === "saving"`, so `rows` cannot have changed since
      // `diffToSend` was computed.
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
    const singleDiff: NotesDiff =
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
    // The dialog's own buttons are disabled while saving (belt and braces —
    // see `ConflictDialog`'s doc comment on the race this closes), but guard
    // here too since this handler is the actual state-mutating boundary.
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

  const personNotes = rows.filter((row) => row.ownerType === "person");
  const eventGroups = loaded.events.map((event) => ({
    event,
    notes: rows.filter(
      (row) => row.ownerType === "event" && row.ownerId === event.id,
    ),
  }));

  return (
    <div className="flex flex-col gap-6">
      <ConflictDialog
        items={
          conflictState === null
            ? []
            : describeNoteConflicts(
                conflictState.conflicts,
                rows,
                loaded.events,
              )
        }
        disabled={saving}
        onResolve={resolveConflict}
      />

      <NoteGroup
        title="About this person"
        notes={personNotes}
        disabled={saving}
        onAdd={() => addRow("person", personId)}
        onField={field}
        onMove={move}
        onRemove={remove}
      />

      {eventGroups.map(({ event, notes }) => (
        <NoteGroup
          key={event.id}
          title={`About their ${eventTypeLabel(event.type, event.typeOther)}`}
          notes={notes}
          disabled={saving}
          onAdd={() => addRow("event", event.id)}
          onField={field}
          onMove={move}
          onRemove={remove}
        />
      ))}

      <SaveBar
        dirty={dirty}
        status={status}
        error={error}
        onSave={save}
        conflictMessage="Some notes changed elsewhere and were not saved; the rest were."
      />
    </div>
  );
}

function NoteGroup({
  title,
  notes,
  disabled,
  onAdd,
  onField,
  onMove,
  onRemove,
}: {
  readonly title: string;
  readonly notes: readonly NoteDraft[];
  readonly disabled: boolean;
  readonly onAdd: () => void;
  readonly onField: (id: string, text: string) => void;
  readonly onMove: (id: string, direction: "up" | "down") => void;
  readonly onRemove: (id: string) => void;
}) {
  return (
    <div className="flex flex-col gap-3">
      <h3 className="text-sm font-semibold">{title}</h3>
      <ul className="flex flex-col gap-3">
        {notes.map((note, index) => (
          <NoteRow
            key={note.id}
            note={note}
            index={index}
            count={notes.length}
            disabled={disabled}
            onField={(text) => onField(note.id, text)}
            onMove={(direction) => onMove(note.id, direction)}
            onRemove={() => onRemove(note.id)}
          />
        ))}
        {notes.length === 0 && (
          <li className="text-muted-foreground text-sm">No notes recorded.</li>
        )}
      </ul>
      <button
        type="button"
        onClick={onAdd}
        disabled={disabled}
        className="border-border hover:bg-accent w-fit rounded-md border px-3 py-1.5 text-sm font-medium disabled:opacity-50"
      >
        Add a note
      </button>
    </div>
  );
}

function NoteRow({
  note,
  index,
  count,
  disabled,
  onField,
  onMove,
  onRemove,
}: {
  readonly note: NoteDraft;
  readonly index: number;
  readonly count: number;
  readonly disabled: boolean;
  readonly onField: (text: string) => void;
  readonly onMove: (direction: "up" | "down") => void;
  readonly onRemove: () => void;
}) {
  const textId = useId();

  return (
    <li className="border-border flex flex-col gap-2 rounded-lg border p-4">
      <label
        htmlFor={textId}
        className="text-muted-foreground text-xs font-medium"
      >
        Note
      </label>
      <textarea
        id={textId}
        value={note.text}
        disabled={disabled}
        onChange={(e) => onField(e.target.value)}
        rows={3}
        className={inputClass}
      />
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => onMove("up")}
          disabled={disabled || index === 0}
          aria-label="Move up"
          className="border-border rounded-md border px-2 py-1 text-xs disabled:opacity-40"
        >
          ▲
        </button>
        <button
          type="button"
          onClick={() => onMove("down")}
          disabled={disabled || index === count - 1}
          aria-label="Move down"
          className="border-border rounded-md border px-2 py-1 text-xs disabled:opacity-40"
        >
          ▼
        </button>
        <button
          type="button"
          onClick={onRemove}
          disabled={disabled}
          className="text-destructive ml-auto rounded-md px-2 py-1 text-xs font-medium disabled:opacity-40"
        >
          Remove
        </button>
      </div>
    </li>
  );
}
