"use client";

import { useId, useState } from "react";

import { savePersonFields } from "@/app/person/[personId]/edit/actions";
import { Constants } from "@/lib/db";
import type { RowConflict } from "@/lib/db/conflict";
import type { PersonEditFields, PersonFieldPatch } from "@/lib/db/person-edit";
import type { Sex } from "@/lib/db/types";
import type { ConflictResolution } from "@/lib/edit/conflict";
import {
  type NameGenderDraft,
  type NameGenderFields,
  describePersonFieldsConflict,
  isSex,
  nameGenderDraft,
  nameGenderPatch,
} from "@/lib/edit/person-fields";
import { sexLabel } from "@/lib/person/labels";

import { ConflictDialog } from "./ConflictDialog";
import { Field, inputClass, SaveBar } from "./form";

/**
 * Name & Gender (SPEC §8.3, §4.2, §10 item 27) — the primary name parts and
 * `sex` on the `person` row itself (additional names are their own section).
 * Save sends only the changed columns, guarded on the row's `updated_at` as
 * loaded (WAYFINDER decision 26); a lost version check surfaces the
 * `ConflictDialog` (#31) rather than silently overwriting.
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
  // The patch is captured alongside its conflict rather than recomputed live
  // — "keep mine" must resend exactly what was attempted, even if `draft`
  // has since changed while the dialog was open.
  const [conflict, setConflict] = useState<{
    readonly patch: PersonFieldPatch;
    readonly row: RowConflict<PersonEditFields>;
  } | null>(null);

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

  async function runSave(
    targetPatch: PersonFieldPatch,
    expectedUpdatedAt: string,
  ) {
    setStatus("saving");
    setError(null);
    try {
      const result = await savePersonFields({
        personId,
        expectedUpdatedAt,
        patch: targetPatch,
      });
      if (result.status === "saved") {
        setBaseline(result.row);
        setDraft(nameGenderDraft(result.row));
        setConflict(null);
        setStatus("saved");
      } else if (result.status === "conflict") {
        setConflict({ patch: targetPatch, row: result.conflict });
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

  async function save() {
    if (patch === null || status === "saving") {
      return;
    }
    await runSave(patch, baseline.updatedAt);
  }

  function resolveConflict(_id: string, resolution: ConflictResolution) {
    // The dialog's own button is disabled while saving (belt and braces —
    // see `ConflictDialog`'s doc comment on the race this closes), but guard
    // here too since this handler is the actual state-mutating boundary.
    if (conflict === null || status === "saving") {
      return;
    }
    if (resolution === "keep-mine") {
      // Not offered by the dialog when the row was deleted (no "keep mine"
      // button renders in that branch) — the guard here is just defensive.
      if (conflict.row.theirs !== null) {
        void runSave(conflict.patch, conflict.row.theirs.updatedAt);
      }
      return;
    }

    if (conflict.row.theirs === null) {
      setConflict(null);
      setStatus("error");
      setError("This person no longer exists.");
      return;
    }
    setBaseline(conflict.row.theirs);
    setDraft(nameGenderDraft(conflict.row.theirs));
    setConflict(null);
    setStatus("idle");
  }

  return (
    <div className="flex max-w-lg flex-col gap-4">
      <ConflictDialog
        items={
          conflict === null
            ? []
            : [
                describePersonFieldsConflict(
                  personId,
                  conflict.patch,
                  conflict.row,
                ),
              ]
        }
        disabled={status === "saving"}
        onResolve={resolveConflict}
      />
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
