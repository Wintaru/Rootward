import { describe, expect, it } from "vitest";

import {
  decideProxyRedirect,
  needsEmailOtpForwarding,
  resolveHomeDestination,
  resolveTreeFocusPersonId,
} from "./auth-redirect";

describe("decideProxyRedirect", () => {
  it("sends an unauthenticated visitor to /login from a gated route", () => {
    expect(
      decideProxyRedirect({ hasSession: false, pathname: "/tree/abc" }),
    ).toBe("/login");
    expect(decideProxyRedirect({ hasSession: false, pathname: "/" })).toBe(
      "/login",
    );
    expect(
      decideProxyRedirect({ hasSession: false, pathname: "/import" }),
    ).toBe("/login");
  });

  it("lets an unauthenticated visitor reach /login and the /auth handlers", () => {
    expect(
      decideProxyRedirect({ hasSession: false, pathname: "/login" }),
    ).toBeNull();
    expect(
      decideProxyRedirect({ hasSession: false, pathname: "/auth/callback" }),
    ).toBeNull();
    expect(
      decideProxyRedirect({
        hasSession: false,
        pathname: "/auth/auth-code-error",
      }),
    ).toBeNull();
  });

  it("bounces a signed-in visitor off /login", () => {
    expect(decideProxyRedirect({ hasSession: true, pathname: "/login" })).toBe(
      "/",
    );
  });

  it("lets a signed-in visitor through everywhere else", () => {
    expect(
      decideProxyRedirect({ hasSession: true, pathname: "/tree/abc" }),
    ).toBeNull();
    expect(decideProxyRedirect({ hasSession: true, pathname: "/" })).toBeNull();
  });
});

describe("resolveTreeFocusPersonId", () => {
  const SELF = "22222222-2222-2222-2222-222222222222";
  const ROOT = "11111111-1111-1111-1111-111111111111";
  const FALLBACK = "33333333-3333-3333-3333-333333333333";

  it("opens the tree on the member's own record", async () => {
    // The whole point: an invited member used to land on whoever the admin
    // had set as the root, with themselves somewhere off screen.
    await expect(
      resolveTreeFocusPersonId(SELF, async () => ROOT),
    ).resolves.toBe(SELF);
  });

  it("never asks for a fallback the member does not need", async () => {
    // The read that is skipped is a `tree_settings` round trip on every visit
    // to `/`, so the laziness is the point, not an implementation detail.
    let calls = 0;
    await resolveTreeFocusPersonId(SELF, async () => {
      calls += 1;
      return ROOT;
    });
    expect(calls).toBe(0);
  });

  it("falls back in order, and stops at the first answer", async () => {
    const asked: string[] = [];
    await expect(
      resolveTreeFocusPersonId(
        null,
        async () => {
          asked.push("root");
          return ROOT;
        },
        async () => {
          asked.push("fallback");
          return FALLBACK;
        },
      ),
    ).resolves.toBe(ROOT);
    expect(asked).toEqual(["root"]);
  });

  it("walks past a fallback that comes back empty", async () => {
    await expect(
      resolveTreeFocusPersonId(
        null,
        async () => null,
        async () => FALLBACK,
      ),
    ).resolves.toBe(FALLBACK);
  });

  it("finds nobody when nothing is offered", async () => {
    await expect(resolveTreeFocusPersonId(null)).resolves.toBeNull();
    await expect(
      resolveTreeFocusPersonId(null, async () => null),
    ).resolves.toBeNull();
  });
});

describe("resolveHomeDestination", () => {
  const FOCUS = "22222222-2222-2222-2222-222222222222";

  it("sends a visitor with no session to /login", () => {
    expect(
      resolveHomeDestination({
        signedIn: false,
        approved: false,
        focusPersonId: null,
      }),
    ).toBe("/login");
  });

  it("sends a signed-in but unapproved account to /onboarding", () => {
    expect(
      resolveHomeDestination({
        signedIn: true,
        approved: false,
        focusPersonId: FOCUS,
      }),
    ).toBe("/onboarding");
  });

  it("sends an approved account to the tree it is centred on", () => {
    expect(
      resolveHomeDestination({
        signedIn: true,
        approved: true,
        focusPersonId: FOCUS,
      }),
    ).toBe(`/tree/${FOCUS}`);
  });

  it("falls back to /tree for an approved account before any tree exists", () => {
    expect(
      resolveHomeDestination({
        signedIn: true,
        approved: true,
        focusPersonId: null,
      }),
    ).toBe("/tree");
  });
});

describe("needsEmailOtpForwarding", () => {
  const params = (query: string) => new URLSearchParams(query);

  it("forwards an emailed link that landed on a gated path", () => {
    // GoTrue mails this shape when `<site>/auth/callback` is missing from the
    // project's redirect allow-list: the bare site origin, no path.
    expect(
      needsEmailOtpForwarding("/", params("token_hash=abc&type=invite")),
    ).toBe(true);
    expect(
      needsEmailOtpForwarding("/tree", params("token_hash=abc&type=magiclink")),
    ).toBe(true);
  });

  it("leaves the callback itself alone, so there is no redirect loop", () => {
    expect(
      needsEmailOtpForwarding(
        "/auth/callback",
        params("token_hash=abc&type=invite"),
      ),
    ).toBe(false);
  });

  it("ignores a request that is not an emailed sign-in link", () => {
    expect(needsEmailOtpForwarding("/", params(""))).toBe(false);
    expect(needsEmailOtpForwarding("/", params("token_hash=abc"))).toBe(false);
    expect(needsEmailOtpForwarding("/", params("type=invite"))).toBe(false);
  });

  it("ignores a type this deployment never sends", () => {
    expect(
      needsEmailOtpForwarding("/", params("token_hash=abc&type=recovery")),
    ).toBe(false);
  });
});
