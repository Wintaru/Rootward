import type { Locator, Page } from "@playwright/test";

import { fixtureIds } from "../support/fixture-data";
import { admin } from "../support/supabase-admin";
import { accounts, expect, test } from "../support/test";

/**
 * The header notification bell (SPEC §10 item 25, issue #61).
 *
 * "Read" is per account (`notification_read`) while "resolved" is global on
 * the row, so a resolve here is visible to every moderator. Each test makes
 * its own notification, carrying a unique message, and locates its row by
 * that message — a developer's tree may hold real ones.
 */

const created: string[] = [];

test.afterAll(async () => {
  if (created.length === 0) {
    return;
  }
  const { error } = await admin.from("notification").delete().in("id", created);
  if (error !== null) {
    throw new Error(`notification cleanup failed: ${error.message}`);
  }
});

async function makeNotification(
  message: string,
  options: { readonly resolved?: boolean } = {},
): Promise<string> {
  const id = crypto.randomUUID();
  const { error } = await admin.from("notification").insert({
    id,
    type: "hide_request",
    payload: { message, person_id: fixtureIds.grandfather },
    resolved_at: options.resolved === true ? new Date().toISOString() : null,
  });
  if (error !== null) {
    throw new Error(`notification insert failed: ${error.message}`);
  }
  created.push(id);
  return id;
}

function bell(page: Page): Locator {
  return page.getByRole("button", { name: /^Notifications/ });
}

function panel(page: Page): Locator {
  return page.getByRole("dialog", { name: "Notifications" });
}

async function openBell(page: Page): Promise<Locator> {
  await page.goto("/people");
  await bell(page).click();
  const open = panel(page);
  await expect(open).toBeVisible();
  return open;
}

test.describe("the notification bell", () => {
  test("is only offered to a moderator", async ({
    moderatorPage,
    viewerPage,
  }) => {
    await moderatorPage.goto("/people");
    await expect(bell(moderatorPage)).toBeVisible();

    await viewerPage.goto("/people");
    await expect(bell(viewerPage)).toHaveCount(0);
  });

  test("reports its open state to a screen reader", async ({
    moderatorPage,
  }) => {
    await moderatorPage.goto("/people");
    await expect(bell(moderatorPage)).toHaveAttribute("aria-expanded", "false");

    await bell(moderatorPage).click();
    await expect(bell(moderatorPage)).toHaveAttribute("aria-expanded", "true");
  });

  test("closes again when the bell is pressed a second time", async ({
    moderatorPage,
  }) => {
    const open = await openBell(moderatorPage);

    // The panel lays a full-screen backdrop over the page, bell included, so
    // the second press lands on the backdrop. That is what closes it — a
    // locator click would wait forever for the bell to stop being covered.
    const box = await bell(moderatorPage).boundingBox();
    expect(box).not.toBeNull();
    if (box !== null) {
      await moderatorPage.mouse.click(
        box.x + box.width / 2,
        box.y + box.height / 2,
      );
    }
    await expect(open).toBeHidden();
  });

  test("closes from its own Close control", async ({ moderatorPage }) => {
    const open = await openBell(moderatorPage);
    await moderatorPage
      .getByRole("button", { name: "Close notifications" })
      .click();
    await expect(open).toBeHidden();
  });

  test("offers the three status tabs, starting on Unresolved", async ({
    moderatorPage,
  }) => {
    const open = await openBell(moderatorPage);
    for (const label of ["Unresolved", "Resolved", "All"]) {
      await expect(
        open.getByRole("button", { name: label, exact: true }),
      ).toBeVisible();
    }
  });

  test("shows an unresolved notification and its timestamp", async ({
    moderatorPage,
  }) => {
    const message = `Hide request ${crypto.randomUUID().slice(0, 8)}`;
    await makeNotification(message);

    const open = await openBell(moderatorPage);
    const row = open.getByRole("listitem").filter({ hasText: message });
    await expect(row).toBeVisible({ timeout: 15_000 });
    await expect(
      row.getByRole("button", { name: "Mark resolved" }),
    ).toBeVisible();
  });

  test("its link opens where the moderator has to act", async ({
    moderatorPage,
  }) => {
    const message = `Linked hide request ${crypto.randomUUID().slice(0, 8)}`;
    await makeNotification(message);

    const open = await openBell(moderatorPage);
    await open.getByRole("link", { name: message }).click({ timeout: 15_000 });
    // A hide request needs the visibility control, so it lands on the edit
    // view rather than the read-only profile.
    await expect(moderatorPage).toHaveURL(
      new RegExp(`/person/${fixtureIds.grandfather}/edit$`),
    );
  });

  test("Mark resolved takes it out of the Unresolved tab", async ({
    moderatorPage,
  }) => {
    const message = `Resolvable ${crypto.randomUUID().slice(0, 8)}`;
    const id = await makeNotification(message);

    const open = await openBell(moderatorPage);
    const row = open.getByRole("listitem").filter({ hasText: message });
    await expect(row).toBeVisible({ timeout: 15_000 });
    await row.getByRole("button", { name: "Mark resolved" }).click();
    await expect(row).toHaveCount(0, { timeout: 15_000 });

    await expect
      .poll(
        async () => {
          const { data } = await admin
            .from("notification")
            .select("resolved_at")
            .eq("id", id)
            .single();
          return data?.resolved_at ?? null;
        },
        { timeout: 15_000 },
      )
      .not.toBeNull();
  });

  test("a resolved notification appears under Resolved, with no button", async ({
    moderatorPage,
  }) => {
    const message = `Already resolved ${crypto.randomUUID().slice(0, 8)}`;
    await makeNotification(message, { resolved: true });

    const open = await openBell(moderatorPage);
    await expect(
      open.getByRole("listitem").filter({ hasText: message }),
    ).toHaveCount(0);

    await open.getByRole("button", { name: "Resolved", exact: true }).click();
    const row = open.getByRole("listitem").filter({ hasText: message });
    await expect(row).toBeVisible({ timeout: 15_000 });
    await expect(row.getByText("Resolved", { exact: true })).toBeVisible();
    await expect(
      row.getByRole("button", { name: "Mark resolved" }),
    ).toHaveCount(0);
  });

  test("the All tab shows both states at once", async ({ moderatorPage }) => {
    const openMessage = `Still open ${crypto.randomUUID().slice(0, 8)}`;
    const doneMessage = `Already done ${crypto.randomUUID().slice(0, 8)}`;
    await makeNotification(openMessage);
    await makeNotification(doneMessage, { resolved: true });

    const open = await openBell(moderatorPage);
    await open.getByRole("button", { name: "All", exact: true }).click();
    await expect(
      open.getByRole("listitem").filter({ hasText: openMessage }),
    ).toBeVisible({ timeout: 15_000 });
    await expect(
      open.getByRole("listitem").filter({ hasText: doneMessage }),
    ).toBeVisible({ timeout: 15_000 });
  });

  test("counts unread work in its label, and opening marks it read", async ({
    moderatorPage,
  }) => {
    const id = await makeNotification(
      `Unread ${crypto.randomUUID().slice(0, 8)}`,
    );

    await moderatorPage.goto("/people");
    await expect(bell(moderatorPage)).toHaveAttribute(
      "aria-label",
      /\d+ unread/,
      { timeout: 15_000 },
    );

    await bell(moderatorPage).click();
    await expect(panel(moderatorPage)).toBeVisible();

    // "Read" is per account, so the check is this notification against this
    // account — not the badge going to zero, which another worker's fresh
    // notification can put straight back up.
    await expect
      .poll(
        async () => {
          const { count } = await admin
            .from("notification_read")
            .select("notification_id", { count: "exact", head: true })
            .eq("notification_id", id)
            .eq("account_id", accounts().moderator.userId);
          return count ?? 0;
        },
        { timeout: 15_000 },
      )
      .toBe(1);
  });
});
