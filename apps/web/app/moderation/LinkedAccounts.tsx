"use client";

import Link from "next/link";
import { useState } from "react";

import { Section } from "@/components/layout/Section";
import type { LinkedAccount, PersonSearchOption } from "@/lib/db";
import { enumTokenLabel } from "@/lib/person/labels";

import { reassignAccountAction, unlinkAccountAction } from "./actions";
import { PersonPicker } from "./PersonPicker";

type RowState =
  | { readonly status: "idle" }
  | { readonly status: "busy" }
  | { readonly status: "error"; readonly message: string };

/**
 * Every account currently linked to a person — self-claims and invite-accepts
 * both land here (decision 12: "Moderators can reassign or unlink a wrong
 * claim" draws no distinction by how the link was made). Reassign/unlink are
 * admin-only (`account_update` RLS is `is_admin()` — `lib/db/moderation.ts`'s
 * module doc). A non-admin moderator still sees the roster, just without the
 * controls, so they can spot a wrong claim and flag it even though they
 * cannot fix it themselves.
 */
export function LinkedAccounts({
  accounts,
  canManage,
}: {
  readonly accounts: readonly LinkedAccount[];
  readonly canManage: boolean;
}) {
  const [removedIds, setRemovedIds] = useState<ReadonlySet<string>>(new Set());
  const visible = accounts.filter(
    (account) => !removedIds.has(account.accountId),
  );

  return (
    <Section
      title="Linked accounts"
      description="Every account currently linked to a person, most recently changed first."
    >
      {visible.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          No accounts are linked yet.
        </p>
      ) : (
        <ul className="divide-border divide-y">
          {visible.map((account) => (
            <LinkedAccountRow
              key={account.accountId}
              account={account}
              canManage={canManage}
              onUnlinked={() =>
                setRemovedIds((ids) => new Set(ids).add(account.accountId))
              }
            />
          ))}
        </ul>
      )}
    </Section>
  );
}

function LinkedAccountRow({
  account,
  canManage,
  onUnlinked,
}: {
  readonly account: LinkedAccount;
  readonly canManage: boolean;
  readonly onUnlinked: () => void;
}) {
  // Seeded from props and optimistically updated by `reassign()` below, but
  // resynced whenever a fresh `account` arrives (e.g. the route refresh a
  // server action's `revalidatePath` triggers) — otherwise this component
  // instance (keyed on the never-changing `account.accountId`) would keep
  // showing a stale linked person after a concurrent reassign/unlink by
  // another admin or browser tab. Adjusted during render (React's own
  // "adjusting state when a prop changes" pattern), not in a `useEffect` —
  // the codebase's `react-hooks/set-state-in-effect` lint rule rejects a
  // setState called synchronously in an effect body (see `PlaceInput.tsx`).
  const [syncedFrom, setSyncedFrom] = useState({
    id: account.personId,
    name: account.personName,
  });
  const [linkedTo, setLinkedTo] = useState(syncedFrom);
  if (
    account.personId !== syncedFrom.id ||
    account.personName !== syncedFrom.name
  ) {
    const next = { id: account.personId, name: account.personName };
    setSyncedFrom(next);
    setLinkedTo(next);
  }
  const [reassigning, setReassigning] = useState(false);
  const [state, setState] = useState<RowState>({ status: "idle" });
  const busy = state.status === "busy";

  async function reassign(person: PersonSearchOption) {
    setState({ status: "busy" });
    try {
      const result = await reassignAccountAction(account.accountId, person.id);
      if (result.ok) {
        setLinkedTo({ id: person.id, name: person.name });
        setReassigning(false);
        setState({ status: "idle" });
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

  async function unlink() {
    setState({ status: "busy" });
    try {
      const result = await unlinkAccountAction(account.accountId);
      if (result.ok) {
        onUnlinked();
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
          {account.displayName ?? "Unnamed account"}
        </p>
        <p className="text-muted-foreground text-xs">
          {enumTokenLabel(account.role)} · {enumTokenLabel(account.status)} ·
          linked to{" "}
          <Link href={`/person/${linkedTo.id}`} className="hover:underline">
            {linkedTo.name}
          </Link>
        </p>
      </div>

      {state.status === "error" && (
        <p className="text-destructive text-sm" role="alert">
          {state.message}
        </p>
      )}

      {canManage && reassigning && (
        <PersonPicker
          label="Reassign to person"
          disabled={busy}
          onSelect={(person) => void reassign(person)}
        />
      )}

      {canManage && (
        <div className="flex gap-2">
          {reassigning ? (
            <button
              type="button"
              onClick={() => setReassigning(false)}
              disabled={busy}
              className="border-border rounded-md border px-3 py-1.5 text-xs font-medium disabled:opacity-50"
            >
              Cancel
            </button>
          ) : (
            <button
              type="button"
              onClick={() => setReassigning(true)}
              disabled={busy}
              className="border-border rounded-md border px-3 py-1.5 text-xs font-medium disabled:opacity-50"
            >
              Reassign
            </button>
          )}
          <button
            type="button"
            onClick={() => void unlink()}
            disabled={busy}
            className="border-border text-destructive rounded-md border px-3 py-1.5 text-xs font-medium disabled:opacity-50"
          >
            {busy ? "Unlinking…" : "Unlink"}
          </button>
        </div>
      )}
    </li>
  );
}
