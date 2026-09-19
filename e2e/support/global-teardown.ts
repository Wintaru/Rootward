import { admin, deleteUsersByPrefix } from "./supabase-admin";
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
 * `E2E_KEEP_FIXTURES=1` keeps everything, for poking at a failed run by hand.
 */
export default async function globalTeardown(): Promise<void> {
  if (process.env.E2E_KEEP_FIXTURES === "1") {
    return;
  }

  await removeFixtureMedia();
  await removeFixtureFamily();

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
