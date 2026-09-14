"use client";

import { useId, useState } from "react";

import { Constants } from "@/lib/db";
import type { PersonSearchOption } from "@/lib/db";
import type { Sex } from "@/lib/db/types";
import { isSex } from "@/lib/edit/person-fields";
import type { PersonRefInput } from "@/lib/edit/relationships";
import { sexLabel } from "@/lib/person/labels";

import { PersonPicker } from "../PersonPicker";
import { inputClass } from "./form";

/**
 * `PersonPicker` plus "or create a new person" (SPEC §8.3, WAYFINDER decision
 * 36, issue #56) — every Relationships action that names a person (add
 * parent, add partner, add child) needs both paths in the same place, so
 * this wraps them once rather than each call site inventing its own toggle.
 *
 * Reports the resolved person's `sex` alongside the ref so the caller can
 * default a role `<select>` from it (decision 36 — "partner roles derive
 * from sex, editable") without a second round trip: for an existing person
 * that is `PersonSearchOption.sex` (added for exactly this — see
 * `moderation.ts`'s doc comment); for a new person it is exactly the sex the
 * moderator just chose in the form below.
 */
export function PersonPickerOrCreate({
  label,
  disabled,
  search,
  onResolved,
}: {
  readonly label: string;
  readonly disabled?: boolean;
  readonly search: (query: string) => Promise<readonly PersonSearchOption[]>;
  readonly onResolved: (ref: PersonRefInput, sex: Sex | null) => void;
}) {
  const [creating, setCreating] = useState(false);
  const [givenName, setGivenName] = useState("");
  const [surname, setSurname] = useState("");
  const [sex, setSex] = useState<Sex>("unknown");
  const givenId = useId();
  const surnameId = useId();
  const sexId = useId();

  if (!creating) {
    return (
      <div className="flex flex-col gap-2">
        <PersonPicker
          label={label}
          disabled={disabled}
          search={search}
          onSelect={(option) =>
            onResolved({ kind: "existing", personId: option.id }, option.sex)
          }
        />
        <button
          type="button"
          disabled={disabled}
          onClick={() => setCreating(true)}
          className="text-muted-foreground w-fit text-xs underline disabled:opacity-50"
        >
          Or create a new person
        </button>
      </div>
    );
  }

  function submitNewPerson() {
    onResolved({ kind: "new", givenName, surname, sex }, sex);
    setGivenName("");
    setSurname("");
    setSex("unknown");
    setCreating(false);
  }

  return (
    <div className="border-border flex flex-col gap-2 rounded-md border p-3">
      <div className="grid grid-cols-2 gap-2">
        <label
          htmlFor={givenId}
          className="text-muted-foreground text-xs font-medium"
        >
          Given name
          <input
            id={givenId}
            value={givenName}
            disabled={disabled}
            onChange={(e) => setGivenName(e.target.value)}
            className={`${inputClass} mt-1`}
          />
        </label>
        <label
          htmlFor={surnameId}
          className="text-muted-foreground text-xs font-medium"
        >
          Surname
          <input
            id={surnameId}
            value={surname}
            disabled={disabled}
            onChange={(e) => setSurname(e.target.value)}
            className={`${inputClass} mt-1`}
          />
        </label>
      </div>
      <label
        htmlFor={sexId}
        className="text-muted-foreground text-xs font-medium"
      >
        Sex
        <select
          id={sexId}
          value={sex}
          disabled={disabled}
          onChange={(e) => {
            if (isSex(e.target.value)) {
              setSex(e.target.value);
            }
          }}
          className={`${inputClass} mt-1`}
        >
          {Constants.public.Enums.sex.map((value) => (
            <option key={value} value={value}>
              {sexLabel(value)}
            </option>
          ))}
        </select>
      </label>
      <div className="flex gap-2">
        <button
          type="button"
          disabled={disabled}
          onClick={submitNewPerson}
          className="bg-primary text-primary-foreground w-fit rounded-md px-3 py-1.5 text-xs font-medium disabled:opacity-50"
        >
          Add {label.toLowerCase()}
        </button>
        <button
          type="button"
          disabled={disabled}
          onClick={() => setCreating(false)}
          className="text-muted-foreground w-fit text-xs underline disabled:opacity-50"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
