import { expect, type Page } from "@playwright/test";

import { mailboxMark, waitForAuthLink } from "./mailpit";

/**
 * Sign a browser context in the way the product actually works: request a
 * magic link at `/login`, then follow the link GoTrue mails to Mailpit
 * (SPEC §9.1, decision 11 — magic link and Google, no passwords).
 *
 * The browser client uses the PKCE flow, so the code verifier lives in this
 * context's own storage. The link therefore has to be followed in the same
 * `page` that asked for it — which is also what a real person does.
 */
export async function signInWithMagicLink(
  page: Page,
  email: string,
): Promise<void> {
  // One mailbox serves every address, so an old link for this same address
  // (a previous run, or an earlier step in this one) would otherwise be
  // picked up instead of the fresh one. Mark the moment rather than clearing
  // the box, which would delete mail other tests are waiting on.
  const since = mailboxMark();

  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: /email me a sign-in link/i }).click();
  await expect(page.getByText("Check your email")).toBeVisible();

  await page.goto(await waitForAuthLink(email, since));

  // `/auth/callback` exchanges the code and redirects to `/`, which routes on
  // to the tree or onboarding. Waiting for "not on /login or the error page"
  // keeps this helper agnostic about which.
  await page.waitForURL(
    (url) =>
      !url.pathname.startsWith("/login") && !url.pathname.startsWith("/auth/"),
    { timeout: 30_000 },
  );
}

/** Sign out through the header control and confirm we land back on `/login`. */
export async function signOut(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Sign out" }).click();
  await page.waitForURL(/\/login$/);
}
