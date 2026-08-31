"use client";

import { useId } from "react";

import { interpretDateInput } from "@/lib/edit/date-input";

import { inputClass } from "./form";

/**
 * One text field, live-parsed interpretation, and a shorthand hint (SPEC
 * §8.3, WAYFINDER decision 22) — the shared date input for every dated field
 * in the edit view. Type `abt 1850`, see "About 1850" appear below the field;
 * an unparseable value is not rejected, just flagged, since it still saves
 * (as `date_kind: "phrase"`).
 *
 * Controlled on the raw text alone — `interpretDateInput` (pure,
 * `lib/edit/date-input.ts`) re-derives the preview on every render, so there
 * is no separate "interpreted" state to keep in sync.
 */
export function DateInput({
  id,
  label,
  value,
  disabled,
  onChange,
}: {
  readonly id: string;
  readonly label: string;
  readonly value: string;
  readonly disabled: boolean;
  readonly onChange: (value: string) => void;
}) {
  const hintId = useId();
  const { preview, flagged } = interpretDateInput(value);

  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-muted-foreground text-xs font-medium">
        {label}
      </label>
      <input
        id={id}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        aria-describedby={hintId}
        placeholder="e.g. abt 1850"
        className={inputClass}
      />
      <p id={hintId} className="text-muted-foreground text-xs">
        {preview !== "" ? (
          <span className={flagged ? "text-destructive" : undefined}>
            {flagged ? "Not recognized — will save as free text: " : "→ "}
            {preview}
          </span>
        ) : (
          "abt · bef · aft · bet … and … · from … to …"
        )}
      </p>
    </div>
  );
}
