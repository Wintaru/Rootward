"use client";

import { useId, useState } from "react";

import { savePersonFields } from "@/app/person/[personId]/edit/actions";
import type { RowConflict } from "@/lib/db/conflict";
import type {
  PersonEditFields,
  PersonFieldPatch,
  PersonReferenceNumberFields,
} from "@/lib/db/person-edit";
import type { ConflictResolution } from "@/lib/edit/conflict";
import {
  type ReferenceNumbersDraft,
  describePersonFieldsConflict,
  referenceNumbersDraft,
  referenceNumbersPatch,
} from "@/lib/edit/person-fields";

import { ConflictDialog } from "./ConflictDialog";
import { Field, inputClass, SaveBar } from "./form";

/**
 * Reference Numbers (SPEC §8.3, §4.2, §10 item 27) — `familysearch_id`,
 * `ancestral_file_number`, and `user_reference_number` on the `person` row.
 * Same version-checked save shape as Name & Gender (WAYFINDER decision 26) —
 * both sections patch the same row, just a different column subset, and both
 * render a lost version check via the shared `ConflictDialog` (#31).
 */
export function ReferenceNumbersSection({
  personId,
  loaded,
}: {
  readonly personId: string;
  readonly loaded: PersonReferenceNumberFields;
}) {
  const [baseline, setBaseline] = useState(loaded);
  const [draft, setDraft] = useState<ReferenceNumbersDraft>(() =>
    referenceNumbersDraft(loaded),
  );
  const [status, setStatus] = useState<
    "idle" | "saving" | "saved" | "conflict" | "error"
  >("idle");
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState<{
    readonly patch: PersonFieldPatch;
    readonly row: RowConflict<PersonEditFields>;
  } | null>(null);

  const familysearchId = useId();
  const ancestralFileId = useId();
  const userReferenceId = useId();

  const patch = referenceNumbersPatch(baseline, draft);
  const dirty = patch !== null;

  function field(key: keyof ReferenceNumbersDraft, value: string) {
    setDraft((prev) => ({ ...prev, [key]: value }));
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
        setDraft(referenceNumbersDraft(result.row));
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
    setDraft(referenceNumbersDraft(conflict.row.theirs));
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
      <Field label="FamilySearch ID" htmlFor={familysearchId}>
        <input
          id={familysearchId}
          value={draft.familysearchId}
          onChange={(e) => field("familysearchId", e.target.value)}
          className={inputClass}
        />
      </Field>
      <Field label="Ancestral File Number" htmlFor={ancestralFileId}>
        <input
          id={ancestralFileId}
          value={draft.ancestralFileNumber}
          onChange={(e) => field("ancestralFileNumber", e.target.value)}
          className={inputClass}
        />
      </Field>
      <Field label="User Reference Number" htmlFor={userReferenceId}>
        <input
          id={userReferenceId}
          value={draft.userReferenceNumber}
          onChange={(e) => field("userReferenceNumber", e.target.value)}
          placeholder="GEDCOM REFN"
          className={inputClass}
        />
      </Field>

      <SaveBar
        dirty={dirty}
        status={status}
        error={error}
        onSave={save}
        conflictMessage="This person's reference numbers changed while you had it open."
      />
    </div>
  );
}
