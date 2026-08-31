"use client";

import { useId, useReducer, useState } from "react";

import { saveEvents } from "@/app/person/[personId]/edit/actions";
import { Constants } from "@/lib/db";
import type { RowConflict } from "@/lib/db/conflict";
import type { EventEditRow } from "@/lib/db/event-edit";
import type { EventType } from "@/lib/db/types";
import type { ConflictResolution } from "@/lib/edit/conflict";
import {
  describeEventConflicts,
  diffEvents,
  eventsFromLoaded,
  eventsReducer,
  isEventsDiffEmpty,
  reconcileEventsAfterSave,
  type EventDraft,
  type EventFieldKey,
  type EventsDiff,
} from "@/lib/edit/events";
import { enumTokenLabel } from "@/lib/person/labels";

import { ConflictDialog } from "./ConflictDialog";
import { DateInput } from "./DateInput";
import { Field, inputClass, SaveBar } from "./form";
import { PlaceInput } from "./PlaceInput";

/**
 * Events (SPEC §8.3, §4.1, §4.2, §10 item 28) — CRUD over person-owned
 * `event` rows: type, date (via `DateInput`), place (via `PlaceInput`),
 * value, and age. Add and delete are local state; Save sends only the
 * resulting diff, each row version-checked against the `updated_at` it was
 * loaded at (WAYFINDER decision 26). The list re-sorts by `sort_key` after a
 * save — that column is server-trigger-computed, not client-ordered, so
 * there is no manual reorder control here (unlike Additional Names).
 *
 * A conflicted row surfaces through the shared `ConflictDialog` (#31): "keep
 * mine" re-sends that one row's original patch against the row's fresh
 * `updated_at` (`conflictState.diff` keeps the full original diff around for
 * exactly this — a later "keep mine" click still needs the patch for a row
 * that has not been retried yet); "take theirs" discards the local edit.
 * Both paths reuse `performSave` with a diff scoped to just that one row —
 * `reconcileEventsAfterSave` only ever touches rows present in the result it
 * is given, so every other row's local state is untouched either way.
 */
export function EventsSection({
  personId,
  loaded,
}: {
  readonly personId: string;
  readonly loaded: readonly EventEditRow[];
}) {
  const [baseline, setBaseline] = useState(loaded);
  const [rows, dispatch] = useReducer(eventsReducer, loaded, eventsFromLoaded);
  const [status, setStatus] = useState<
    "idle" | "saving" | "saved" | "conflict" | "error"
  >("idle");
  const [error, setError] = useState<string | null>(null);
  const [conflictState, setConflictState] = useState<{
    readonly diff: EventsDiff;
    readonly conflicts: readonly RowConflict<EventEditRow>[];
  } | null>(null);

  const diff = diffEvents(baseline, rows);
  const dirty = !isEventsDiffEmpty(diff);
  const saving = status === "saving";

  function addRow() {
    dispatch({ type: "added", id: crypto.randomUUID() });
    setStatus("idle");
  }

  function field(id: string, fieldKey: EventFieldKey, value: string) {
    dispatch({
      type: "field_changed",
      id,
      field: fieldKey,
      value: fieldKey === "type" ? parseEventType(value) : value,
    });
    setStatus("idle");
  }

  function remove(id: string) {
    dispatch({ type: "removed", id });
    setStatus("idle");
  }

  async function performSave(diffToSend: EventsDiff) {
    setStatus("saving");
    setError(null);
    try {
      const outcome = await saveEvents({ personId, ...diffToSend });
      if (outcome.status !== "saved") {
        setError(outcome.message);
        setStatus("error");
        return;
      }
      const reconciled = reconcileEventsAfterSave(
        baseline,
        rows,
        outcome.result,
      );
      setBaseline(reconciled.baseline);
      // Safe wholesale replace — every control is disabled while
      // `status === "saving"`, so `rows` cannot have changed since `diffToSend`
      // was computed.
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
    const singleDiff: EventsDiff =
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

  return (
    <div className="flex flex-col gap-4">
      <ConflictDialog
        items={
          conflictState === null
            ? []
            : describeEventConflicts(conflictState.conflicts, rows)
        }
        disabled={saving}
        onResolve={resolveConflict}
      />
      <ul className="flex flex-col gap-3">
        {rows.map((row) => (
          <EventRow
            key={row.id}
            row={row}
            disabled={saving}
            onField={(fieldKey, value) => field(row.id, fieldKey, value)}
            onRemove={() => remove(row.id)}
          />
        ))}
        {rows.length === 0 && (
          <li className="text-muted-foreground text-sm">No events recorded.</li>
        )}
      </ul>

      <button
        type="button"
        onClick={addRow}
        disabled={saving}
        className="border-border hover:bg-accent w-fit rounded-md border px-3 py-1.5 text-sm font-medium disabled:opacity-50"
      >
        Add an event
      </button>

      <SaveBar
        dirty={dirty}
        status={status}
        error={error}
        onSave={save}
        conflictMessage="Some events changed elsewhere and were not saved; the rest were."
      />
    </div>
  );
}

function parseEventType(value: string): EventType | null {
  return (Constants.public.Enums.event_type as readonly string[]).includes(
    value,
  )
    ? (value as EventType)
    : null;
}

function EventRow({
  row,
  disabled,
  onField,
  onRemove,
}: {
  readonly row: EventDraft;
  readonly disabled: boolean;
  readonly onField: (field: EventFieldKey, value: string) => void;
  readonly onRemove: () => void;
}) {
  const typeId = useId();
  const typeOtherId = useId();
  const dateId = useId();
  const placeId = useId();
  const valueId = useId();
  const ageId = useId();

  return (
    <li className="border-border flex flex-col gap-3 rounded-lg border p-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Field label="Type" htmlFor={typeId}>
          <select
            id={typeId}
            value={row.type ?? ""}
            disabled={disabled}
            onChange={(e) => onField("type", e.target.value)}
            className={inputClass}
          >
            <option value="" disabled={row.type !== null}>
              Choose a type…
            </option>
            {Constants.public.Enums.event_type.map((value) => (
              <option key={value} value={value}>
                {enumTokenLabel(value)}
              </option>
            ))}
          </select>
        </Field>

        {row.type === "other" && (
          <Field label="Event name" htmlFor={typeOtherId}>
            <input
              id={typeOtherId}
              value={row.typeOther}
              disabled={disabled}
              onChange={(e) => onField("typeOther", e.target.value)}
              className={inputClass}
            />
          </Field>
        )}

        <DateInput
          id={dateId}
          label="Date"
          value={row.dateRaw}
          disabled={disabled}
          onChange={(value) => onField("dateRaw", value)}
        />

        <PlaceInput
          id={placeId}
          label="Place"
          value={row.placeName}
          disabled={disabled}
          onChange={(value) => onField("placeName", value)}
        />

        <Field label="Value" htmlFor={valueId}>
          <input
            id={valueId}
            value={row.value}
            disabled={disabled}
            onChange={(e) => onField("value", e.target.value)}
            className={inputClass}
          />
        </Field>

        <Field label="Age" htmlFor={ageId}>
          <input
            id={ageId}
            value={row.ageText}
            disabled={disabled}
            onChange={(e) => onField("ageText", e.target.value)}
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
