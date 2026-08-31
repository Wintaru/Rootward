"use client";

import { useId, useState } from "react";

import { savePersonFields } from "@/app/person/[personId]/edit/actions";
import type { PersonReferenceNumberFields } from "@/lib/db/person-edit";
import {
  type ReferenceNumbersDraft,
  referenceNumbersDraft,
  referenceNumbersPatch,
} from "@/lib/edit/person-fields";

import { Field, inputClass, SaveBar } from "./form";

/**
 * Reference Numbers (SPEC §8.3, §4.2, §10 item 27) — `familysearch_id`,
 * `ancestral_file_number`, and `user_reference_number` on the `person` row.
 * Same version-checked save shape as Name & Gender (WAYFINDER decision 26) —
 * both sections patch the same row, just a different column subset.
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
        setDraft(referenceNumbersDraft(result.row));
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
