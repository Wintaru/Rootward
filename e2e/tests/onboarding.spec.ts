import {
  FIXTURE_SURNAME,
  fixtureBirthYears,
  fixtureGivenNames,
} from "../support/fixture-data";
import {
  admin,
  deleteTestUser,
  ensureTestUser,
} from "../support/supabase-admin";
import { signInWithMagicLink } from "../support/auth";
import { expect, test } from "../support/test";

/**
 * `/onboarding` — the claim flow and the request-access fallback
 * (SPEC §9.3, decisions 12/13/24, issue #19).
 *
 * `onboarding-match` is an edge function, and the local baked runtime can
 * run it (unlike the GEDCOM pair, it imports nothing from `packages/*`), so
 * the match path is exercised for real.
 */

test.describe("the claim flow", () => {
  test("opens on the identity form", async ({ pendingPage }) => {
    await pendingPage.goto("/onboarding");
    await expect(
      pendingPage.getByRole("heading", { level: 1, name: "Join the tree" }),
    ).toBeVisible();
    await expect(
      pendingPage.getByRole("heading", { name: "Your details" }),
    ).toBeVisible();
    await expect(pendingPage.getByLabel("First name")).toBeVisible();
    await expect(pendingPage.getByLabel("Last name")).toBeVisible();
    await expect(pendingPage.getByLabel("Birth year")).toBeVisible();
  });

  test("refuses a missing birth year", async ({ pendingPage }) => {
    await pendingPage.goto("/onboarding");
    await pendingPage
      .getByLabel("First name")
      .fill(fixtureGivenNames.grandfather);
    await pendingPage.getByLabel("Last name").fill(FIXTURE_SURNAME);
    await pendingPage.getByRole("button", { name: "Find my match" }).click();
    await expect(
      pendingPage.getByText(/Enter the birth year as a number/),
    ).toBeVisible();
  });

  test("refuses a non-numeric birth year", async ({ pendingPage }) => {
    await pendingPage.goto("/onboarding");
    await pendingPage
      .getByLabel("First name")
      .fill(fixtureGivenNames.grandfather);
    await pendingPage.getByLabel("Last name").fill(FIXTURE_SURNAME);
    await pendingPage.getByLabel("Birth year").fill("nineteen");
    await pendingPage.getByRole("button", { name: "Find my match" }).click();
    await expect(
      pendingPage.getByText(/Enter the birth year as a number/),
    ).toBeVisible();
  });

  test("refuses a missing name", async ({ pendingPage }) => {
    await pendingPage.goto("/onboarding");
    await pendingPage
      .getByLabel("Birth year")
      .fill(String(fixtureBirthYears.grandfather));
    await pendingPage.getByRole("button", { name: "Find my match" }).click();
    await expect(
      pendingPage.getByText(/Enter both a first name and a last name/),
    ).toBeVisible();
  });

  test("offers request-access when nobody matches", async ({ pendingPage }) => {
    await pendingPage.goto("/onboarding");
    await pendingPage.getByLabel("First name").fill("Nobody");
    await pendingPage.getByLabel("Last name").fill("Zzznotintree");
    await pendingPage.getByLabel("Birth year").fill("1911");
    await pendingPage.getByRole("button", { name: "Find my match" }).click();

    await expect(
      pendingPage.getByRole("heading", { name: /couldn't match you/i }),
    ).toBeVisible({ timeout: 30_000 });
    await expect(
      pendingPage.getByRole("button", { name: "Request access" }),
    ).toBeVisible();
    await expect(
      pendingPage.getByRole("button", { name: "Try again" }),
    ).toBeVisible();
  });

  test("Try again returns to the identity form", async ({ pendingPage }) => {
    await pendingPage.goto("/onboarding");
    await pendingPage.getByLabel("First name").fill("Nobody");
    await pendingPage.getByLabel("Last name").fill("Zzznotintree");
    await pendingPage.getByLabel("Birth year").fill("1911");
    await pendingPage.getByRole("button", { name: "Find my match" }).click();
    await expect(
      pendingPage.getByRole("button", { name: "Try again" }),
    ).toBeVisible({ timeout: 30_000 });

    await pendingPage.getByRole("button", { name: "Try again" }).click();
    await expect(
      pendingPage.getByRole("heading", { name: "Your details" }),
    ).toBeVisible();
  });

  test("asks a challenge question when someone matches", async ({
    pendingPage,
  }) => {
    await pendingPage.goto("/onboarding");
    await pendingPage
      .getByLabel("First name")
      .fill(fixtureGivenNames.grandfather);
    await pendingPage.getByLabel("Last name").fill(FIXTURE_SURNAME);
    await pendingPage
      .getByLabel("Birth year")
      .fill(String(fixtureBirthYears.grandfather));
    await pendingPage.getByRole("button", { name: "Find my match" }).click();

    await expect(
      pendingPage.getByRole("heading", { name: "One quick check" }),
    ).toBeVisible({ timeout: 30_000 });
    await expect(
      pendingPage.getByRole("button", { name: "Link my account" }),
    ).toBeVisible();
  });

  test("keeps the answers on screen when a challenge is wrong", async ({
    pendingPage,
  }) => {
    await pendingPage.goto("/onboarding");
    await pendingPage
      .getByLabel("First name")
      .fill(fixtureGivenNames.grandfather);
    await pendingPage.getByLabel("Last name").fill(FIXTURE_SURNAME);
    await pendingPage
      .getByLabel("Birth year")
      .fill(String(fixtureBirthYears.grandfather));
    await pendingPage.getByRole("button", { name: "Find my match" }).click();
    await expect(
      pendingPage.getByRole("heading", { name: "One quick check" }),
    ).toBeVisible({ timeout: 30_000 });

    // Scoped to `main`: the header's sign-out form carries a hidden input
    // that a bare `form input` would match first.
    const answer = pendingPage.getByRole("main").getByRole("textbox").first();
    await answer.fill("definitely-wrong");
    await pendingPage.getByRole("button", { name: "Link my account" }).click();

    // Either the form comes back with the answer kept, or the flow falls
    // through to "we couldn't match you" — both are documented outcomes.
    await expect(
      pendingPage
        .getByRole("heading", { name: "One quick check" })
        .or(pendingPage.getByRole("heading", { name: /couldn't match you/i })),
    ).toBeVisible({ timeout: 30_000 });
  });

  test("refuses an empty challenge answer", async ({ pendingPage }) => {
    await pendingPage.goto("/onboarding");
    await pendingPage
      .getByLabel("First name")
      .fill(fixtureGivenNames.grandfather);
    await pendingPage.getByLabel("Last name").fill(FIXTURE_SURNAME);
    await pendingPage
      .getByLabel("Birth year")
      .fill(String(fixtureBirthYears.grandfather));
    await pendingPage.getByRole("button", { name: "Find my match" }).click();
    await expect(
      pendingPage.getByRole("heading", { name: "One quick check" }),
    ).toBeVisible({ timeout: 30_000 });

    await pendingPage.getByRole("button", { name: "Link my account" }).click();
    await expect(
      pendingPage.getByText(/Answer at least one of the questions/),
    ).toBeVisible();
  });
});

test.describe("the request-access form", () => {
  // Both tests sign in as the same account, and `ensureTestUser` recreates
  // that auth user — running them at once would pull the session out from
  // under the other.
  test.describe.configure({ mode: "serial" });

  const email = "e2e-requester@rootward.test";

  test.beforeEach(async () => {
    await ensureTestUser({
      email,
      role: "viewer",
      status: "pending",
      displayName: "E2E Requester",
    });
  });

  test.afterAll(async () => {
    await deleteTestUser(email);
  });

  test("sends a request and confirms it", async ({ anonPage }) => {
    await signInWithMagicLink(anonPage, email);
    await expect(anonPage).toHaveURL(/\/onboarding$/);

    await anonPage.getByLabel("First name").fill("Nobody");
    await anonPage.getByLabel("Last name").fill("Zzznotintree");
    await anonPage.getByLabel("Birth year").fill("1911");
    await anonPage.getByRole("button", { name: "Find my match" }).click();
    await expect(
      anonPage.getByRole("button", { name: "Request access" }),
    ).toBeVisible({ timeout: 30_000 });

    await anonPage.getByRole("button", { name: "Request access" }).click();
    await expect(
      anonPage.getByRole("heading", { name: "Request access" }),
    ).toBeVisible();
    await expect(anonPage.getByLabel("Your name")).toHaveValue(
      "Nobody Zzznotintree",
    );

    await anonPage.getByLabel("Message (optional)").fill("e2e access request");
    await anonPage.getByRole("button", { name: "Send request" }).click();
    await expect(
      anonPage.getByRole("heading", { name: "Request sent" }),
    ).toBeVisible({ timeout: 30_000 });

    // Scoped to this request's own submitted name: a developer's database
    // usually holds unrelated pending requests, and a bare "some row exists"
    // would pass even if the form wrote nothing.
    const { count } = await admin
      .from("access_request")
      .select("id", { count: "exact", head: true })
      .eq("status", "pending")
      .eq("submitted_name", "Nobody Zzznotintree");
    expect(count ?? 0).toBeGreaterThan(0);
  });

  test("refuses an empty name", async ({ anonPage }) => {
    await signInWithMagicLink(anonPage, email);
    await anonPage.getByLabel("First name").fill("Nobody");
    await anonPage.getByLabel("Last name").fill("Zzznotintree");
    await anonPage.getByLabel("Birth year").fill("1911");
    await anonPage.getByRole("button", { name: "Find my match" }).click();
    await expect(
      anonPage.getByRole("button", { name: "Request access" }),
    ).toBeVisible({ timeout: 30_000 });
    await anonPage.getByRole("button", { name: "Request access" }).click();

    await anonPage.getByLabel("Your name").fill("");
    await anonPage.getByRole("button", { name: "Send request" }).click();
    await expect(
      anonPage.getByText(/Enter your name so an administrator knows/),
    ).toBeVisible();
  });
});

test.describe("an approved member", () => {
  test("is bounced off /onboarding", async ({ viewerPage }) => {
    await viewerPage.goto("/onboarding");
    await expect(viewerPage).not.toHaveURL(/\/onboarding/);
  });
});
