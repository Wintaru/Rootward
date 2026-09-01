import { describe, expect, it } from "vitest";

import {
  type AccountAccess,
  isActiveAdmin,
  isActiveModerator,
  isApproved,
  resolveOnboardingStage,
} from "./access";

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

describe("isActiveAdmin", () => {
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
      expected: false,
      why: "active moderator (not admin)",
    },
    {
      account: { role: "admin", status: "pending" },
      expected: false,
      why: "admin not yet active",
    },
    {
      account: { role: "admin", status: "suspended" },
      expected: false,
      why: "suspended admin",
    },
  ];

  for (const { account, expected, why } of cases) {
    it(`${expected ? "allows" : "denies"} ${why}`, () => {
      expect(isActiveAdmin(account)).toBe(expected);
    });
  }
});

describe("isApproved", () => {
  const cases: ReadonlyArray<{
    account: AccountAccess | null;
    expected: boolean;
    why: string;
  }> = [
    { account: null, expected: false, why: "no account row" },
    {
      account: { role: "viewer", status: "active" },
      expected: true,
      why: "active viewer",
    },
    {
      account: { role: "admin", status: "active" },
      expected: true,
      why: "active admin",
    },
    {
      account: { role: "viewer", status: "pending" },
      expected: false,
      why: "pending viewer",
    },
    {
      account: { role: "moderator", status: "suspended" },
      expected: false,
      why: "suspended moderator",
    },
  ];

  for (const { account, expected, why } of cases) {
    it(`${expected ? "allows" : "denies"} ${why}`, () => {
      expect(isApproved(account)).toBe(expected);
    });
  }
});

describe("resolveOnboardingStage", () => {
  const cases: ReadonlyArray<{
    account: AccountAccess | null;
    kind: "onboard" | "approved" | "suspended";
    why: string;
  }> = [
    { account: null, kind: "onboard", why: "row not created yet" },
    {
      account: { role: "viewer", status: "pending" },
      kind: "onboard",
      why: "signed in, not approved",
    },
    {
      account: { role: "viewer", status: "active" },
      kind: "approved",
      why: "approved member",
    },
    {
      account: { role: "moderator", status: "active" },
      kind: "approved",
      why: "active moderator",
    },
    {
      account: { role: "viewer", status: "suspended" },
      kind: "suspended",
      why: "suspended account",
    },
  ];

  for (const { account, kind, why } of cases) {
    it(`${why} → ${kind}`, () => {
      expect(resolveOnboardingStage(account).kind).toBe(kind);
    });
  }
});
