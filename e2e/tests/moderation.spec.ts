import { accountMenuTrigger } from "../support/auth";
import { fixtureIds } from "../support/fixture-data";
import {
  mailboxMark,
  waitForAuthLink,
  waitForMessage,
} from "../support/mailpit";
import {
  admin,
  deleteTestUser,
  ensureTestUser,
  findUserIdByEmail,
} from "../support/supabase-admin";
import { alerts, expect, test } from "../support/test";

/**
 * `/moderation` — the queue (SPEC §8.1, §9.2, §10 item 36): access requests,
 * linked accounts, the invite-to-claim form, and open invitations.
 *
 * Approve / reject and reassign / unlink are admin-only within the page
 * (`access.isAdmin`), so a moderator sees the queue but not its controls —
 * that split is checked here rather than in `access-control.spec.ts`, which
 * only covers whether the route opens at all.
 */

test.describe("the moderation queue", () => {
  test("shows all four panels to a moderator", async ({ moderatorPage }) => {
    await moderatorPage.goto("/moderation");
    for (const heading of [
      "Access requests",
      "Linked accounts",
      "Invite someone to claim a person",
      "Pending invitations",
    ]) {
      await expect(
        moderatorPage.getByRole("heading", { name: heading }),
      ).toBeVisible();
    }
  });

  test("lists the claimed fixture account", async ({ moderatorPage }) => {
    await moderatorPage.goto("/moderation");
    await expect(moderatorPage.getByText("E2E Viewer")).toBeVisible();
  });

  test("a moderator cannot grant a role above viewer", async ({
    moderatorPage,
  }) => {
    await moderatorPage.goto("/moderation");
    await expect(moderatorPage.getByLabel("Role")).toHaveCount(0);
  });

  test("an admin can grant a role on the invitation", async ({ adminPage }) => {
    await adminPage.goto("/moderation");
    const role = adminPage.getByLabel("Role");
    await expect(role).toBeVisible();
    await expect(role.getByRole("option")).toHaveText([
      "Viewer",
      "Moderator",
      "Admin",
    ]);
  });
});

test.describe("invite to claim", () => {
  // The invitation list is shared state, and the cleanup below deletes by
  // address prefix, so these run one at a time rather than racing each
  // other's rows away mid-assertion.
  test.describe.configure({ mode: "serial" });

  // One address per test, so a failed cleanup cannot make the next test pass
  // or fail on the previous one's row.
  const email = "e2e-invitee@rootward.test";

  // A sent invitation creates an `auth.users` row, and an accepted one claims
  // the target person. Both have to go at the end of the test, or the next
  // test finds `loner` already claimed.
  const invited = new Set<string>();
  const addressFor = (slug: string) => {
    const address = `e2e-invitee-${slug}@rootward.test`;
    invited.add(address);
    return address;
  };

  test.afterEach(async () => {
    await admin.from("invitation").delete().like("email", "e2e-invitee%");
    // Deleting the auth user cascades its `account` row, which releases the
    // claim on the person. `allSettled`, so one address that will not delete
    // does not abandon the rest and report the failure against the next test.
    const swept = await Promise.allSettled([...invited].map(deleteTestUser));
    invited.clear();
    const failed = swept.filter((result) => result.status === "rejected");
    expect(failed, `invitee cleanup failed: ${JSON.stringify(failed)}`).toEqual(
      [],
    );
  });

  test("refuses an empty email", async ({ moderatorPage }) => {
    await moderatorPage.goto("/moderation");
    await moderatorPage.getByLabel("Person ID").fill(fixtureIds.loner);
    await moderatorPage
      .getByRole("button", { name: "Send invitation" })
      .click();
    await expect(alerts(moderatorPage).first()).toBeVisible();
  });

  test("refuses a person id that is not a uuid", async ({ moderatorPage }) => {
    await moderatorPage.goto("/moderation");
    await moderatorPage.getByLabel("Email address").fill(email);
    await moderatorPage.getByLabel("Person ID").fill("nonsense");
    await moderatorPage
      .getByRole("button", { name: "Send invitation" })
      .click();
    await expect(alerts(moderatorPage).first()).toBeVisible();
  });

  test("refuses a person that does not exist", async ({ moderatorPage }) => {
    await moderatorPage.goto("/moderation");
    await moderatorPage.getByLabel("Email address").fill(email);
    await moderatorPage
      .getByLabel("Person ID")
      .fill("00000000-0000-4000-8000-00000000dead");
    await moderatorPage
      .getByRole("button", { name: "Send invitation" })
      .click();
    await expect(alerts(moderatorPage).first()).toBeVisible();
  });

  test("sends an invitation and lists it as open", async ({
    moderatorPage,
  }) => {
    const address = addressFor("listed");
    const since = mailboxMark();
    await moderatorPage.goto("/moderation");
    await moderatorPage.getByLabel("Email address").fill(address);
    await moderatorPage.getByLabel("Person ID").fill(fixtureIds.loner);
    await moderatorPage
      .getByRole("button", { name: "Send invitation" })
      .click();

    await expect(
      moderatorPage.getByText(new RegExp(`Invitation sent to ${address}`)),
    ).toBeVisible();

    // The invitation really reached the mail sink, not just the UI.
    const message = await waitForMessage(address, { since });
    expect(message.Text.length).toBeGreaterThan(0);

    await moderatorPage.reload();
    await expect(moderatorPage.getByText(address)).toBeVisible();
  });

  test("an invitee can follow the emailed link and land signed in", async ({
    moderatorPage,
    anonPage,
  }) => {
    const address = addressFor("accepts");
    const since = mailboxMark();
    await moderatorPage.goto("/moderation");
    await moderatorPage.getByLabel("Email address").fill(address);
    await moderatorPage.getByLabel("Person ID").fill(fixtureIds.loner);
    await moderatorPage
      .getByRole("button", { name: "Send invitation" })
      .click();
    await expect(moderatorPage.getByText(/Invitation sent/)).toBeVisible();

    // Regression: an invite is sent with the service role, so no browser holds
    // a PKCE verifier for it. GoTrue's default template therefore returned the
    // session in the URL fragment, which a server route cannot read, and every
    // invitee landed on the error page holding a session they could not use.
    await anonPage.goto(await waitForAuthLink(address, since));
    await expect(anonPage).not.toHaveURL(/\/auth\/auth-code-error/);

    // The session is real, not just a navigation that avoided the error page:
    // a gated route opens, and the account chip needs a signed-in header.
    await anonPage.goto("/tree");
    await expect(anonPage).toHaveURL(/\/tree/);
    await expect(accountMenuTrigger(anonPage)).toBeVisible();

    // And §9.2 actually ran: accepting the invitation claims the person it
    // named. `maybeAcceptInvitation` failures are swallowed in the callback so
    // a broken link never blocks sign-in, which means only this can catch one.
    const userId = await findUserIdByEmail(address);
    expect(userId).not.toBeNull();
    const { data: account } = await admin
      .from("account")
      .select("person_id, role, status")
      .eq("id", userId ?? "")
      .single();
    expect(account).toMatchObject({
      person_id: fixtureIds.loner,
      role: "viewer",
      status: "active",
    });
  });

  test("a refused re-send leaves the earlier invitation in place", async ({
    moderatorPage,
  }) => {
    // Josh's exact state on 2026-09-26: the first link was clicked, so GoTrue
    // holds a registered account for the address, and the original invitation
    // is still open because the app never managed to accept it.
    const address = addressFor("resend");
    await ensureTestUser({
      email: address,
      role: "viewer",
      status: "pending",
      displayName: "E2E Resend",
    });
    const { data: original, error: seedError } = await admin
      .from("invitation")
      .insert({ email: address, person_id: fixtureIds.loner, role: "viewer" })
      .select("id")
      .single();
    expect(seedError).toBeNull();
    expect(original).not.toBeNull();
    const originalId = original?.id ?? "";

    // The moderator re-sends. GoTrue refuses an address it already holds.
    await moderatorPage.goto("/moderation");
    await moderatorPage.getByLabel("Email address").fill(address);
    await moderatorPage.getByLabel("Person ID").fill(fixtureIds.loner);
    await moderatorPage
      .getByRole("button", { name: "Send invitation" })
      .click();
    await expect(alerts(moderatorPage).first()).toBeVisible();

    // The rollback must remove only the row this attempt wrote. Deleting by
    // (email, person) took the still-good original down with it, so an
    // ordinary mistake silently revoked a working invitation.
    const { data: survivor, error: survivorError } = await admin
      .from("invitation")
      .select("id, status")
      .eq("id", originalId)
      .maybeSingle();
    expect(survivorError).toBeNull();
    expect(survivor).toMatchObject({ id: originalId, status: "pending" });

    // And exactly one row is left — the rollback did its own job too.
    const { data: remaining, error: remainingError } = await admin
      .from("invitation")
      .select("id")
      .eq("email", address);
    expect(remainingError).toBeNull();
    expect(remaining).toHaveLength(1);
  });

  test("clears the form after a successful send", async ({ moderatorPage }) => {
    await moderatorPage.goto("/moderation");
    await moderatorPage.getByLabel("Email address").fill(addressFor("cleared"));
    await moderatorPage.getByLabel("Person ID").fill(fixtureIds.loner);
    await moderatorPage
      .getByRole("button", { name: "Send invitation" })
      .click();
    await expect(moderatorPage.getByText(/Invitation sent/)).toBeVisible();
    await expect(moderatorPage.getByLabel("Email address")).toHaveValue("");
    await expect(moderatorPage.getByLabel("Person ID")).toHaveValue("");
  });
});

test.describe("the notification bell", () => {
  // The two hide-request tests below share one fixture person and one
  // `beforeEach` that clears its open requests, so running them at once lets
  // one delete the notification the other is counting. `request_hide` dedupes
  // against an unresolved row, which is the behaviour being checked.
  test.describe.configure({ mode: "serial" });

  test("opens and closes", async ({ moderatorPage }) => {
    await moderatorPage.goto("/moderation");
    await moderatorPage.getByRole("button", { name: /^Notifications/ }).click();
    const panel = moderatorPage.getByRole("dialog", { name: "Notifications" });
    await expect(panel).toBeVisible();

    await moderatorPage
      .getByRole("button", { name: "Close notifications" })
      .click();
    await expect(panel).toHaveCount(0);
  });

  test("offers the status tabs", async ({ moderatorPage }) => {
    await moderatorPage.goto("/moderation");
    await moderatorPage.getByRole("button", { name: /^Notifications/ }).click();
    const panel = moderatorPage.getByRole("dialog", { name: "Notifications" });
    await expect(
      panel.getByRole("button", { name: "Unresolved" }),
    ).toBeVisible();
    await expect(
      panel.getByRole("button", { name: "Resolved", exact: true }),
    ).toBeVisible();
    await expect(panel.getByRole("button", { name: "All" })).toBeVisible();
  });

  /**
   * `request_hide` dedupes against an unresolved notification for the same
   * person, so the queue is cleared of open requests for this record first —
   * otherwise a second run silently asserts against the first run's row.
   * The fixture child is used rather than the viewer's own record so this
   * cannot race `person-profile.spec.ts`, which drives the same control.
   */
  test.beforeEach(async () => {
    await admin
      .from("notification")
      .delete()
      .eq("type", "hide_request")
      .contains("payload", { person_id: fixtureIds.child });
  });

  test("shows the hide request a viewer raised", async ({
    moderatorPage,
    viewerPage,
  }) => {
    const reason = `e2e hide request ${Date.now()}`;
    await viewerPage.goto(`/person/${fixtureIds.child}`);
    await viewerPage
      .getByRole("button", { name: "Ask a moderator to hide this record" })
      .click();
    await viewerPage.getByLabel(/Ask a moderator to hide/).fill(reason);
    await viewerPage.getByRole("button", { name: "Send request" }).click();
    await expect(viewerPage.getByText(/Request sent/)).toBeVisible();

    await moderatorPage.goto("/moderation");
    await moderatorPage.getByRole("button", { name: /^Notifications/ }).click();
    const panel = moderatorPage.getByRole("dialog", { name: "Notifications" });
    const entry = panel.getByText(reason).first();
    await expect(entry).toBeVisible();

    // The queue line carries the free-text reason; the link is what names the
    // person, so follow it rather than assume the name is in the text.
    await entry.click();
    await expect(moderatorPage).toHaveURL(
      new RegExp(`/person/${fixtureIds.child}`),
    );
  });

  test("does not queue a second request while the first is open", async ({
    viewerPage,
  }) => {
    const send = async (reason: string) => {
      await viewerPage.goto(`/person/${fixtureIds.child}`);
      await viewerPage
        .getByRole("button", { name: "Ask a moderator to hide this record" })
        .click();
      await viewerPage.getByLabel(/Ask a moderator to hide/).fill(reason);
      await viewerPage.getByRole("button", { name: "Send request" }).click();
      await expect(viewerPage.getByText(/Request sent/)).toBeVisible();
    };

    await send("first e2e request");
    await send("second e2e request");

    const { count } = await admin
      .from("notification")
      .select("id", { count: "exact", head: true })
      .eq("type", "hide_request")
      .contains("payload", { person_id: fixtureIds.child });
    expect(count).toBe(1);
  });
});
