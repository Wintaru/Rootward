"use client";

import { type FormEvent, useId, useState } from "react";
import { useRouter } from "next/navigation";

import { Constants } from "@/lib/db";
import { sexLabel } from "@/lib/person/labels";
import { Button } from "@/components/ui/button";
import { Input, inputClass } from "@/components/ui/input";

import { createPersonAction } from "./actions";

/** Submit lifecycle — a discriminated union so no two flags disagree. */
type SubmitState =
  | { readonly status: "idle" }
  | { readonly status: "submitting" }
  | { readonly status: "error"; readonly message: string };

/**
 * "New person" (SPEC §8.1, §8.3, issue #55): given name, surname, and sex —
 * all optional, since a placeholder person (no name at all) is normal in
 * genealogy. Sex defaults to `unknown` rather than a blank "Unspecified"
 * option — there is nothing yet to leave unspecified. Relationships,
 * events, and every other section wait for the edit view this redirects to
 * (#56 and later).
 */
export function NewPersonForm() {
  const router = useRouter();
  const givenId = useId();
  const surnameId = useId();
  const sexId = useId();

  const [givenName, setGivenName] = useState("");
  const [surname, setSurname] = useState("");
  const [sex, setSex] = useState<string>("unknown");
  const [state, setState] = useState<SubmitState>({ status: "idle" });

  const busy = state.status === "submitting";

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) {
      return;
    }
    setState({ status: "submitting" });
    try {
      const result = await createPersonAction({ givenName, surname, sex });
      if (result.ok) {
        router.push(`/person/${result.personId}/edit`);
        return;
      }
      setState({ status: "error", message: result.error });
    } catch {
      setState({
        status: "error",
        message: "Something went wrong. Try again in a moment.",
      });
    }
  }

  return (
    <form
      onSubmit={submit}
      className="border-border flex max-w-lg flex-col gap-4 rounded-lg border p-6"
    >
      <div className="flex flex-col gap-1.5">
        <label htmlFor={givenId} className="text-sm font-medium">
          Given name
        </label>
        <Input
          id={givenId}
          value={givenName}
          onChange={(e) => setGivenName(e.target.value)}
          placeholder="Unknown"
          disabled={busy}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor={surnameId} className="text-sm font-medium">
          Surname
        </label>
        <Input
          id={surnameId}
          value={surname}
          onChange={(e) => setSurname(e.target.value)}
          placeholder="Unknown"
          disabled={busy}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor={sexId} className="text-sm font-medium">
          Sex
        </label>
        <select
          id={sexId}
          value={sex}
          onChange={(e) => setSex(e.target.value)}
          disabled={busy}
          className={inputClass}
        >
          {Constants.public.Enums.sex.map((value) => (
            <option key={value} value={value}>
              {sexLabel(value)}
            </option>
          ))}
        </select>
      </div>

      {state.status === "error" && (
        <p className="text-destructive text-sm" role="alert">
          {state.message}
        </p>
      )}

      <Button className="w-fit" type="submit" disabled={busy}>
        {busy ? "Creating…" : "Create person"}
      </Button>
    </form>
  );
}
