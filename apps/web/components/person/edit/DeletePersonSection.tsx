"use client";

import { useRouter } from "next/navigation";
import { useId, useState } from "react";

import { deletePersonAction } from "@/app/person/[personId]/edit/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

import { Field } from "./form";

/**
 * Name & Gender's admin-only danger zone (SPEC §8.3, decision 18, issue #59).
 * Rendered only when the page's `isAdmin` check passed — RLS
 * (`delete_person`'s own `is_admin()` check) is the real boundary regardless.
 *
 * The typed-name confirmation is a safety catch against a misclick, not a
 * security control: the delete button stays disabled until the input exactly
 * matches `personDisplayName`. `not-found` (the person was already gone —
 * a concurrent delete, or a stale page) is treated the same as a successful
 * delete, since either way there is nothing left to show here.
 */
export function DeletePersonSection({
  personId,
  personDisplayName,
}: {
  readonly personId: string;
  readonly personDisplayName: string;
}) {
  const router = useRouter();
  const inputId = useId();
  const [confirmText, setConfirmText] = useState("");
  const [status, setStatus] = useState<"idle" | "deleting" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  const confirmed = confirmText === personDisplayName;

  async function handleDelete() {
    if (!confirmed || status === "deleting") {
      return;
    }
    setStatus("deleting");
    setError(null);

    const result = await deletePersonAction({ personId });
    if (result.status === "error") {
      setError(result.message);
      setStatus("error");
      return;
    }
    router.push("/tree");
  }

  return (
    <div className="border-destructive/50 mt-8 flex flex-col gap-3 rounded-md border p-4">
      <h3 className="text-destructive text-sm font-semibold">Danger zone</h3>
      <p className="text-muted-foreground text-sm">
        Deleting {personDisplayName} removes their events, facts, additional
        names, and relationships, and cannot be undone. A linked account is
        unlinked, not deleted.
      </p>
      <Field label={`Type "${personDisplayName}" to confirm`} htmlFor={inputId}>
        <Input
          id={inputId}
          value={confirmText}
          onChange={(e) => setConfirmText(e.target.value)}
          autoComplete="off"
        />
      </Field>
      {status === "error" && error !== null && (
        <p className="text-destructive text-sm" role="alert">
          {error}
        </p>
      )}
      <Button
        className="w-fit"
        variant="destructive"
        type="button"
        onClick={handleDelete}
        disabled={!confirmed || status === "deleting"}
      >
        {status === "deleting" ? "Deleting…" : `Delete ${personDisplayName}`}
      </Button>
    </div>
  );
}
