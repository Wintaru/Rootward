import { describe, expect, it } from "vitest";

import type { NotificationRow } from "@/lib/db/notifications";

import { describeNotification, notificationPersonId } from "./format";

function row(
  type: NotificationRow["type"],
  payload: Record<string, unknown> = {},
): NotificationRow {
  return {
    id: "n1",
    type,
    payload,
    createdAt: "2026-09-01T00:00:00Z",
    resolvedAt: null,
    readAt: null,
  };
}

describe("describeNotification", () => {
  it("prefers the payload's own message when present", () => {
    expect(
      describeNotification(row("import_finished", { message: "Imported 12" })),
    ).toBe("Imported 12");
  });

  it("falls back to a generic label when message is missing", () => {
    expect(describeNotification(row("import_finished", {}))).toBe(
      "A GEDCOM import finished.",
    );
    expect(describeNotification(row("import_failed", {}))).toBe(
      "A GEDCOM import failed.",
    );
    expect(describeNotification(row("claim_attempt_cap", {}))).toBe(
      "Self-claim attempt cap reached.",
    );
    expect(describeNotification(row("hide_request", {}))).toBe(
      "A hide request was submitted.",
    );
    expect(describeNotification(row("self_claim_linked", {}))).toBe(
      "A visitor linked their account to a family member.",
    );
  });

  it("ignores a blank message and falls back", () => {
    expect(describeNotification(row("import_failed", { message: "  " }))).toBe(
      "A GEDCOM import failed.",
    );
  });

  it("names the requester for access_requested when known", () => {
    expect(
      describeNotification(
        row("access_requested", { submitted_name: "Ada Lovelace" }),
      ),
    ).toBe("Ada Lovelace requested access.");
  });

  it("falls back to a generic subject for access_requested with no name", () => {
    expect(describeNotification(row("access_requested", {}))).toBe(
      "Someone requested access.",
    );
  });
});

describe("notificationPersonId", () => {
  it("reads person_id off a self_claim_linked payload", () => {
    expect(
      notificationPersonId(row("self_claim_linked", { person_id: "p1" })),
    ).toBe("p1");
  });

  it("is null for every other type, even if payload has a person_id-shaped field", () => {
    expect(
      notificationPersonId(row("access_requested", { person_id: "p1" })),
    ).toBeNull();
  });

  it("is null when the field is missing or not a string", () => {
    expect(notificationPersonId(row("self_claim_linked", {}))).toBeNull();
    expect(
      notificationPersonId(row("self_claim_linked", { person_id: 42 })),
    ).toBeNull();
  });
});
