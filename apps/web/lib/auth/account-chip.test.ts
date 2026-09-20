import { describe, expect, it } from "vitest";

import { chipIdentity } from "./account-chip";

describe("chipIdentity", () => {
  it("takes the first word and two initials from a display name", () => {
    expect(chipIdentity("Josh Donner", "j@example.test")).toEqual({
      firstName: "Josh",
      initials: "JD",
    });
    expect(chipIdentity("  Mary  Anne   Smith ", null)).toEqual({
      firstName: "Mary",
      initials: "MS",
    });
  });

  it("uses one initial for a single-word name", () => {
    expect(chipIdentity("Cher", null)).toEqual({
      firstName: "Cher",
      initials: "C",
    });
  });

  it("falls back to the email's local part, then to a placeholder", () => {
    expect(chipIdentity(null, "e2e-admin@rootward.test")).toEqual({
      firstName: "e2e-admin",
      initials: "E",
    });
    expect(chipIdentity("", "")).toEqual({
      firstName: "Member",
      initials: "?",
    });
    expect(chipIdentity(null, null)).toEqual({
      firstName: "Member",
      initials: "?",
    });
  });

  it("upper-cases a non-ASCII initial by code point", () => {
    expect(chipIdentity("émile zola", null).initials).toBe("ÉZ");
  });
});
