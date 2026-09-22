import { FIXTURE_SURNAME, fixtureNames } from "../support/fixture-data";
import { expect, test } from "../support/test";

/**
 * The shortest path through every access level. If this file fails, the
 * harness — sign-in, fixture data, role sessions — is broken, and every
 * other failure in the run is a consequence rather than a finding.
 */
test.describe("smoke", () => {
  test("an anonymous visitor lands on the sign-in page", async ({
    anonPage,
  }) => {
    await anonPage.goto("/");
    await expect(anonPage).toHaveURL(/\/login$/);
    await expect(
      anonPage.getByRole("heading", { name: "Rootward" }),
    ).toBeVisible();
  });

  test("an admin reaches the tree", async ({ adminPage }) => {
    await adminPage.goto("/");
    await expect(adminPage).toHaveURL(/\/tree\//);
  });

  test("a moderator reaches the tree", async ({ moderatorPage }) => {
    await moderatorPage.goto("/");
    await expect(moderatorPage).toHaveURL(/\/tree\//);
  });

  test("a viewer reaches the tree", async ({ viewerPage }) => {
    await viewerPage.goto("/");
    await expect(viewerPage).toHaveURL(/\/tree\//);
  });

  test("a pending member is routed to onboarding", async ({ pendingPage }) => {
    await pendingPage.goto("/");
    await expect(pendingPage).toHaveURL(/\/onboarding$/);
  });

  test("the fixture family is readable through the app", async ({
    adminPage,
  }) => {
    await adminPage.goto(`/people?q=${FIXTURE_SURNAME}`);
    await expect(
      adminPage.getByRole("link", { name: fixtureNames.grandfather }),
    ).toBeVisible();
  });

  // The security headers live in `next.config.ts` (#132) and never fail a
  // typecheck or a unit test, so a refactor that drops one is caught here.
  test("every response carries the security headers", async ({ anonPage }) => {
    const response = await anonPage.goto("/login");
    expect(response).not.toBeNull();
    const headers = response?.headers() ?? {};
    expect(headers["strict-transport-security"]).toContain("max-age=");
    expect(headers["content-security-policy"]).toContain(
      "frame-ancestors 'none'",
    );
    expect(headers["x-frame-options"]).toBe("DENY");
    expect(headers["x-content-type-options"]).toBe("nosniff");
    expect(headers["referrer-policy"]).toBe("strict-origin-when-cross-origin");
    expect(headers["permissions-policy"]).toContain("camera=()");
  });
});
