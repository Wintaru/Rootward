import { describe, expect, it } from "vitest";

import { defaultPartnerRoleForSex, toPersonRef } from "./relationships";

describe("defaultPartnerRoleForSex", () => {
  it("maps male to husband", () => {
    expect(defaultPartnerRoleForSex("male")).toBe("husband");
  });

  it("maps female to wife", () => {
    expect(defaultPartnerRoleForSex("female")).toBe("wife");
  });

  it("maps unknown, other, and null to partner", () => {
    expect(defaultPartnerRoleForSex("unknown")).toBe("partner");
    expect(defaultPartnerRoleForSex("other")).toBe("partner");
    expect(defaultPartnerRoleForSex(null)).toBe("partner");
  });
});

describe("toPersonRef", () => {
  it("passes an existing person id through unchanged", () => {
    expect(toPersonRef({ kind: "existing", personId: "p1" })).toEqual({
      kind: "existing",
      personId: "p1",
    });
  });

  it("normalises a new person's blank name fields to null", () => {
    expect(
      toPersonRef({
        kind: "new",
        givenName: "  ",
        surname: "  ",
        sex: "unknown",
      }),
    ).toEqual({ kind: "new", givenName: null, surname: null, sex: "unknown" });
  });

  it("trims a new person's name fields", () => {
    expect(
      toPersonRef({
        kind: "new",
        givenName: " Ada ",
        surname: " Lovelace ",
        sex: "female",
      }),
    ).toEqual({
      kind: "new",
      givenName: "Ada",
      surname: "Lovelace",
      sex: "female",
    });
  });
});
