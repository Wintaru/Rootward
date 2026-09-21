import {
  fixtureIds,
  fixtureMediaId,
  fixtureNames,
} from "../support/fixture-data";
import { accountMenuTrigger, openSignOut } from "../support/auth";
import { expect, test } from "../support/test";

/**
 * Route-level access (SPEC §8.1's Access column, §9.4). Every gated route is
 * checked from every access level, including the levels that should be turned
 * away — a route that only ever gets tested by the role it is built for is a
 * route whose gate is untested.
 *
 * These assert the *screen*, not the database. RLS is the real boundary and
 * has its own file (`rls-visibility.spec.ts`).
 */

const MODERATOR_ROUTES = [
  { path: "/import", heading: "Import / Export" },
  { path: "/moderation", heading: "Moderation" },
  { path: "/person/new", heading: "New person" },
];

test.describe("anonymous visitors", () => {
  const guarded = [
    "/",
    "/tree",
    `/tree/${fixtureIds.grandfather}`,
    "/people",
    `/person/${fixtureIds.grandfather}`,
    `/person/${fixtureIds.grandfather}/edit`,
    "/person/new",
    "/import",
    "/moderation",
    "/settings",
    "/onboarding",
    `/media/${fixtureMediaId}`,
  ];

  for (const path of guarded) {
    test(`are redirected to /login from ${path}`, async ({ anonPage }) => {
      await anonPage.goto(path);
      await expect(anonPage).toHaveURL(/\/login(\?|$)/);
    });
  }

  test("can reach /login itself", async ({ anonPage }) => {
    await anonPage.goto("/login");
    await expect(
      anonPage.getByRole("heading", { level: 1, name: "Rootward" }),
    ).toBeVisible();
    await expect(anonPage.getByLabel("Email")).toBeVisible();
  });

  test("get no header chrome at all", async ({ anonPage }) => {
    await anonPage.goto("/login");
    await expect(anonPage.getByRole("banner")).toHaveCount(0);
    await expect(accountMenuTrigger(anonPage)).toHaveCount(0);
  });

  test("can reach the sign-in error page", async ({ anonPage }) => {
    await anonPage.goto("/auth/auth-code-error");
    await expect(
      anonPage.getByRole("heading", { name: /did not work/i }),
    ).toBeVisible();
    await expect(
      anonPage.getByRole("link", { name: "Back to sign in" }),
    ).toBeVisible();
  });

  test("a callback with no code lands on the error page", async ({
    anonPage,
  }) => {
    await anonPage.goto("/auth/callback");
    await expect(anonPage).toHaveURL(/\/auth\/auth-code-error$/);
  });
});

test.describe("a pending member", () => {
  test("is held on /onboarding from the tree", async ({ pendingPage }) => {
    await pendingPage.goto("/tree");
    await expect(pendingPage).toHaveURL(/\/onboarding$/);
  });

  test("is held on /onboarding from a profile", async ({ pendingPage }) => {
    await pendingPage.goto(`/person/${fixtureIds.grandfather}`);
    await expect(pendingPage).toHaveURL(/\/onboarding$/);
  });

  test("is held on /onboarding from /people", async ({ pendingPage }) => {
    await pendingPage.goto("/people");
    await expect(pendingPage).toHaveURL(/\/onboarding$/);
  });

  test("sees no navigation links, only sign-out", async ({ pendingPage }) => {
    await pendingPage.goto("/onboarding");
    await expect(await openSignOut(pendingPage)).toBeVisible();
    await pendingPage.keyboard.press("Escape");
    await expect(pendingPage.getByRole("link", { name: "Home" })).toHaveCount(
      0,
    );
  });
});

test.describe("a suspended member", () => {
  test("sees the paused notice on /onboarding", async ({ suspendedPage }) => {
    await suspendedPage.goto("/onboarding");
    await expect(
      suspendedPage.getByRole("heading", { name: "Access paused" }),
    ).toBeVisible();
  });

  test("cannot reach the tree", async ({ suspendedPage }) => {
    await suspendedPage.goto("/tree");
    await expect(suspendedPage).toHaveURL(/\/onboarding$/);
  });

  test("cannot reach moderation", async ({ suspendedPage }) => {
    await suspendedPage.goto("/moderation");
    await expect(
      suspendedPage.getByText(/needs? moderator access/i),
    ).toBeVisible();
  });
});

test.describe("a viewer", () => {
  for (const route of MODERATOR_ROUTES) {
    test(`is refused ${route.path}`, async ({ viewerPage }) => {
      await viewerPage.goto(route.path);
      await expect(
        viewerPage.getByRole("heading", { level: 1, name: route.heading }),
      ).toBeVisible();
      await expect(
        viewerPage.getByText(/needs? moderator access|Ask an administrator/i),
      ).toBeVisible();
    });
  }

  test("can open /settings for the Appearance tab only", async ({
    viewerPage,
  }) => {
    await viewerPage.goto("/settings");
    await expect(
      viewerPage.getByRole("heading", { level: 1, name: "Appearance" }),
    ).toBeVisible();
    await expect(viewerPage.getByRole("link", { name: "Tree" })).toHaveCount(0);
  });

  test("is refused the Tree and Roles tabs", async ({ viewerPage }) => {
    for (const tab of ["tree", "roles"]) {
      await viewerPage.goto(`/settings?tab=${tab}`);
      await expect(
        viewerPage.getByText(/needs? administrator access/i),
      ).toBeVisible();
    }
  });

  test("is refused the edit view", async ({ viewerPage }) => {
    await viewerPage.goto(`/person/${fixtureIds.grandfather}/edit`);
    await expect(
      viewerPage.getByRole("heading", { level: 1, name: "Editing" }),
    ).toBeVisible();
    await expect(
      viewerPage.getByText(/needs? moderator access/i),
    ).toBeVisible();
    await expect(
      viewerPage.getByRole("link", { name: /Back to the profile/ }),
    ).toBeVisible();
    // The real check: no editable form came back with the refusal.
    await expect(viewerPage.getByRole("button", { name: "Save" })).toHaveCount(
      0,
    );
  });

  test("can read a profile", async ({ viewerPage }) => {
    await viewerPage.goto(`/person/${fixtureIds.grandfather}`);
    await expect(
      viewerPage.getByRole("heading", {
        level: 1,
        name: fixtureNames.grandfather,
      }),
    ).toBeVisible();
  });

  test("sees no Edit button on a profile", async ({ viewerPage }) => {
    await viewerPage.goto(`/person/${fixtureIds.grandfather}`);
    await expect(viewerPage.getByRole("link", { name: "Edit" })).toHaveCount(0);
  });

  test("sees no notification bell", async ({ viewerPage }) => {
    await viewerPage.goto("/people");
    await expect(
      viewerPage.getByRole("button", { name: /^Notifications/ }),
    ).toHaveCount(0);
  });
});

test.describe("a moderator", () => {
  for (const route of MODERATOR_ROUTES) {
    test(`can open ${route.path}`, async ({ moderatorPage }) => {
      await moderatorPage.goto(route.path);
      await expect(
        moderatorPage.getByRole("heading", { level: 1, name: route.heading }),
      ).toBeVisible();
      await expect(
        moderatorPage.getByText(/needs? moderator access/i),
      ).toHaveCount(0);
    });
  }

  test("is refused the Tree tab", async ({ moderatorPage }) => {
    await moderatorPage.goto("/settings?tab=tree");
    await expect(
      moderatorPage.getByText(/needs? administrator access/i),
    ).toBeVisible();
  });

  test("can open the edit view", async ({ moderatorPage }) => {
    await moderatorPage.goto(`/person/${fixtureIds.grandfather}/edit`);
    await expect(
      moderatorPage.getByRole("heading", {
        level: 1,
        name: fixtureNames.grandfather,
      }),
    ).toBeVisible();
  });

  test("sees the notification bell", async ({ moderatorPage }) => {
    await moderatorPage.goto("/people");
    await expect(
      moderatorPage.getByRole("button", { name: /^Notifications/ }),
    ).toBeVisible();
  });

  test("sees no admin-only delete control in the edit view", async ({
    moderatorPage,
  }) => {
    await moderatorPage.goto(`/person/${fixtureIds.loner}/edit`);
    await expect(
      moderatorPage.getByRole("button", { name: /^Delete / }),
    ).toHaveCount(0);
  });
});

test.describe("an admin", () => {
  test("can open every /settings tab", async ({ adminPage }) => {
    await adminPage.goto("/settings");
    await expect(
      adminPage.getByRole("heading", { level: 1, name: "Appearance" }),
    ).toBeVisible();
    await adminPage.getByRole("link", { name: "Tree" }).click();
    await expect(
      adminPage.getByRole("heading", { name: "Tree settings" }),
    ).toBeVisible();
    await adminPage.getByRole("link", { name: "Roles" }).click();
    await expect(
      adminPage.getByRole("heading", { name: "Accounts" }),
    ).toBeVisible();
  });

  for (const route of MODERATOR_ROUTES) {
    test(`can open ${route.path}`, async ({ adminPage }) => {
      await adminPage.goto(route.path);
      await expect(
        adminPage.getByRole("heading", { level: 1, name: route.heading }),
      ).toBeVisible();
    });
  }

  test("sees the admin-only delete control in the edit view", async ({
    adminPage,
  }) => {
    await adminPage.goto(`/person/${fixtureIds.loner}/edit`);
    await expect(
      adminPage.getByRole("button", { name: `Delete ${fixtureNames.loner}` }),
    ).toBeVisible();
  });
});
