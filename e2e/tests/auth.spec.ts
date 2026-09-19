import { mailboxMark, waitForAuthLink } from "../support/mailpit";
import { signInWithMagicLink, signOut } from "../support/auth";
import { deleteTestUser, ensureTestUser } from "../support/supabase-admin";
import { expect, test } from "../support/test";

/**
 * Sign-in, sign-out, and the callback's failure modes (SPEC §9.1,
 * decisions 11 and 35). These drive the real flow rather than a saved
 * session, so they are the slowest file in the suite — everything else
 * reuses `global-setup`'s storage state.
 */

test.describe("the sign-in form", () => {
  test("offers magic link and Google, and no password field", async ({
    anonPage,
  }) => {
    await anonPage.goto("/login");
    await expect(anonPage.getByLabel("Email")).toBeVisible();
    await expect(
      anonPage.getByRole("button", { name: "Email me a sign-in link" }),
    ).toBeVisible();
    await expect(
      anonPage.getByRole("button", { name: "Continue with Google" }),
    ).toBeVisible();
    await expect(anonPage.locator('input[type="password"]')).toHaveCount(0);
  });

  test("will not submit an empty email", async ({ anonPage }) => {
    await anonPage.goto("/login");
    await anonPage
      .getByRole("button", { name: "Email me a sign-in link" })
      .click();
    await expect(anonPage.getByText("Check your email")).toHaveCount(0);
  });

  test("rejects a malformed email at the field", async ({ anonPage }) => {
    await anonPage.goto("/login");
    await anonPage.getByLabel("Email").fill("not-an-email");
    await anonPage
      .getByRole("button", { name: "Email me a sign-in link" })
      .click();
    await expect(anonPage.getByText("Check your email")).toHaveCount(0);
  });

  test("confirms the link was sent", async ({ anonPage }) => {
    await anonPage.goto("/login");
    await anonPage.getByLabel("Email").fill("e2e-linkcheck@rootward.test");
    await anonPage
      .getByRole("button", { name: "Email me a sign-in link" })
      .click();
    await expect(anonPage.getByText("Check your email")).toBeVisible();
    await expect(
      anonPage.getByText("e2e-linkcheck@rootward.test"),
    ).toBeVisible();
  });

  test("sends an already-signed-in visitor away from /login", async ({
    viewerPage,
  }) => {
    await viewerPage.goto("/login");
    await expect(viewerPage).not.toHaveURL(/\/login/);
  });
});

test.describe("the sign-in round trip", () => {
  // One account per test. `ensureTestUser` deletes and recreates the auth
  // user, so two tests sharing an address would sign each other out
  // mid-flight — the recreated account starts `pending` and lands the other
  // worker on `/onboarding`.
  const roundTripEmail = "e2e-roundtrip@rootward.test";
  const replayEmail = "e2e-replay@rootward.test";

  const makeUser = (email: string) =>
    ensureTestUser({
      email,
      role: "viewer",
      status: "active",
      displayName: "E2E Round Trip",
    });

  test.afterAll(async () => {
    await deleteTestUser(roundTripEmail);
    await deleteTestUser(replayEmail);
  });

  test("signs a member in and back out", async ({ anonPage }) => {
    const email = roundTripEmail;
    await makeUser(email);
    await signInWithMagicLink(anonPage, email);
    await expect(anonPage).toHaveURL(/\/tree\//);
    await expect(
      anonPage.getByRole("button", { name: "Sign out" }),
    ).toBeVisible();

    await signOut(anonPage);
    await expect(anonPage).toHaveURL(/\/login$/);

    // The session must really be gone, not just navigated away from.
    await anonPage.goto("/tree");
    await expect(anonPage).toHaveURL(/\/login(\?|$)/);
  });

  test("refuses a magic link that was already used", async ({ anonPage }) => {
    const email = replayEmail;
    await makeUser(email);
    const since = mailboxMark();
    await anonPage.goto("/login");
    await anonPage.getByLabel("Email").fill(email);
    await anonPage
      .getByRole("button", { name: "Email me a sign-in link" })
      .click();
    await expect(anonPage.getByText("Check your email")).toBeVisible();

    const link = await waitForAuthLink(email, since);
    await anonPage.goto(link);
    await expect(anonPage).not.toHaveURL(/\/login/);
    await signOut(anonPage);

    // Second use of a one-time token must not produce a session.
    await anonPage.goto(link);
    await anonPage.goto("/tree");
    await expect(anonPage).toHaveURL(/\/login(\?|$)/);
  });
});

test.describe("the auth callback", () => {
  test("sends a missing code to the error page", async ({ anonPage }) => {
    await anonPage.goto("/auth/callback");
    await expect(anonPage).toHaveURL(/\/auth\/auth-code-error$/);
  });

  test("sends a bogus code to the error page", async ({ anonPage }) => {
    await anonPage.goto("/auth/callback?code=not-a-real-code");
    await expect(anonPage).toHaveURL(/\/auth\/auth-code-error$/);
    await expect(
      anonPage.getByRole("heading", { name: /did not work/i }),
    ).toBeVisible();
  });

  test("refuses to bounce to an external site through ?next=", async ({
    anonPage,
  }) => {
    // An open redirect here would be handed a valid session on the way out.
    // Assert we stayed on the app's own origin, not merely that we avoided
    // one particular attacker host.
    await anonPage.goto(
      "/auth/callback?code=x&next=https://example.com/phishing",
    );
    const landed = new URL(anonPage.url());
    const app = new URL(test.info().project.use.baseURL ?? "");
    expect(landed.origin).toBe(app.origin);
  });
});

/**
 * BUG-001 regression. `/auth/callback` builds its redirect from
 * `new URL(request.url).origin`, which is the origin the dev server bound
 * (`localhost`), not the origin the visitor typed. Signing in at
 * `127.0.0.1:3000` — the address README, `pnpm dev:status`, and Supabase's
 * own `site_url` all name — therefore lands the visitor on `localhost:3000`,
 * where the session cookie just written for `127.0.0.1` does not apply, so
 * they bounce straight back to `/login` and can never get in.
 *
 * The rest of the suite drives `localhost` to work around it. This test
 * drives `127.0.0.1` on purpose, so the workaround cannot quietly become
 * permanent.
 */
test.describe("sign-in at the documented 127.0.0.1 address", () => {
  const email = "e2e-loopback@rootward.test";

  test.beforeEach(async () => {
    await ensureTestUser({
      email,
      role: "viewer",
      status: "active",
      displayName: "E2E Loopback",
    });
  });

  test.afterAll(async () => {
    await deleteTestUser(email);
  });

  test("keeps the visitor on the origin they signed in from", async ({
    browser,
  }) => {
    const context = await browser.newContext({
      baseURL: "http://127.0.0.1:3000",
    });
    const page = await context.newPage();
    try {
      const since = mailboxMark();
      await page.goto("/login");
      await page.getByLabel("Email").fill(email);
      await page
        .getByRole("button", { name: "Email me a sign-in link" })
        .click();
      await expect(page.getByText("Check your email")).toBeVisible();

      await page.goto(await waitForAuthLink(email, since));
      await page.waitForLoadState("load");

      expect(
        new URL(page.url()).hostname,
        "the callback must not move the visitor to another origin — the " +
          "session cookie does not travel with them",
      ).toBe("127.0.0.1");
      await expect(page).not.toHaveURL(/\/login/);
    } finally {
      await context.close();
    }
  });
});
