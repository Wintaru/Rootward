"use client";

import { useState } from "react";

import { Section } from "@/components/layout/Section";
import type { PendingAccessRequest, PersonSearchOption } from "@/lib/db";
import { formatSubmittedBirth } from "@/lib/moderation/access-requests";

import {
  approveAccessRequestAction,
  rejectAccessRequestAction,
} from "./actions";
import { PersonPicker } from "./PersonPicker";

type RowState =
  | { readonly status: "idle" }
  | { readonly status: "submitting" }
  | { readonly status: "error"; readonly message: string };

/**
 * The pending `access_request` queue (SPEC §9.3, §10 item 36). Reject is
 * moderator+; approve additionally needs a chosen person and is admin-only
 * (`account_update` RLS — see `lib/db/moderation.ts`'s module doc). A
 * resolved row is removed from view locally rather than refetched — the
 * server action already re-validates `status = 'pending'`, so a stale local
 * list cannot cause a double-resolve, only a row that lingers until the next
 * navigation if two moderators race it.
 */
export function AccessRequestsQueue({
  requests,
  canApprove,
}: {
  readonly requests: readonly PendingAccessRequest[];
  readonly canApprove: boolean;
}) {
  const [resolvedIds, setResolvedIds] = useState<ReadonlySet<string>>(
    new Set(),
  );
  const visible = requests.filter((request) => !resolvedIds.has(request.id));

  return (
    <Section
      title="Access requests"
      description="A signed-in visitor whose self-claim did not match anyone."
    >
      {visible.length === 0 ? (
        <p className="text-muted-foreground text-sm">No pending requests.</p>
      ) : (
        <ul className="divide-border divide-y">
          {visible.map((request) => (
            <AccessRequestRow
              key={request.id}
              request={request}
              canApprove={canApprove}
              onResolved={() =>
                setResolvedIds((ids) => new Set(ids).add(request.id))
              }
            />
          ))}
        </ul>
      )}
    </Section>
  );
}

function AccessRequestRow({
  request,
  canApprove,
  onResolved,
}: {
  readonly request: PendingAccessRequest;
  readonly canApprove: boolean;
  readonly onResolved: () => void;
}) {
  const [state, setState] = useState<RowState>({ status: "idle" });
  const [person, setPerson] = useState<PersonSearchOption | null>(null);
  const busy = state.status === "submitting";

  const birth = formatSubmittedBirth(
    request.submittedBirthMonth,
    request.submittedBirthYear,
  );
  const subtitle = [birth, request.accountDisplayName].filter(
    (part): part is string => part !== null,
  );

  async function reject() {
    setState({ status: "submitting" });
    try {
      const result = await rejectAccessRequestAction(request.id);
      if (result.ok) {
        onResolved();
      } else {
        setState({ status: "error", message: result.error });
      }
    } catch {
      setState({
        status: "error",
        message: "Something went wrong. Try again in a moment.",
      });
    }
  }

  async function approve() {
    if (person === null) {
      return;
    }
    setState({ status: "submitting" });
    try {
      const result = await approveAccessRequestAction(
        request.id,
        request.accountId,
        person.id,
      );
      if (result.ok) {
        onResolved();
      } else {
        setState({ status: "error", message: result.error });
      }
    } catch {
      setState({
        status: "error",
        message: "Something went wrong. Try again in a moment.",
      });
    }
  }

  return (
    <li className="flex flex-col gap-3 py-4 first:pt-0 last:pb-0">
      <div className="flex flex-col gap-0.5">
        <p className="text-sm font-medium">
          {request.submittedName ??
            request.accountDisplayName ??
            "Unnamed visitor"}
        </p>
        {subtitle.length > 0 && (
          <p className="text-muted-foreground text-xs">
            {subtitle.join(" · ")}
          </p>
        )}
        {request.message !== null && request.message.trim() !== "" && (
          <p className="text-sm">{request.message}</p>
        )}
      </div>

      {state.status === "error" && (
        <p className="text-destructive text-sm" role="alert">
          {state.message}
        </p>
      )}

      {canApprove ? (
        person === null ? (
          <PersonPicker
            label="Link to person"
            disabled={busy}
            onSelect={setPerson}
          />
        ) : (
          <p className="text-sm">
            Linking to <span className="font-medium">{person.name}</span> —{" "}
            <button
              type="button"
              onClick={() => setPerson(null)}
              disabled={busy}
              className="text-muted-foreground hover:text-foreground underline disabled:opacity-50"
            >
              change
            </button>
          </p>
        )
      ) : (
        <p className="text-muted-foreground text-xs">
          Only an administrator can approve and link a request.
        </p>
      )}

      <div className="flex gap-2">
        {canApprove && (
          <button
            type="button"
            onClick={() => void approve()}
            disabled={busy || person === null}
            className="bg-primary text-primary-foreground rounded-md px-3 py-1.5 text-xs font-medium disabled:opacity-50"
          >
            {busy ? "Approving…" : "Approve"}
          </button>
        )}
        <button
          type="button"
          onClick={() => void reject()}
          disabled={busy}
          className="border-border rounded-md border px-3 py-1.5 text-xs font-medium disabled:opacity-50"
        >
          {busy ? "Rejecting…" : "Reject"}
        </button>
      </div>
    </li>
  );
}
