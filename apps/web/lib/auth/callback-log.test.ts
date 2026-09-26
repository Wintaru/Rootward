import { describe, expect, it } from "vitest";

import {
  describeShape,
  describeType,
  messageOf,
  sanitizeDetail,
} from "./callback-log";

describe("describeShape", () => {
  it("names the credential the link carried", () => {
    expect(describeShape("abc", null)).toBe("code");
    expect(describeShape(null, "abc")).toBe("token_hash");
    expect(describeShape(null, null)).toBe("none");
  });

  it("prefers the code, matching the order the route redeems in", () => {
    expect(describeShape("abc", "def")).toBe("code");
  });
});

describe("describeType", () => {
  it("names a type the deployment sends", () => {
    expect(describeType("invite", "invite")).toBe("invite");
  });

  it("distinguishes a missing type from a refused one", () => {
    expect(describeType(null, null)).toBe("none");
    expect(describeType("recovery", null)).toBe("rejected");
  });

  it("never echoes the raw value, so a crafted link cannot forge log lines", () => {
    expect(describeType("invite\nauth/callback: signed in", null)).toBe(
      "rejected",
    );
    expect(describeType("\r\n[fake] ok", null)).toBe("rejected");
  });
});

describe("messageOf", () => {
  it("unwraps an Error", () => {
    expect(messageOf(new Error("token expired"))).toBe("token expired");
  });

  it("stringifies anything else rather than throwing", () => {
    expect(messageOf("plain string")).toBe("plain string");
    expect(messageOf(undefined)).toBe("undefined");
  });
});

describe("sanitizeDetail", () => {
  it("leaves an ordinary message alone", () => {
    expect(sanitizeDetail("Email link is invalid or has expired")).toBe(
      "Email link is invalid or has expired",
    );
  });

  it("flattens newlines, so a detail cannot forge a second log line", () => {
    expect(sanitizeDetail("expired\nauth/callback: signed in")).toBe(
      "expired auth/callback: signed in",
    );
    expect(sanitizeDetail("a\r\n\r\nb")).toBe("a b");
  });

  it("truncates a message too long for one line", () => {
    const result = sanitizeDetail("x".repeat(500));
    expect(result).toHaveLength(201);
    expect(result.endsWith("…")).toBe(true);
  });
});
