import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { chromium, type FullConfig } from "@playwright/test";

import { accountSpecs, storageStatePath, type RoleKey } from "./accounts";
import { signInWithMagicLink } from "./auth";
import { env } from "./env";
import {
  fixtureIds,
  seedFixtureFamily,
  seedFixtureMedia,
} from "./fixture-data";
import { ensureTestUser, type TestUser } from "./supabase-admin";

const here = dirname(fileURLToPath(import.meta.url));

/** Written for the tests to read: which user id belongs to which role. */
export type AccountDirectory = Readonly<Record<RoleKey, TestUser>>;

export const directoryPath = resolve(here, "../.auth/accounts.json");

/**
 * Runs once before the suite. Three jobs, in order:
 *
 * 1. build the fixture family every test asserts against;
 * 2. create one account per access level and put it in the right state;
 * 3. sign each one in through the real magic-link flow and save the browser
 *    session, so the tests themselves never pay for sign-in.
 *
 * Sign-in is sequential on purpose: Mailpit is one shared mailbox, and
 * GoTrue's local rate limits count sign-ins per IP.
 */
export default async function globalSetup(config: FullConfig): Promise<void> {
  const baseURL = config.projects[0]?.use.baseURL ?? env.baseURL;

  await assertAppIsUp(baseURL);
  await seedFixtureFamily();
  await seedFixtureMedia();
  await mkdir(resolve(here, "../.auth"), { recursive: true });

  const directory: Partial<Record<RoleKey, TestUser>> = {};
  const browser = await chromium.launch();

  try {
    for (const spec of accountSpecs) {
      const user = await ensureTestUser({
        email: spec.email,
        role: spec.role,
        status: spec.status,
        displayName: spec.displayName,
        personId: spec.linkFixturePerson ? fixtureIds.viewerPerson : null,
      });
      directory[spec.key] = user;

      const context = await browser.newContext({ baseURL });
      const page = await context.newPage();
      try {
        await signInWithMagicLink(page, spec.email);
        await context.storageState({
          path: resolve(here, "..", storageStatePath(spec.key)),
        });
      } finally {
        await context.close();
      }
    }
  } finally {
    await browser.close();
  }

  await writeFile(directoryPath, JSON.stringify(directory, null, 2), "utf8");
}

/**
 * Fail here, with the fix in the message, rather than in 200 tests at once.
 */
async function assertAppIsUp(baseURL: string): Promise<void> {
  let response: Response;
  try {
    response = await fetch(`${baseURL}/login`, { redirect: "manual" });
  } catch (error) {
    throw new Error(
      `The web app is not answering on ${baseURL}. Start the dev stack with ` +
        `"pnpm dev" from the repo root first. (${String(error)})`,
    );
  }

  // A 5xx is a running-but-broken app, which needs a different fix from a
  // server that is not there — so it must not be folded into the message
  // above.
  if (response.status >= 500) {
    throw new Error(
      `${baseURL}/login responded ${response.status}. The server is up but ` +
        `failing — check the "pnpm dev" output.`,
    );
  }
}
