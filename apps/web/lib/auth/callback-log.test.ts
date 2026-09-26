import { describe, expect, it } from "vitest";

import {
  describeCaller,
  describeShape,
  describeType,
  isBrowserNavigation,
  isSpeculativeRequest,
  mayRedeemOauthCode,
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

  it("records the Fetch Metadata, which is what a headless browser fakes", () => {
    expect(
      describeCaller(
        new Headers({
          "User-Agent": "crawler/1.0",
          "Sec-Fetch-Mode": "navigate",
          "Sec-Fetch-Dest": "document",
        }),
      ),
    ).toBe('ua="crawler/1.0" sec-fetch-mode=navigate sec-fetch-dest=document');
  });

  it("says so when there is no agent at all", () => {
    expect(describeCaller(new Headers({}))).toBe("ua=none");
    expect(describeCaller(new Headers({ "User-Agent": "   " }))).toBe(
      "ua=none",
    );
  });

  it('keeps the ua="…" framing intact when the agent contains a quote', () => {
    expect(describeCaller(new Headers({ "User-Agent": 'we"ird/1.0' }))).toBe(
      'ua="we\'ird/1.0"',
    );
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

describe("isBrowserNavigation", () => {
  it("accepts a top-level document load", () => {
    expect(
      isBrowserNavigation(
        new Headers({
          "Sec-Fetch-Mode": "navigate",
          "Sec-Fetch-Dest": "document",
        }),
      ),
    ).toBe(true);
  });

  it("refuses an iframe load, which is also mode=navigate", () => {
    expect(
      isBrowserNavigation(
        new Headers({
          "Sec-Fetch-Mode": "navigate",
          "Sec-Fetch-Dest": "iframe",
        }),
      ),
    ).toBe(false);
  });

  it("refuses a fetcher that sends no Sec-Fetch-Mode at all", () => {
    // The crawler that spent a production invite on 2026-09-26. It announces
    // nothing, which is exactly why the test is "prove you are a navigation".
    expect(
      isBrowserNavigation(
        new Headers({
          "User-Agent":
            "Mozilla/5.0 facebookexternalhit/1.1 Facebot Twitterbot/1.0",
        }),
      ),
    ).toBe(false);
    expect(isBrowserNavigation(new Headers({}))).toBe(false);
  });

  it("refuses a script-initiated fetch from a page", () => {
    expect(isBrowserNavigation(new Headers({ "Sec-Fetch-Mode": "cors" }))).toBe(
      false,
    );
    expect(
      isBrowserNavigation(new Headers({ "Sec-Fetch-Mode": "no-cors" })),
    ).toBe(false);
  });

  it("ignores case", () => {
    expect(
      isBrowserNavigation(
        new Headers({
          "Sec-Fetch-Mode": "Navigate",
          "Sec-Fetch-Dest": "Document",
        }),
      ),
    ).toBe(true);
  });
});

describe("mayRedeemOauthCode", () => {
  const navigation = {
    "Sec-Fetch-Mode": "navigate",
    "Sec-Fetch-Dest": "document",
  };

  it("allows Google's redirect, which is a real navigation", () => {
    expect(mayRedeemOauthCode(new Headers(navigation))).toBe(true);
  });

  it("refuses a browser PREFETCH, which is itself a navigation", () => {
    // The case neither check catches alone: Chrome's speculation-rules and
    // omnibox prefetch send `Sec-Fetch-Mode: navigate` AND `Sec-Purpose`.
    // Delete `isSpeculativeRequest` and this is the test that fails.
    expect(
      mayRedeemOauthCode(
        new Headers({ ...navigation, "Sec-Purpose": "prefetch" }),
      ),
    ).toBe(false);
    expect(
      mayRedeemOauthCode(
        new Headers({ ...navigation, "Sec-Purpose": "prefetch;prerender" }),
      ),
    ).toBe(false);
  });

  it("refuses a fetcher that announces nothing", () => {
    expect(
      mayRedeemOauthCode(
        new Headers({
          "User-Agent":
            "Mozilla/5.0 facebookexternalhit/1.1 Facebot Twitterbot/1.0",
        }),
      ),
    ).toBe(false);
  });

  it("cannot stop a crawler that renders with a browser engine", () => {
    // The 2026-09-26 incident, and the reason emailed links moved to POST.
    // `facebookexternalhit` sends exactly these headers, so this returns true
    // for it — which is correct and is why it no longer governs a token_hash.
    expect(
      mayRedeemOauthCode(
        new Headers({
          ...navigation,
          "User-Agent":
            "Mozilla/5.0 (Macintosh) AppleWebKit/601.2.4 facebookexternalhit/1.1 Facebot Twitterbot/1.0",
        }),
      ),
    ).toBe(true);
  });
});
