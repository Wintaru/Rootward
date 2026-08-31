import { describe, expect, it } from "vitest";

import { decideProxyRedirect, resolveHomeDestination } from "./auth-redirect";

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

describe("resolveHomeDestination", () => {
  it("sends a visitor with no session to /login", () => {
    expect(
      resolveHomeDestination({
        signedIn: false,
        approved: false,
        rootPersonId: null,
      }),
    ).toBe("/login");
  });

  it("sends a signed-in but unapproved account to /onboarding", () => {
    expect(
      resolveHomeDestination({
        signedIn: true,
        approved: false,
        rootPersonId: "p1",
      }),
    ).toBe("/onboarding");
  });

  it("sends an approved account to the configured root person's tree", () => {
    expect(
      resolveHomeDestination({
        signedIn: true,
        approved: true,
        rootPersonId: "11111111-1111-1111-1111-111111111111",
      }),
    ).toBe("/tree/11111111-1111-1111-1111-111111111111");
  });

  it("falls back to /tree for an approved account before any tree exists", () => {
    expect(
      resolveHomeDestination({
        signedIn: true,
        approved: true,
        rootPersonId: null,
      }),
    ).toBe("/tree");
  });
});
