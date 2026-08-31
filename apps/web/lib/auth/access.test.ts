import { describe, expect, it } from "vitest";

import { type AccountAccess, isActiveModerator } from "./access";

describe("isActiveModerator", () => {
  const cases: ReadonlyArray<{
    account: AccountAccess | null;
    expected: boolean;
    why: string;
  }> = [
    { account: null, expected: false, why: "no account row" },
    {
      account: { role: "admin", status: "active" },
      expected: true,
      why: "active admin",
    },
    {
      account: { role: "moderator", status: "active" },
      expected: true,
      why: "active moderator",
    },
    {
      account: { role: "viewer", status: "active" },
      expected: false,
      why: "active viewer",
    },
    {
      account: { role: "moderator", status: "pending" },
      expected: false,
      why: "moderator not yet active",
    },
    {
      account: { role: "admin", status: "suspended" },
      expected: false,
      why: "suspended admin",
    },
  ];

  for (const { account, expected, why } of cases) {
    it(`${expected ? "allows" : "denies"} ${why}`, () => {
      expect(isActiveModerator(account)).toBe(expected);
    });
  }
});
