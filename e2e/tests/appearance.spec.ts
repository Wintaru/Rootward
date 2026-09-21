import type { Page } from "@playwright/test";

import { signInWithMagicLink, signOut } from "../support/auth";
import {
  deleteTestUser,
  ensureTestUser,
  setAccountState,
} from "../support/supabase-admin";
import { accounts, expect, test } from "../support/test";

/**
 * Settings › Appearance (SPEC §8.1, decision 38, issue #80): the per-member
 * theme + mode picker. A pick applies at once, survives a hard reload (it
 * is on the account), never changes another member's view, and follows the
 * member to `/login` on that device through the cookie mirror.
 */

/** What `<html>` carries — the whole theme contract in three values. */
async function htmlTheme(page: Page) {
  return page.evaluate(() => {
    const html = document.documentElement;
    return {
      theme: html.getAttribute("data-theme"),
      mode: html.getAttribute("data-mode"),
      dark: html.classList.contains("dark"),
    };
  });
}

function themeCard(page: Page, label: string) {
  return page
    .getByRole("radiogroup", { name: "Theme" })
    .getByRole("radio", { name: new RegExp(`^${label}`) });
}

function modeOption(page: Page, label: string) {
  return page
    .getByRole("radiogroup", { name: "Mode" })
    .getByRole("radio", { name: label, exact: true });
}

// Every test picks for the one viewer account, so they cannot overlap.
test.describe.configure({ mode: "serial" });

test.describe("appearance", () => {
  // Every test picks for the viewer; put the row back so the other specs (and
  // the next run of this one) start from the defaults whatever happened.
  test.afterEach(async () => {
    await setAccountState(accounts().viewer.userId, {
      theme: "flexoki",
      color_mode: "system",
    });
  });

  test("a pick applies at once and survives a reload, and only for that member", async ({
    viewerPage,
    adminPage,
  }) => {
    await viewerPage.goto("/settings");
    await expect(themeCard(viewerPage, "Flexoki")).toHaveAttribute(
      "aria-checked",
      "true",
    );

    await themeCard(viewerPage, "Gruvbox").click();
    expect((await htmlTheme(viewerPage)).theme).toBe("gruvbox");
    await expect(viewerPage.getByRole("status")).toHaveText("");

    await viewerPage.reload();
    expect((await htmlTheme(viewerPage)).theme).toBe("gruvbox");
    await expect(themeCard(viewerPage, "Gruvbox")).toHaveAttribute(
      "aria-checked",
      "true",
    );

    // The admin, in their own context, is untouched.
    await adminPage.goto("/people");
    expect((await htmlTheme(adminPage)).theme).toBe("flexoki");
  });

  test("the mode control works from the keyboard and pins a side", async ({
    viewerPage,
  }) => {
    await viewerPage.goto("/settings");
    await modeOption(viewerPage, "System").focus();
    await viewerPage.keyboard.press("ArrowRight");
    await expect(modeOption(viewerPage, "Light")).toBeFocused();
    await viewerPage.keyboard.press("ArrowRight");
    await expect(modeOption(viewerPage, "Dark")).toBeFocused();
    await expect(modeOption(viewerPage, "Dark")).toHaveAttribute(
      "aria-checked",
      "true",
    );
    expect(await htmlTheme(viewerPage)).toMatchObject({
      mode: "dark",
      dark: true,
    });
    await expect(viewerPage.getByRole("status")).toHaveText("");

    await viewerPage.reload();
    expect(await htmlTheme(viewerPage)).toMatchObject({
      mode: "dark",
      dark: true,
    });
  });

  // The save's cookie write re-renders the route; the class must survive
  // that on a dark-scheme device going Dark → System.
  test("Dark → System keeps .dark on a dark-scheme device across the save", async ({
    viewerPage,
  }) => {
    await viewerPage.emulateMedia({ colorScheme: "dark" });
    await viewerPage.goto("/settings");
    await modeOption(viewerPage, "Dark").click();
    await expect(viewerPage.getByRole("status")).toHaveText("");
    await viewerPage.reload();
    expect(await htmlTheme(viewerPage)).toMatchObject({
      mode: "dark",
      dark: true,
    });

    await modeOption(viewerPage, "System").click();
    await expect(viewerPage.getByRole("status")).toHaveText("");
    // Give the route re-render time to land, then check the class is intact.
    await expect
      .poll(async () => (await htmlTheme(viewerPage)).mode)
      .toBe("system");
    await viewerPage.waitForTimeout(500);
    expect(await htmlTheme(viewerPage)).toMatchObject({
      mode: "system",
      dark: true,
    });
  });

  test("the theme cards move with the arrow keys", async ({ viewerPage }) => {
    await viewerPage.goto("/settings");
    await themeCard(viewerPage, "Flexoki").focus();
    await viewerPage.keyboard.press("ArrowRight");
    await expect(themeCard(viewerPage, "Rosé Pine")).toBeFocused();
    await expect(themeCard(viewerPage, "Rosé Pine")).toHaveAttribute(
      "aria-checked",
      "true",
    );
    expect((await htmlTheme(viewerPage)).theme).toBe("rosepine");
    await viewerPage.keyboard.press("End");
    await expect(themeCard(viewerPage, "Kodachrome")).toBeFocused();
    expect((await htmlTheme(viewerPage)).theme).toBe("kodachrome");
  });

  // A throwaway account: a real sign-out revokes the session, and the shared
  // viewer session is what every other spec restores its context from.
  test("sign out keeps the last member's theme on /login, and sign-in restores it", async ({
    anonPage,
  }) => {
    const email = "e2e-appearance@rootward.test";
    await ensureTestUser({
      email,
      role: "viewer",
      status: "active",
      displayName: "E2E Appearance",
    });
    try {
      await signInWithMagicLink(anonPage, email);
      await anonPage.goto("/settings");
      await themeCard(anonPage, "Hearth").click();
      await modeOption(anonPage, "Dark").click();
      await expect(anonPage.getByRole("status")).toHaveText("");

      await signOut(anonPage);
      expect(await htmlTheme(anonPage)).toEqual({
        theme: "hearth",
        mode: "dark",
        dark: true,
      });

      // Another member's pick on this device would overwrite the cookies;
      // signing back in must mirror the account again.
      await anonPage.context().clearCookies();
      await anonPage.goto("/login");
      expect((await htmlTheme(anonPage)).theme).toBe("flexoki");
      await signInWithMagicLink(anonPage, email);
      expect(await htmlTheme(anonPage)).toEqual({
        theme: "hearth",
        mode: "dark",
        dark: true,
      });
      await signOut(anonPage);
      expect((await htmlTheme(anonPage)).theme).toBe("hearth");
    } finally {
      await deleteTestUser(email);
    }
  });

  test("Appearance is in the account menu for a viewer", async ({
    viewerPage,
  }) => {
    await viewerPage.goto("/people");
    await viewerPage
      .getByRole("button", { name: /^Account menu for / })
      .click();
    await viewerPage.getByRole("menuitem", { name: "Appearance" }).click();
    await expect(viewerPage).toHaveURL(/\/settings$/);
    await expect(
      viewerPage.getByRole("heading", { level: 1, name: "Appearance" }),
    ).toBeVisible();
  });
});
