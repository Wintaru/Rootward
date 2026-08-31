"use client";

import { useId, useReducer, useState } from "react";

import { saveFacts } from "@/app/person/[personId]/edit/actions";
import { Constants } from "@/lib/db";
import type { RowConflict } from "@/lib/db/conflict";
import type { FactEditRow } from "@/lib/db/fact-edit";
import type { FactType, FactVisibility } from "@/lib/db/types";
import type { ConflictResolution } from "@/lib/edit/conflict";
import {
  describeFactConflicts,
  diffFacts,
  factIsSensitive,
  factsFromLoaded,
  factsReducer,
  FACT_VISIBILITY_OPTIONS,
  isFactsDiffEmpty,
  reconcileFactsAfterSave,
  type FactDraft,
  type FactFieldKey,
  type FactsDiff,
} from "@/lib/edit/facts";
import { enumTokenLabel } from "@/lib/person/labels";

import { ConflictDialog } from "./ConflictDialog";
import { DateInput } from "./DateInput";
import { Field, inputClass, SaveBar } from "./form";
import { PlaceInput } from "./PlaceInput";

/**
 * Facts (SPEC §8.3, §4.1, §4.2, §10 item 29) — CRUD over person-owned `fact`
 * rows: type, date (via `DateInput`), place (via `PlaceInput`), value, and
 * visibility. Add and delete are local state; Save sends only the resulting
 * diff, each row version-checked against the `updated_at` it was loaded at
 * (WAYFINDER decision 26). Structurally the same shell as `EventsSection.tsx`
 * — see `lib/edit/facts.ts`'s module doc for the shape differences `fact`
 * forces (a `visibility` control, a derived-not-stored `isSensitive` badge,
 * no re-sort after save).
 *
 * A conflicted row surfaces through the shared `ConflictDialog` (#31), same
 * `performSave`/`retryKeepMine`/`resolveConflict` pattern as every other
 * multi-row section.
 */
export function FactsSection({
  personId,
  loaded,
}: {
  readonly personId: string;
  readonly loaded: readonly FactEditRow[];
}) {
  const [baseline, setBaseline] = useState(loaded);
  const [rows, dispatch] = useReducer(factsReducer, loaded, factsFromLoaded);
  const [status, setStatus] = useState<
    "idle" | "saving" | "saved" | "conflict" | "error"
  >("idle");
  const [error, setError] = useState<string | null>(null);
  const [conflictState, setConflictState] = useState<{
    readonly diff: FactsDiff;
    readonly conflicts: readonly RowConflict<FactEditRow>[];
  } | null>(null);

  const diff = diffFacts(baseline, rows);
  const dirty = !isFactsDiffEmpty(diff);
  const saving = status === "saving";

  function addRow() {
    dispatch({ type: "added", id: crypto.randomUUID() });
    setStatus("idle");
  }

  function field(
    id: string,
    fieldKey: FactFieldKey,
    value: string | FactType | FactVisibility | null,
  ) {
    dispatch({ type: "field_changed", id, field: fieldKey, value });
    setStatus("idle");
  }

  function remove(id: string) {
    dispatch({ type: "removed", id });
    setStatus("idle");
  }

  async function performSave(diffToSend: FactsDiff) {
    setStatus("saving");
    setError(null);
    try {
      const outcome = await saveFacts({ personId, ...diffToSend });
      if (outcome.status !== "saved") {
        setError(outcome.message);
        setStatus("error");
        return;
      }
      const reconciled = reconcileFactsAfterSave(
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
    const singleDiff: FactsDiff =
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
            : describeFactConflicts(conflictState.conflicts, rows)
        }
        disabled={saving}
        onResolve={resolveConflict}
      />
      <ul className="flex flex-col gap-3">
        {rows.map((row) => (
          <FactRow
            key={row.id}
            row={row}
            disabled={saving}
            onField={(fieldKey, value) => field(row.id, fieldKey, value)}
            onRemove={() => remove(row.id)}
          />
        ))}
        {rows.length === 0 && (
          <li className="text-muted-foreground text-sm">No facts recorded.</li>
        )}
      </ul>

      <button
        type="button"
        onClick={addRow}
        disabled={saving}
        className="border-border hover:bg-accent w-fit rounded-md border px-3 py-1.5 text-sm font-medium disabled:opacity-50"
      >
        Add a fact
      </button>

      <SaveBar
        dirty={dirty}
        status={status}
        error={error}
        onSave={save}
        conflictMessage="Some facts changed elsewhere and were not saved; the rest were."
      />
    </div>
  );
}

function parseFactType(value: string): FactType | null {
  return (Constants.public.Enums.fact_type as readonly string[]).includes(value)
    ? (value as FactType)
    : null;
}

function parseFactVisibility(value: string): FactVisibility {
  const match = FACT_VISIBILITY_OPTIONS.find(
    (option) => option.value === value,
  );
  return match?.value ?? "everyone_approved";
}

function FactRow({
  row,
  disabled,
  onField,
  onRemove,
}: {
  readonly row: FactDraft;
  readonly disabled: boolean;
  readonly onField: (
    field: FactFieldKey,
    value: string | FactType | FactVisibility | null,
  ) => void;
  readonly onRemove: () => void;
}) {
  const typeId = useId();
  const typeOtherId = useId();
  const dateId = useId();
  const placeId = useId();
  const valueId = useId();
  const visibilityId = useId();
  const sensitive = factIsSensitive(row.type);
  // A fact loaded with `close_family` or `moderators_only` — not reachable
  // through this MVP UI (see `lib/edit/facts.ts`'s module doc), but reachable
  // by direct SQL or a future admin surface. A plain `<select>` bound to a
  // value with no matching `<option>` silently falls back to displaying its
  // first option while `row.visibility` stays the real value underneath —
  // if the moderator then touched the control at all, the next save would
  // silently downgrade it to `everyone_approved`. Keeping the control
  // disabled and adding a non-selectable option for the true value keeps the
  // display honest and makes that downgrade unreachable from here.
  const visibilityInScope = FACT_VISIBILITY_OPTIONS.some(
    (option) => option.value === row.visibility,
  );

  return (
    <li className="border-border flex flex-col gap-3 rounded-lg border p-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Field label="Type" htmlFor={typeId}>
          <select
            id={typeId}
            value={row.type ?? ""}
            disabled={disabled}
            onChange={(e) => onField("type", parseFactType(e.target.value))}
            className={inputClass}
          >
            <option value="" disabled={row.type !== null}>
              Choose a type…
            </option>
            {Constants.public.Enums.fact_type.map((value) => (
              <option key={value} value={value}>
                {enumTokenLabel(value)}
              </option>
            ))}
          </select>
        </Field>

        {row.type === "other" && (
          <Field label="Fact name" htmlFor={typeOtherId}>
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

        <Field label="Visibility" htmlFor={visibilityId}>
          <select
            id={visibilityId}
            value={row.visibility}
            disabled={disabled || !visibilityInScope}
            onChange={(e) =>
              onField("visibility", parseFactVisibility(e.target.value))
            }
            className={inputClass}
          >
            {!visibilityInScope && (
              <option value={row.visibility} disabled>
                {enumTokenLabel(row.visibility)}
              </option>
            )}
            {FACT_VISIBILITY_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </Field>
      </div>

      {!visibilityInScope && (
        <p className="text-muted-foreground text-xs">
          This fact&apos;s visibility ({enumTokenLabel(row.visibility)}) is
          outside what this view can change — a future moderator surface handles
          that setting.
        </p>
      )}

      {sensitive && (
        <p className="text-muted-foreground text-xs">
          Sensitive — always hidden from non-moderators while this person is
          living, regardless of the visibility setting above.
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
