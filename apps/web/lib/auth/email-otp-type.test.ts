import { describe, expect, it } from "vitest";

import { parseEmailOtpType } from "./email-otp-type";

describe("parseEmailOtpType", () => {
  it("accepts the three kinds Rootward mails", () => {
    expect(parseEmailOtpType("invite")).toBe("invite");
    expect(parseEmailOtpType("magiclink")).toBe("magiclink");
    expect(parseEmailOtpType("signup")).toBe("signup");
  });

  it("rejects a missing or empty parameter", () => {
    expect(parseEmailOtpType(null)).toBeNull();
    expect(parseEmailOtpType(undefined)).toBeNull();
    expect(parseEmailOtpType("")).toBeNull();
  });

  it("rejects flows this deployment does not send", () => {
    expect(parseEmailOtpType("recovery")).toBeNull();
    expect(parseEmailOtpType("email_change")).toBeNull();
  });

  it("does not accept a near miss", () => {
    expect(parseEmailOtpType("Invite")).toBeNull();
    expect(parseEmailOtpType("magic_link")).toBeNull();
    expect(parseEmailOtpType("invite ")).toBeNull();
  });
});
