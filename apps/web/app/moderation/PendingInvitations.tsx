import type { PendingInvitation } from "@/lib/db";

import { Section } from "./Section";

/** Pending invitations from the #20 invite flow, newest first. */
export function PendingInvitations({
  invitations,
}: {
  invitations: readonly PendingInvitation[];
}) {
  return (
    <Section title="Pending invitations">
      {invitations.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          No invitations are waiting to be accepted.
        </p>
      ) : (
        <ul className="flex flex-col divide-y">
          {invitations.map((invitation) => (
            <li
              key={invitation.id}
              className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-3 first:pt-0 last:pb-0"
            >
              <span className="text-sm font-medium">{invitation.email}</span>
              <span className="text-muted-foreground text-sm">
                {invitation.personName}
                {invitation.role !== "viewer" && ` · ${invitation.role}`}
              </span>
              <span className="text-muted-foreground text-xs">
                {formatDate(invitation.createdAt)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

function formatDate(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? iso
    : date.toLocaleDateString(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric",
      });
}
