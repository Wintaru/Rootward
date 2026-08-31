"use client";

import { type FormEvent, useId, useState } from "react";

import { inviteToClaim } from "./actions";

/** Submit lifecycle — a discriminated union so no two flags disagree. */
type SubmitState =
  | { status: "idle" }
  | { status: "submitting" }
  | { status: "error"; message: string }
  | { status: "sent"; email: string };

/**
 * "Invite to claim" (SPEC §9.2). Until the person page (issue #25) exists, the
 * moderator pastes a person ID; a link from that page will prefill it through
 * `?personId=`. Server-side, the action re-checks moderator access, validates
 * the input, and `invitation_insert` RLS re-checks the admin-only role rule.
 */
export function InviteToClaimForm({
  canGrantRoles,
  defaultPersonId,
}: {
  canGrantRoles: boolean;
  defaultPersonId: string;
}) {
  const emailId = useId();
  const personId = useId();
  const roleId = useId();

  const [email, setEmail] = useState("");
  const [person, setPerson] = useState(defaultPersonId);
  const [role, setRole] = useState("viewer");
  const [state, setState] = useState<SubmitState>({ status: "idle" });

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (state.status === "submitting") {
      return;
    }
    setState({ status: "submitting" });
    try {
      const result = await inviteToClaim({ email, personId: person, role });
      if (result.ok) {
        setState({ status: "sent", email: result.email });
        setEmail("");
        setPerson("");
        setRole("viewer");
      } else {
        setState({ status: "error", message: result.error });
      }
    } catch {
      // A thrown server action (a network drop, an unhandled server error) must
      // not leave the form stuck on "Sending…".
      setState({
        status: "error",
        message: "Something went wrong. Try again in a moment.",
      });
    }
  }

  const busy = state.status === "submitting";

  return (
    <form
      onSubmit={submit}
      className="border-border flex flex-col gap-4 rounded-lg border p-6"
    >
      <div className="flex flex-col gap-1.5">
        <h2 className="text-lg font-medium">
          Invite someone to claim a person
        </h2>
        <p className="text-muted-foreground text-sm">
          They get an email invitation. On their first sign-in their account is
          linked to that person and activated.
        </p>
      </div>

      <Field label="Email address" htmlFor={emailId}>
        <input
          id={emailId}
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="email"
          disabled={busy}
          className={inputClass}
        />
      </Field>

      <Field label="Person ID" htmlFor={personId}>
        <input
          id={personId}
          value={person}
          onChange={(e) => setPerson(e.target.value)}
          placeholder="00000000-0000-0000-0000-000000000000"
          disabled={busy}
          className={`${inputClass} font-mono`}
        />
      </Field>

      {canGrantRoles && (
        <Field label="Role" htmlFor={roleId}>
          <select
            id={roleId}
            value={role}
            onChange={(e) => setRole(e.target.value)}
            disabled={busy}
            className={inputClass}
          >
            <option value="viewer">Viewer</option>
            <option value="moderator">Moderator</option>
            <option value="admin">Admin</option>
          </select>
        </Field>
      )}

      {state.status === "error" && (
        <p className="text-destructive text-sm" role="alert">
          {state.message}
        </p>
      )}
      {state.status === "sent" && (
        <p className="text-sm" role="status">
          Invitation sent to {state.email}.
        </p>
      )}

      <button
        type="submit"
        disabled={busy}
        className="bg-primary text-primary-foreground w-fit rounded-md px-4 py-2 text-sm font-medium disabled:opacity-50"
      >
        {busy ? "Sending…" : "Send invitation"}
      </button>
    </form>
  );
}

const inputClass = "border-border rounded-md border px-3 py-2 text-sm";

function Field({
  label,
  htmlFor,
  children,
}: {
  label: string;
  htmlFor: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={htmlFor} className="text-sm font-medium">
        {label}
      </label>
      {children}
    </div>
  );
}
