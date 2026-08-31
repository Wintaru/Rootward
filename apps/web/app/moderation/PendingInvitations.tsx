import type { PendingInvitation } from "@/lib/db";

/**
 * The `/moderation` stub list: pending invitations, newest first. The full
 * moderation queue (access requests, self-claims, reassign / unlink) is issue
 * #36.
 */
export function PendingInvitations({
  invitations,
}: {
  invitations: readonly PendingInvitation[];
}) {
  return (
    <section className="border-border flex flex-col gap-4 rounded-lg border p-6">
      <h2 className="text-lg font-medium">Pending invitations</h2>

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
    </section>
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
