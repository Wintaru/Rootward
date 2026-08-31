import { describe, expect, it } from "vitest";

import { validateInviteInput } from "./invite";

const PERSON = "11111111-2222-3333-4444-555555555555";

describe("validateInviteInput", () => {
  it("normalises the email and person ID and defaults the role", () => {
    const result = validateInviteInput(
      {
        email: "  Kim@Example.COM ",
        personId: PERSON.toUpperCase(),
        role: "viewer",
      },
      false,
    );
    expect(result).toEqual({
      ok: true,
      value: { email: "kim@example.com", personId: PERSON, role: "viewer" },
    });
  });

  it("rejects an email that is obviously not an address", () => {
    const result = validateInviteInput(
      { email: "not-an-email", personId: PERSON, role: "viewer" },
      true,
    );
    expect(result).toEqual({
      ok: false,
      error: expect.stringContaining("email"),
    });
  });

  it("rejects a person ID that is not a UUID", () => {
    const result = validateInviteInput(
      { email: "kim@example.com", personId: "42", role: "viewer" },
      true,
    );
    expect(result.ok).toBe(false);
  });

  it("rejects an unknown role string", () => {
    const result = validateInviteInput(
      { email: "kim@example.com", personId: PERSON, role: "superuser" },
      true,
    );
    expect(result.ok).toBe(false);
  });

  it("lets a non-admin invite only a viewer", () => {
    const asViewer = validateInviteInput(
      { email: "kim@example.com", personId: PERSON, role: "viewer" },
      false,
    );
    expect(asViewer.ok).toBe(true);

    for (const role of ["moderator", "admin"]) {
      const result = validateInviteInput(
        { email: "kim@example.com", personId: PERSON, role },
        false,
      );
      expect(result).toEqual({
        ok: false,
        error: expect.stringContaining("administrator"),
      });
    }
  });

  it("lets an admin invite a moderator or an admin", () => {
    for (const role of ["moderator", "admin"] as const) {
      const result = validateInviteInput(
        { email: "kim@example.com", personId: PERSON, role },
        true,
      );
      expect(result).toEqual({
        ok: true,
        value: { email: "kim@example.com", personId: PERSON, role },
      });
    }
  });
});
