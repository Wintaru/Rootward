import { describe, expect, it } from "vitest";

import { isAdminEmail } from "./admin-email";

describe("isAdminEmail", () => {
  it("matches the configured address exactly", () => {
    expect(isAdminEmail("admin@rootward.test", "admin@rootward.test")).toBe(
      true,
    );
  });

  it("ignores case and surrounding whitespace on both sides", () => {
    expect(isAdminEmail("Admin@Rootward.test", "  admin@rootward.TEST ")).toBe(
      true,
    );
  });

  it("does not match a different address", () => {
    expect(isAdminEmail("someone@rootward.test", "admin@rootward.test")).toBe(
      false,
    );
  });

  it("treats an unset, empty, or placeholder ADMIN_EMAIL as no bootstrap", () => {
    expect(isAdminEmail("admin@rootward.test", undefined)).toBe(false);
    expect(isAdminEmail("admin@rootward.test", "")).toBe(false);
    expect(isAdminEmail("admin@rootward.test", "   ")).toBe(false);
    expect(isAdminEmail("you@example.com", "you@example.com")).toBe(false);
  });

  it("never matches a user without an email", () => {
    expect(isAdminEmail(null, "admin@rootward.test")).toBe(false);
    expect(isAdminEmail(undefined, "admin@rootward.test")).toBe(false);
    expect(isAdminEmail("", "admin@rootward.test")).toBe(false);
  });
});
