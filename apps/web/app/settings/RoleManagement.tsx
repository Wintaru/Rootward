"use client";

import Link from "next/link";
import { useId, useState } from "react";

import { Section } from "@/components/layout/Section";
import { ACCOUNT_ROLES, type AccountRole, type AccountSummary } from "@/lib/db";
import { enumTokenLabel } from "@/lib/person/labels";

import { changeAccountRoleAction, setAccountStatusAction } from "./actions";

/** The full account roster (SPEC §9.4, decision 18): change a role, suspend,
 * or reactivate. `currentUserId` disables the row for the signed-in admin's
 * own account — the server actions refuse it too, but disabling the control
 * here means the reason ("you cannot act on your own account") does not
 * have to round-trip as an error message. */
export function RoleManagement({
  accounts,
  currentUserId,
}: {
  readonly accounts: readonly AccountSummary[];
  readonly currentUserId: string;
}) {
  return (
    <Section
      title="Accounts"
      description="Every account on the tree. Changing a role or status takes effect immediately."
    >
      {accounts.length === 0 ? (
        <p className="text-muted-foreground text-sm">No accounts yet.</p>
      ) : (
        <ul className="divide-border divide-y">
          {accounts.map((account) => (
            <AccountRow
              key={account.accountId}
              account={account}
              isSelf={account.accountId === currentUserId}
            />
          ))}
        </ul>
      )}
    </Section>
  );
}

type RowState =
  | { readonly status: "idle" }
  | { readonly status: "busy" }
  | { readonly status: "error"; readonly message: string };

function AccountRow({
  account,
  isSelf,
}: {
  readonly account: AccountSummary;
  readonly isSelf: boolean;
}) {
  const roleId = useId();
  const [role, setRole] = useState(account.role);
  const [status, setStatus] = useState(account.status);
  const [state, setState] = useState<RowState>({ status: "idle" });
  const busy = state.status === "busy";
  const locked = isSelf || busy;

  async function changeRole(next: AccountRole) {
    const previous = role;
    setRole(next);
    setState({ status: "busy" });
    const result = await changeAccountRoleAction(account.accountId, next);
    if (result.ok) {
      setState({ status: "idle" });
    } else {
      setRole(previous);
      setState({ status: "error", message: result.error });
    }
  }

  async function toggleStatus() {
    const next = status === "suspended" ? "active" : "suspended";
    setState({ status: "busy" });
    const result = await setAccountStatusAction(account.accountId, next);
    if (result.ok) {
      setStatus(next);
      setState({ status: "idle" });
    } else {
      setState({ status: "error", message: result.error });
    }
  }

  return (
    <li className="flex flex-col gap-2 py-4 first:pt-0 last:pb-0">
      <div className="flex flex-col gap-0.5">
        <p className="text-sm font-medium">
          {account.displayName ?? "Unnamed account"}
          {isSelf && (
            <span className="text-muted-foreground font-normal"> (you)</span>
          )}
        </p>
        <p className="text-muted-foreground text-xs">
          {enumTokenLabel(status)}
          {account.personId !== null && (
            <>
              {" · linked to "}
              <Link
                href={`/person/${account.personId}`}
                className="hover:underline"
              >
                {account.personName}
              </Link>
            </>
          )}
        </p>
      </div>

      {state.status === "error" && (
        <p className="text-destructive text-sm" role="alert">
          {state.message}
        </p>
      )}

      <div className="flex items-center gap-3">
        <label htmlFor={roleId} className="sr-only">
          Role
        </label>
        <select
          id={roleId}
          value={role}
          onChange={(e) => void changeRole(e.target.value as AccountRole)}
          disabled={locked}
          className="border-border rounded-md border px-2 py-1 text-xs disabled:opacity-50"
        >
          {ACCOUNT_ROLES.map((option) => (
            <option key={option} value={option}>
              {enumTokenLabel(option)}
            </option>
          ))}
        </select>

        <button
          type="button"
          onClick={() => void toggleStatus()}
          disabled={locked}
          className="border-border text-destructive rounded-md border px-3 py-1.5 text-xs font-medium disabled:opacity-50"
        >
          {status === "suspended" ? "Reactivate" : "Suspend"}
        </button>
      </div>
    </li>
  );
}
