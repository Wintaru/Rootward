import type { Locator, Page } from "@playwright/test";

import { fixtureIds, fixtureNames } from "../support/fixture-data";
import { scratchPersons } from "../support/scratch";
import {
  admin,
  deleteTestUser,
  ensureTestUser,
} from "../support/supabase-admin";
import { alerts, expect, test } from "../support/test";

/**
 * `/moderation` — the access-request queue and the linked-account roster
 * (SPEC §9.2, §9.3, issue #36).
 *
 * Every control here writes to a real account, so each test makes its own
 * throwaway one rather than touching the five shared role accounts the other
 * specs read. Panels are located by the account's display name, never by
 * position: a developer's own tree may already hold requests.
 */

const scratch = scratchPersons();
const throwaways: string[] = [];
/**
 * Inserting an `access_request` fires a trigger that writes an
 * `access_requested` notification naming the account. The global teardown
 * sweeps those by account, but this file deletes its own accounts first — so
 * the notification has to go here, while the id is still known.
 */
const requesterAccountIds: string[] = [];

test.afterAll(async () => {
  for (const accountId of requesterAccountIds) {
    const { error } = await admin
      .from("notification")
      .delete()
      .eq("type", "access_requested")
      .contains("payload", { account_id: accountId });
    if (error !== null) {
      throw new Error(`notification cleanup failed: ${error.message}`);
    }
  }
  for (const email of throwaways) {
    await deleteTestUser(email);
  }
  await scratch.remove();
});

/** A signed-up visitor whose self-claim matched nobody — the state the queue
 * exists to resolve (SPEC §9.3). */
async function pendingRequester(
  label: string,
  submitted: { name: string; birthYear?: number; message?: string },
): Promise<{ email: string; accountId: string }> {
  const email = `e2e-${label}-${crypto.randomUUID().slice(0, 8)}@rootward.test`;
  throwaways.push(email);
  const user = await ensureTestUser({
    email,
    role: "viewer",
    status: "pending",
    displayName: `E2E ${label}`,
  });

  const { error } = await admin.from("access_request").insert({
    account_id: user.userId,
    status: "pending",
    submitted_name: submitted.name,
    submitted_birth_year: submitted.birthYear ?? null,
    message: submitted.message ?? null,
  });
  if (error !== null) {
    throw new Error(`access request insert failed: ${error.message}`);
  }
  requesterAccountIds.push(user.userId);
  return { email, accountId: user.userId };
}

function requestRow(page: Page, name: string): Locator {
  return page.getByRole("listitem").filter({ hasText: name }).first();
}

test.describe("the access-request queue", () => {
  test("shows what the visitor submitted about themselves", async ({
    adminPage,
  }) => {
    const name = `Wanda Wanting ${crypto.randomUUID().slice(0, 6)}`;
    await pendingRequester("wants", {
      name,
      birthYear: 1962,
      message: "I am Greta's niece.",
    });

    await adminPage.goto("/moderation");
    const row = requestRow(adminPage, name);
    await expect(row).toBeVisible();
    await expect(row.getByText("1962")).toBeVisible();
    await expect(row.getByText("I am Greta's niece.")).toBeVisible();
  });

  test("a moderator may reject but not approve", async ({ moderatorPage }) => {
    const name = `Rejectable Person ${crypto.randomUUID().slice(0, 6)}`;
    await pendingRequester("modview", { name });

    await moderatorPage.goto("/moderation");
    const row = requestRow(moderatorPage, name);
    await expect(
      row.getByText("Only an administrator can approve and link a request."),
    ).toBeVisible();
    await expect(row.getByRole("button", { name: "Approve" })).toHaveCount(0);
    await expect(row.getByRole("button", { name: "Reject" })).toBeVisible();
    await expect(row.getByLabel("Link to person")).toHaveCount(0);
  });

  test("an admin cannot approve until a person is chosen", async ({
    adminPage,
  }) => {
    const name = `Unlinked Person ${crypto.randomUUID().slice(0, 6)}`;
    await pendingRequester("needslink", { name });

    await adminPage.goto("/moderation");
    const row = requestRow(adminPage, name);
    await expect(row.getByRole("button", { name: "Approve" })).toBeDisabled();
    await expect(row.getByLabel("Link to person")).toBeVisible();
  });

  test("the picker chooses a person, and change undoes it", async ({
    adminPage,
  }) => {
    const name = `Pickable Person ${crypto.randomUUID().slice(0, 6)}`;
    await pendingRequester("picks", { name });

    await adminPage.goto("/moderation");
    const row = requestRow(adminPage, name);
    await row.getByLabel("Link to person").fill("Gideon");
    await row
      .getByRole("button", { name: fixtureNames.grandfather })
      .click({ timeout: 15_000 });

    await expect(row.getByText(fixtureNames.grandfather)).toBeVisible();
    await expect(row.getByRole("button", { name: "Approve" })).toBeEnabled();

    await row.getByRole("button", { name: "change" }).click();
    await expect(row.getByLabel("Link to person")).toBeVisible();
    await expect(row.getByRole("button", { name: "Approve" })).toBeDisabled();
  });

  test("Approve links the account and clears the request", async ({
    adminPage,
  }) => {
    const name = `Approvable Person ${crypto.randomUUID().slice(0, 6)}`;
    const { accountId } = await pendingRequester("approves", { name });
    const personId = await scratch.create("Approvetarget");

    await adminPage.goto("/moderation");
    const row = requestRow(adminPage, name);
    await row.getByLabel("Link to person").fill("Approvetarget");
    await row
      .getByRole("button", { name: /Approvetarget/ })
      .click({ timeout: 15_000 });
    await row.getByRole("button", { name: "Approve" }).click();

    await expect(requestRow(adminPage, name)).toHaveCount(0, {
      timeout: 15_000,
    });
    await expect
      .poll(
        async () => {
          const { data } = await admin
            .from("account")
            .select("person_id, status")
            .eq("id", accountId)
            .single();
          return data;
        },
        { timeout: 15_000 },
      )
      .toEqual({ person_id: personId, status: "active" });
  });

  test("Reject clears the request without linking anything", async ({
    adminPage,
  }) => {
    const name = `Rejected Person ${crypto.randomUUID().slice(0, 6)}`;
    const { accountId } = await pendingRequester("rejects", { name });

    await adminPage.goto("/moderation");
    await requestRow(adminPage, name)
      .getByRole("button", { name: "Reject" })
      .click();
    await expect(requestRow(adminPage, name)).toHaveCount(0, {
      timeout: 15_000,
    });

    await expect
      .poll(
        async () => {
          const { data } = await admin
            .from("access_request")
            .select("status")
            .eq("account_id", accountId)
            .single();
          return data?.status ?? null;
        },
        { timeout: 15_000 },
      )
      .toBe("rejected");

    const { data } = await admin
      .from("account")
      .select("person_id")
      .eq("id", accountId)
      .single();
    expect(data?.person_id ?? null).toBeNull();
  });
});

test.describe("the linked-account roster", () => {
  /** An approved account already linked to a person — what the roster
   * manages. */
  async function linkedAccount(label: string, personId: string) {
    const email = `e2e-${label}-${crypto.randomUUID().slice(0, 8)}@rootward.test`;
    const displayName = `E2E ${label} ${crypto.randomUUID().slice(0, 6)}`;
    throwaways.push(email);
    const user = await ensureTestUser({
      email,
      role: "viewer",
      status: "active",
      displayName,
      personId,
    });
    return { email, displayName, accountId: user.userId };
  }

  function roster(page: Page, displayName: string): Locator {
    return page.getByRole("listitem").filter({ hasText: displayName }).first();
  }

  test("names the person each account is linked to", async ({ adminPage }) => {
    const personId = await scratch.create("Rostertarget");
    const { displayName } = await linkedAccount("roster", personId);

    await adminPage.goto("/moderation");
    const row = roster(adminPage, displayName);
    await expect(row).toBeVisible();
    await expect(row.getByRole("link", { name: /Rostertarget/ })).toBeVisible();
  });

  test("a moderator sees the roster but cannot change it", async ({
    moderatorPage,
  }) => {
    const personId = await scratch.create("Modrostertarget");
    const { displayName } = await linkedAccount("modroster", personId);

    await moderatorPage.goto("/moderation");
    const row = roster(moderatorPage, displayName);
    await expect(row).toBeVisible();
    await expect(row.getByRole("button", { name: "Reassign" })).toHaveCount(0);
    await expect(row.getByRole("button", { name: "Unlink" })).toHaveCount(0);
  });

  test("Reassign opens a picker that Cancel closes again", async ({
    adminPage,
  }) => {
    const personId = await scratch.create("Cancelrostertarget");
    const { displayName } = await linkedAccount("cancelroster", personId);

    await adminPage.goto("/moderation");
    const row = roster(adminPage, displayName);
    await row.getByRole("button", { name: "Reassign" }).click();
    await expect(row.getByLabel("Reassign to person")).toBeVisible();

    await row.getByRole("button", { name: "Cancel" }).click();
    await expect(row.getByLabel("Reassign to person")).toHaveCount(0);
    await expect(row.getByRole("button", { name: "Reassign" })).toBeVisible();
  });

  test("Reassign moves the account to another person", async ({
    adminPage,
  }) => {
    const from = await scratch.create("Movedfrom");
    const to = await scratch.create("Movedto");
    const { displayName, accountId } = await linkedAccount("moves", from);

    await adminPage.goto("/moderation");
    const row = roster(adminPage, displayName);
    await row.getByRole("button", { name: "Reassign" }).click();
    await row.getByLabel("Reassign to person").fill("Movedto");
    await row
      .getByRole("button", { name: /Movedto/ })
      .click({ timeout: 15_000 });

    await expect(row.getByRole("link", { name: /Movedto/ })).toBeVisible({
      timeout: 15_000,
    });
    await expect(alerts(adminPage)).toHaveCount(0);
    await expect
      .poll(
        async () => {
          const { data } = await admin
            .from("account")
            .select("person_id")
            .eq("id", accountId)
            .single();
          return data?.person_id ?? null;
        },
        { timeout: 15_000 },
      )
      .toBe(to);
  });

  test("Unlink drops the account off the roster", async ({ adminPage }) => {
    const personId = await scratch.create("Unlinktarget");
    const { displayName, accountId } = await linkedAccount("unlinks", personId);

    await adminPage.goto("/moderation");
    await roster(adminPage, displayName)
      .getByRole("button", { name: "Unlink" })
      .click();
    await expect(roster(adminPage, displayName)).toHaveCount(0, {
      timeout: 15_000,
    });

    await expect
      .poll(
        async () => {
          const { data } = await admin
            .from("account")
            .select("person_id")
            .eq("id", accountId)
            .single();
          return data?.person_id ?? null;
        },
        { timeout: 15_000 },
      )
      .toBeNull();
  });

  test("the linked person's name opens that profile", async ({ adminPage }) => {
    const { displayName } = await linkedAccount(
      "opensprofile",
      fixtureIds.grandfather,
    );

    await adminPage.goto("/moderation");
    await roster(adminPage, displayName)
      .getByRole("link", { name: fixtureNames.grandfather })
      .click();
    await expect(adminPage).toHaveURL(
      new RegExp(`/person/${fixtureIds.grandfather}$`),
    );
  });
});
