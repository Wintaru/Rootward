"use client";

import { useId, useState } from "react";

import { savePersonFields } from "@/app/person/[personId]/edit/actions";
import { Constants, personName } from "@/lib/db";
import type { RowConflict } from "@/lib/db/conflict";
import type { PersonEditFields, PersonFieldPatch } from "@/lib/db/person-edit";
import type { Sex } from "@/lib/db/types";
import type { ConflictResolution } from "@/lib/edit/conflict";
import {
  EDITABLE_PERSON_VISIBILITIES,
  type NameGenderDraft,
  type NameGenderFields,
  describePersonFieldsConflict,
  isEditablePersonVisibility,
  isSex,
  nameGenderDraft,
  nameGenderPatch,
} from "@/lib/edit/person-fields";
import { enumTokenLabel, sexLabel } from "@/lib/person/labels";

import { ConflictDialog } from "./ConflictDialog";
import { DeletePersonSection } from "./DeletePersonSection";
import { Field, inputClass, SaveBar } from "./form";

/**
 * Name & Gender (SPEC §8.3, §4.2, §10 item 27) — the primary name parts and
 * `sex` on the `person` row itself (additional names are their own section),
 * plus Visibility and Living (SPEC §5, decisions 6/7, #58): who can see this
 * person, and the living/deceased override RLS uses to hide sensitive facts.
 * Save sends only the changed columns, guarded on the row's `updated_at` as
 * loaded (WAYFINDER decision 26); a lost version check surfaces the
 * `ConflictDialog` (#31) rather than silently overwriting.
 */
export function NameGenderSection({
  personId,
  loaded,
  computedIsLiving,
  isAdmin,
}: {
  readonly personId: string;
  readonly loaded: NameGenderFields;
  /** What the Living control's Computed option currently resolves to (SPEC
   * §5, §4.2, #58) — always fetched so switching the override back to
   * Computed shows the right value without a round trip. */
  readonly computedIsLiving: boolean;
  /** Gates the danger-zone delete at the bottom (SPEC §8.3, decision 18,
   * issue #59) — an ordinary moderator never sees it. */
  readonly isAdmin: boolean;
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
  const visibilityId = useId();
  const livingId = useId();

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

  function setVisibility(value: string) {
    if (!isEditablePersonVisibility(value)) {
      return;
    }
    setDraft((prev) => ({ ...prev, visibility: value }));
    if (status !== "saving") {
      setStatus("idle");
    }
  }

  function setLiving(value: string) {
    setDraft((prev) => ({
      ...prev,
      isLiving: value === "computed" ? null : value === "living",
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
        <Field label="Visibility" htmlFor={visibilityId}>
          <select
            id={visibilityId}
            value={draft.visibility}
            // A person loaded with `close_family` (post-MVP, #43 — not
            // reachable through this MVP UI, but reachable by GEDCOM import
            // or direct SQL) has no matching option below. A plain bound
            // `<select>` would silently fall back to displaying the first
            // option while `draft.visibility` stayed `close_family`
            // underneath — touching the control at all would then silently
            // downgrade it on save. Disabling it and adding a non-selectable
            // option for the true value keeps the display honest and makes
            // that downgrade unreachable from here (same pattern as
            // `FactsSection`'s `visibilityInScope`).
            disabled={!isEditablePersonVisibility(draft.visibility)}
            onChange={(e) => setVisibility(e.target.value)}
            className={inputClass}
          >
            {!isEditablePersonVisibility(draft.visibility) && (
              <option value={draft.visibility} disabled>
                {enumTokenLabel(draft.visibility)}
              </option>
            )}
            {EDITABLE_PERSON_VISIBILITIES.map((value) => (
              <option key={value} value={value}>
                {enumTokenLabel(value)}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Living" htmlFor={livingId}>
          <select
            id={livingId}
            value={
              draft.isLiving === null
                ? "computed"
                : draft.isLiving
                  ? "living"
                  : "deceased"
            }
            onChange={(e) => setLiving(e.target.value)}
            className={inputClass}
          >
            <option value="computed">
              Computed ({computedIsLiving ? "Living" : "Deceased"})
            </option>
            <option value="living">Living</option>
            <option value="deceased">Deceased</option>
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

      {isAdmin && (
        <DeletePersonSection
          personId={personId}
          personDisplayName={personName({
            given_name: baseline.givenName,
            surname: baseline.surname,
          })}
        />
      )}
    </div>
  );
}

function parseSex(value: string): Sex | null {
  return isSex(value) ? value : null;
}
