import {
  admin,
  deleteUsersByPrefix,
  e2eAccountIds,
  readSettingsSnapshot,
  restoreTreeSettings,
} from "./supabase-admin";
import {
  fixtureIds,
  removeFixtureFamily,
  removeFixtureMedia,
} from "./fixture-data";

/**
 * Take the suite's data back out.
 *
 * The suite runs against the same local stack a developer browses, next to a
 * demo tree and usually a real imported GEDCOM — so leaving 230
 * `Qatestsson` / `Bulktestsson` people behind would quietly corrupt every
 * later `/people` count and search. `global-setup` re-seeds from scratch, so
 * nothing is lost by removing them.
 *
 * Accounts are swept by address prefix rather than from a list: the
 * invitation and magic-link flows create auth users the suite never names
 * (GoTrue makes one for any address a sign-in link is requested for), and a
 * fixed list would always drift behind them.
 *
 * `tree_settings` gets the same treatment. Its tests restore it themselves
 * after each case, but a worker that dies between a save and its restore
 * would otherwise leave the whole deployment renamed or its default depth
 * changed — the singleton has no owner to sweep it by.
 *
 * `E2E_KEEP_FIXTURES=1` keeps everything, for poking at a failed run by hand.
 */
export default async function globalTeardown(): Promise<void> {
  if (process.env.E2E_KEEP_FIXTURES === "1") {
    return;
  }

  await removeFixtureMedia();
  await removeFixtureFamily();
  const settings = readSettingsSnapshot();
  if (settings !== null) {
    await restoreTreeSettings(settings);
  }

  // `notification` has no FK to `person` or `account`, so the hide requests
  // the profile and moderation specs raise would otherwise outlive the
  // people they point at and pile up in the developer's queue.
  for (const personId of Object.values(fixtureIds)) {
    const { error } = await admin
      .from("notification")
      .delete()
      .eq("type", "hide_request")
      .contains("payload", { person_id: personId });
    if (error !== null) {
      throw new Error(`notification teardown failed: ${error.message}`);
    }
  }

  // `access_requested` notifications name the account that asked, not a
  // person, so they survive both sweeps above. Clear them before the
  // accounts go, while the ids are still there to match on — an orphaned
  // one sits in the developer's bell for good.
  await removeAccessRequestNotifications();

  // Rows the moderation and onboarding flows leave behind, keyed to the same
  // reserved addresses.
  const invitations = await admin
    .from("invitation")
    .delete()
    .like("email", "e2e-%@rootward.test");
  if (invitations.error !== null) {
    throw new Error(`invitation teardown failed: ${invitations.error.message}`);
  }

  await deleteUsersByPrefix("e2e-");
}

async function removeAccessRequestNotifications(): Promise<void> {
  for (const accountId of await e2eAccountIds()) {
    const { error } = await admin
      .from("notification")
      .delete()
      .eq("type", "access_requested")
      .contains("payload", { account_id: accountId });
    if (error !== null) {
      throw new Error(
        `access-request notification teardown failed: ${error.message}`,
      );
    }
  }
}
