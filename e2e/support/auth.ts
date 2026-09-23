import { expect, type Page } from "@playwright/test";

import { mailboxMark, waitForAuthLink } from "./mailpit";

/**
 * Sign a browser context in the way the product actually works: request a
 * magic link at `/login`, then follow the link GoTrue mails to Mailpit
 * (SPEC §9.1, decision 11 — magic link and Google, no passwords).
 *
 * The link is followed in the same `page` that asked for it, which is what a
 * real person does. It no longer has to be: the magic-link template mails a
 * `token_hash` the server redeems (SPEC §9.1), so the link works in any
 * browser. `auth.spec.ts` owns that guarantee.
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

/** The header's account chip (#79): its menu holds "My record" and "Sign out". */
export function accountMenuTrigger(page: Page) {
  return page.getByRole("button", { name: /^Account menu for / });
}

/** Open the account chip's menu and return the "Sign out" item. */
export async function openSignOut(page: Page) {
  await accountMenuTrigger(page).click();
  return page.getByRole("menuitem", { name: "Sign out" });
}

/** Sign out through the account menu and confirm we land back on `/login`. */
export async function signOut(page: Page): Promise<void> {
  await (await openSignOut(page)).click();
  await page.waitForURL(/\/login$/);
}
