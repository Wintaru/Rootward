import { describe, expect, it } from "vitest";

import {
  describeCaller,
  describeShape,
  describeType,
  isSpeculativeRequest,
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

describe("isSpeculativeRequest", () => {
  const withHeaders = (init: Record<string, string>) => new Headers(init);

  it("recognises the standard Sec-Purpose values", () => {
    expect(
      isSpeculativeRequest(withHeaders({ "Sec-Purpose": "prefetch" })),
    ).toBe(true);
    expect(
      isSpeculativeRequest(
        withHeaders({ "Sec-Purpose": "prefetch;prerender" }),
      ),
    ).toBe(true);
  });

  it("recognises the older spellings browsers still send", () => {
    expect(isSpeculativeRequest(withHeaders({ Purpose: "prefetch" }))).toBe(
      true,
    );
    expect(isSpeculativeRequest(withHeaders({ "X-Purpose": "preview" }))).toBe(
      true,
    );
    expect(isSpeculativeRequest(withHeaders({ "X-Moz": "prefetch" }))).toBe(
      true,
    );
  });

  it("ignores case, because header values are not normalised", () => {
    expect(
      isSpeculativeRequest(withHeaders({ "Sec-Purpose": "PreFetch" })),
    ).toBe(true);
  });

  it("lets an ordinary navigation through", () => {
    expect(isSpeculativeRequest(withHeaders({}))).toBe(false);
    expect(
      isSpeculativeRequest(withHeaders({ "User-Agent": "Mozilla/5.0" })),
    ).toBe(false);
    // `Sec-Fetch-*` is on every navigation and must not be read as speculative.
    expect(
      isSpeculativeRequest(
        withHeaders({
          "Sec-Fetch-Mode": "navigate",
          "Sec-Fetch-Dest": "document",
        }),
      ),
    ).toBe(false);
  });
});

describe("describeCaller", () => {
  it("names the agent, and the purpose header when there is one", () => {
    expect(
      describeCaller(
        new Headers({ "User-Agent": "Mozilla/5.0", "Sec-Purpose": "prefetch" }),
      ),
    ).toBe('ua="Mozilla/5.0" sec-purpose=prefetch');
  });

  it("says so when there is no agent at all", () => {
    expect(describeCaller(new Headers({}))).toBe("ua=none");
  });

  it("truncates an agent too long for one line", () => {
    const result = describeCaller(
      new Headers({ "User-Agent": "M".repeat(500) }),
    );
    // `ua="` + 200 characters + the ellipsis + the closing quote.
    expect(result).toHaveLength(206);
    expect(result.endsWith('\u2026"')).toBe(true);
  });

  it("cannot be handed a newline in the first place", () => {
    // The platform refuses it, which is why `describeCaller` only has to
    // truncate. Asserted here so the guarantee does not rest on memory.
    expect(() => new Headers({ "User-Agent": "x\nforged" })).toThrow();
  });
});
