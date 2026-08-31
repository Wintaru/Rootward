"use client";

import { useId, useReducer, useState } from "react";

import { saveAdditionalNames } from "@/app/person/[personId]/edit/actions";
import { Constants } from "@/lib/db";
import type { PersonNameEditRow } from "@/lib/db/person-edit";
import type { NameType } from "@/lib/db/types";
import {
  additionalNamesReducer,
  diffAdditionalNames,
  isAdditionalNamesDiffEmpty,
  namesFromLoaded,
  reconcileAdditionalNamesAfterSave,
  type NameFieldKey,
} from "@/lib/edit/additional-names";
import { nameTypeLabel } from "@/lib/person/labels";

import { inputClass, SaveBar } from "./form";

/**
 * Additional Names (SPEC §8.3, §4.2, §10 item 27) — CRUD over `person_name`
 * rows (the primary name lives on `person` itself, edited by
 * `NameGenderSection`). Add, reorder, and delete are all local state; Save
 * sends only the resulting diff (inserts / updates / deletes), each
 * version-checked against the `updated_at` it was loaded at (WAYFINDER
 * decision 26). A save that partially conflicts still applies the rows that
 * succeeded — see `reconcileAdditionalNamesAfterSave`.
 */
export function AdditionalNamesSection({
  personId,
  loaded,
}: {
  readonly personId: string;
  readonly loaded: readonly PersonNameEditRow[];
}) {
  const [baseline, setBaseline] = useState(loaded);
  const [rows, dispatch] = useReducer(
    additionalNamesReducer,
    loaded,
    namesFromLoaded,
  );
  const [status, setStatus] = useState<
    "idle" | "saving" | "saved" | "conflict" | "error"
  >("idle");
  const [error, setError] = useState<string | null>(null);

  const diff = diffAdditionalNames(baseline, rows);
  const dirty = !isAdditionalNamesDiffEmpty(diff);
  const saving = status === "saving";

  function addRow() {
    dispatch({ type: "added", id: crypto.randomUUID() });
    setStatus("idle");
  }

  function field(id: string, fieldKey: NameFieldKey, value: string) {
    dispatch({
      type: "field_changed",
      id,
      field: fieldKey,
      value: fieldKey === "type" ? parseNameType(value) : value,
    });
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

  async function save() {
    if (!dirty || status === "saving") {
      return;
    }
    setStatus("saving");
    setError(null);
    try {
      const outcome = await saveAdditionalNames({ personId, ...diff });
      if (outcome.status !== "saved") {
        setError(outcome.message);
        setStatus("error");
        return;
      }
      const reconciled = reconcileAdditionalNamesAfterSave(
        baseline,
        rows,
        outcome.result,
      );
      setBaseline(reconciled.baseline);
      // A wholesale replace is safe here — every control is disabled while
      // `status === "saving"`, so `rows` cannot have changed since `diff` was
      // computed above; there is nothing newer to preserve.
      dispatch({ type: "reconciled", rows: reconciled.current });
      setStatus(outcome.result.conflictIds.length > 0 ? "conflict" : "saved");
    } catch {
      setError("Something went wrong. Try again in a moment.");
      setStatus("error");
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <ul className="flex flex-col gap-3">
        {rows.map((row, index) => (
          <NameRow
            key={row.id}
            row={row}
            index={index}
            count={rows.length}
            disabled={saving}
            onField={(fieldKey, value) => field(row.id, fieldKey, value)}
            onMove={(direction) => move(row.id, direction)}
            onRemove={() => remove(row.id)}
          />
        ))}
        {rows.length === 0 && (
          <li className="text-muted-foreground text-sm">
            No additional names recorded.
          </li>
        )}
      </ul>

      <button
        type="button"
        onClick={addRow}
        disabled={saving}
        className="border-border hover:bg-accent w-fit rounded-md border px-3 py-1.5 text-sm font-medium disabled:opacity-50"
      >
        Add a name
      </button>

      <SaveBar
        dirty={dirty}
        status={status}
        error={error}
        onSave={save}
        conflictMessage="Some names changed elsewhere and were not saved; the rest were."
      />
    </div>
  );
}

function parseNameType(value: string): NameType | null {
  return (Constants.public.Enums.name_type as readonly string[]).includes(value)
    ? (value as NameType)
    : null;
}

function NameRow({
  row,
  index,
  count,
  disabled,
  onField,
  onMove,
  onRemove,
}: {
  readonly row: {
    readonly id: string;
    readonly type: NameType | null;
    readonly givenName: string;
    readonly surname: string;
    readonly prefix: string;
    readonly suffix: string;
    readonly nickname: string;
  };
  readonly index: number;
  readonly count: number;
  readonly disabled: boolean;
  readonly onField: (field: NameFieldKey, value: string) => void;
  readonly onMove: (direction: "up" | "down") => void;
  readonly onRemove: () => void;
}) {
  const typeId = useId();
  const givenId = useId();
  const surnameId = useId();
  const prefixId = useId();
  const suffixId = useId();
  const nicknameId = useId();

  return (
    <li className="border-border flex flex-col gap-3 rounded-lg border p-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <LabeledInput
          id={typeId}
          label="Type"
          as="select"
          value={row.type ?? ""}
          disabled={disabled}
          onChange={(value) => onField("type", value)}
        >
          <option value="">Choose a type</option>
          {Constants.public.Enums.name_type.map((value) => (
            <option key={value} value={value}>
              {nameTypeLabel(value)}
            </option>
          ))}
        </LabeledInput>
        <LabeledInput
          id={givenId}
          label="Given name"
          value={row.givenName}
          disabled={disabled}
          onChange={(value) => onField("givenName", value)}
        />
        <LabeledInput
          id={surnameId}
          label="Surname"
          value={row.surname}
          disabled={disabled}
          onChange={(value) => onField("surname", value)}
        />
        <LabeledInput
          id={prefixId}
          label="Prefix"
          value={row.prefix}
          disabled={disabled}
          onChange={(value) => onField("prefix", value)}
        />
        <LabeledInput
          id={suffixId}
          label="Suffix"
          value={row.suffix}
          disabled={disabled}
          onChange={(value) => onField("suffix", value)}
        />
        <LabeledInput
          id={nicknameId}
          label="Nickname"
          value={row.nickname}
          disabled={disabled}
          onChange={(value) => onField("nickname", value)}
        />
      </div>
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

function LabeledInput({
  id,
  label,
  value,
  onChange,
  disabled,
  as,
  children,
}: {
  readonly id: string;
  readonly label: string;
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly disabled: boolean;
  readonly as?: "select";
  readonly children?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-muted-foreground text-xs font-medium">
        {label}
      </label>
      {as === "select" ? (
        <select
          id={id}
          value={value}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
          className={inputClass}
        >
          {children}
        </select>
      ) : (
        <input
          id={id}
          value={value}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
          className={inputClass}
        />
      )}
    </div>
  );
}
