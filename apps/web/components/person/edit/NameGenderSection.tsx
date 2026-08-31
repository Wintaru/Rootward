"use client";

import { useId, useState } from "react";

import { savePersonFields } from "@/app/person/[personId]/edit/actions";
import { Constants } from "@/lib/db";
import type { Sex } from "@/lib/db/types";
import {
  type NameGenderDraft,
  type NameGenderFields,
  isSex,
  nameGenderDraft,
  nameGenderPatch,
} from "@/lib/edit/person-fields";
import { sexLabel } from "@/lib/person/labels";

import { Field, inputClass, SaveBar } from "./form";

/**
 * Name & Gender (SPEC §8.3, §4.2, §10 item 27) — the primary name parts and
 * `sex` on the `person` row itself (additional names are their own section).
 * Save sends only the changed columns, guarded on the row's `updated_at` as
 * loaded (WAYFINDER decision 26); a lost version check surfaces as a
 * conflict banner rather than silently overwriting — the full
 * `ConflictDialog` is #31.
 */
export function NameGenderSection({
  personId,
  loaded,
}: {
  readonly personId: string;
  readonly loaded: NameGenderFields;
}) {
  const [baseline, setBaseline] = useState(loaded);
  const [draft, setDraft] = useState<NameGenderDraft>(() =>
    nameGenderDraft(loaded),
  );
  const [status, setStatus] = useState<
    "idle" | "saving" | "saved" | "conflict" | "error"
  >("idle");
  const [error, setError] = useState<string | null>(null);

  const givenId = useId();
  const surnameId = useId();
  const prefixId = useId();
  const suffixId = useId();
  const nicknameId = useId();
  const sexId = useId();

  const patch = nameGenderPatch(baseline, draft);
  const dirty = patch !== null;

  function field(key: keyof NameGenderDraft, value: string) {
    setDraft((prev) => ({ ...prev, [key]: value }));
    if (status !== "saving") {
      setStatus("idle");
    }
  }

  function setSex(value: string) {
    setDraft((prev) => ({
      ...prev,
      sex: value === "" ? null : parseSex(value),
    }));
    if (status !== "saving") {
      setStatus("idle");
    }
  }

  async function save() {
    if (patch === null || status === "saving") {
      return;
    }
    setStatus("saving");
    setError(null);
    try {
      const result = await savePersonFields({
        personId,
        expectedUpdatedAt: baseline.updatedAt,
        patch,
      });
      if (result.status === "saved") {
        setBaseline(result.row);
        setDraft(nameGenderDraft(result.row));
        setStatus("saved");
      } else if (result.status === "conflict") {
        setStatus("conflict");
      } else {
        setError(result.message);
        setStatus("error");
      }
    } catch {
      setError("Something went wrong. Try again in a moment.");
      setStatus("error");
    }
  }

  return (
    <div className="flex max-w-lg flex-col gap-4">
      <div className="grid grid-cols-2 gap-4">
        <Field label="Given name" htmlFor={givenId}>
          <input
            id={givenId}
            value={draft.givenName}
            onChange={(e) => field("givenName", e.target.value)}
            className={inputClass}
          />
        </Field>
        <Field label="Surname" htmlFor={surnameId}>
          <input
            id={surnameId}
            value={draft.surname}
            onChange={(e) => field("surname", e.target.value)}
            className={inputClass}
          />
        </Field>
        <Field label="Prefix" htmlFor={prefixId}>
          <input
            id={prefixId}
            value={draft.namePrefix}
            onChange={(e) => field("namePrefix", e.target.value)}
            placeholder="Dr., Rev., …"
            className={inputClass}
          />
        </Field>
        <Field label="Suffix" htmlFor={suffixId}>
          <input
            id={suffixId}
            value={draft.nameSuffix}
            onChange={(e) => field("nameSuffix", e.target.value)}
            placeholder="Jr., III, …"
            className={inputClass}
          />
        </Field>
        <Field label="Nickname" htmlFor={nicknameId}>
          <input
            id={nicknameId}
            value={draft.nickname}
            onChange={(e) => field("nickname", e.target.value)}
            className={inputClass}
          />
        </Field>
        <Field label="Sex" htmlFor={sexId}>
          <select
            id={sexId}
            value={draft.sex ?? ""}
            onChange={(e) => setSex(e.target.value)}
            className={inputClass}
          >
            <option value="">Unspecified</option>
            {Constants.public.Enums.sex.map((value) => (
              <option key={value} value={value}>
                {sexLabel(value)}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <SaveBar
        dirty={dirty}
        status={status}
        error={error}
        onSave={save}
        conflictMessage="This person's name or gender changed while you had it open."
      />
    </div>
  );
}

function parseSex(value: string): Sex | null {
  return isSex(value) ? value : null;
}
