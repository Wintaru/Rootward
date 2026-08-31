import { describe, expect, it } from "vitest";

import {
  type AcceptableInvitation,
  decideInvitationAcceptance,
} from "./invitation-decision";

const INVITATION: AcceptableInvitation = {
  id: "inv-1",
  email: "kim@example.com",
  personId: "person-1",
  role: "moderator",
};

describe("decideInvitationAcceptance", () => {
  it("links a pending, unlinked account to the invitation's person and role", () => {
    const decision = decideInvitationAcceptance(
      { status: "pending", personId: null },
      INVITATION,
    );
    expect(decision).toEqual({
      action: "link",
      invitationId: "inv-1",
      email: "kim@example.com",
      personId: "person-1",
      role: "moderator",
    });
  });

  it("skips when there is no pending invitation", () => {
    const decision = decideInvitationAcceptance(
      { status: "pending", personId: null },
      null,
    );
    expect(decision).toEqual({ action: "skip", reason: "no_invitation" });
  });

  it("never overwrites an already-active account", () => {
    const decision = decideInvitationAcceptance(
      { status: "active", personId: null },
      INVITATION,
    );
    expect(decision).toEqual({ action: "skip", reason: "skipped" });
  });

  it("never overwrites an account that is already linked to a person", () => {
    const decision = decideInvitationAcceptance(
      { status: "pending", personId: "other-person" },
      INVITATION,
    );
    expect(decision).toEqual({ action: "skip", reason: "skipped" });
  });

  it("skips a suspended account", () => {
    const decision = decideInvitationAcceptance(
      { status: "suspended", personId: null },
      INVITATION,
    );
    expect(decision).toEqual({ action: "skip", reason: "skipped" });
  });
});
