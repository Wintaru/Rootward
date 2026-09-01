import type { NotificationRow } from "@/lib/db/notifications";
import type { NotificationType } from "@/lib/db/types";

/**
 * Pure notification-center formatting (SPEC §4.7, §8.5, decision 27) --
 * framework- and Supabase-client-free, so it unit-tests without a running
 * database. `NotificationBell` (the client component) owns the channel and
 * data-fetch lifecycle and calls into this.
 */

const NOTIFICATION_LABELS: Readonly<Record<NotificationType, string>> = {
  self_claim_linked: "A visitor linked their account to a family member.",
  access_requested: "requested access.",
  claim_attempt_cap: "Self-claim attempt cap reached.",
  import_finished: "A GEDCOM import finished.",
  import_failed: "A GEDCOM import failed.",
  hide_request: "A hide request was submitted.",
};

function stringField(
  payload: Record<string, unknown>,
  key: string,
): string | null {
  const value = payload[key];
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

/**
 * A one-line summary for a notification row. Prefers the payload's own
 * free-text `message` (the shape `claim_attempt_cap` / `import_finished` /
 * `import_failed` / `hide_request` all use -- SPEC §7) or `submitted_name`
 * (`access_requested`) over the generic per-type fallback, so the queue reads
 * as specifically as the data allows.
 */
export function describeNotification(notification: NotificationRow): string {
  switch (notification.type) {
    case "self_claim_linked":
    case "claim_attempt_cap":
    case "import_finished":
    case "import_failed":
    case "hide_request":
      return (
        stringField(notification.payload, "message") ??
        NOTIFICATION_LABELS[notification.type]
      );
    case "access_requested": {
      const name = stringField(notification.payload, "submitted_name");
      return name !== null
        ? `${name} ${NOTIFICATION_LABELS.access_requested}`
        : `Someone ${NOTIFICATION_LABELS.access_requested}`;
    }
    default:
      return assertNever(notification.type);
  }
}

/**
 * The person a notification's payload points at, when it has one
 * (`self_claim_linked`) -- lets the queue link through to that profile. Every
 * other type's payload names an account, an import job, or nothing
 * resolvable to a person.
 */
export function notificationPersonId(
  notification: NotificationRow,
): string | null {
  if (notification.type !== "self_claim_linked") {
    return null;
  }
  return stringField(notification.payload, "person_id");
}

function assertNever(value: never): never {
  throw new Error(`Unhandled notification type: ${JSON.stringify(value)}`);
}
