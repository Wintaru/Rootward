import type { AccountRole, AccountStatus } from "./supabase-admin";

/**
 * The account matrix the suite exercises (SPEC §9.4). One address per access
 * level, plus the two states that are not a level at all — not yet approved,
 * and suspended — because both have their own screens.
 *
 * `@rootward.test` is a reserved TLD: nothing here can reach a real mailbox
 * even if the suite is pointed at a stack with real SMTP by mistake.
 */
export type RoleKey =
  "admin" | "moderator" | "viewer" | "pending" | "suspended";

export type AccountSpec = {
  readonly key: RoleKey;
  readonly email: string;
  readonly displayName: string;
  readonly role: AccountRole;
  readonly status: AccountStatus;
  /** Claim the fixture person, as an accepted invitation would. */
  readonly linkFixturePerson: boolean;
};

export const accountSpecs: readonly AccountSpec[] = [
  {
    key: "admin",
    email: "e2e-admin@rootward.test",
    displayName: "E2E Admin",
    role: "admin",
    status: "active",
    linkFixturePerson: false,
  },
  {
    key: "moderator",
    email: "e2e-moderator@rootward.test",
    displayName: "E2E Moderator",
    role: "moderator",
    status: "active",
    linkFixturePerson: false,
  },
  {
    key: "viewer",
    email: "e2e-viewer@rootward.test",
    displayName: "E2E Viewer",
    role: "viewer",
    status: "active",
    linkFixturePerson: true,
  },
  {
    key: "pending",
    email: "e2e-pending@rootward.test",
    displayName: "E2E Pending",
    role: "viewer",
    status: "pending",
    linkFixturePerson: false,
  },
  {
    key: "suspended",
    email: "e2e-suspended@rootward.test",
    displayName: "E2E Suspended",
    role: "viewer",
    status: "suspended",
    linkFixturePerson: false,
  },
];

export function specFor(key: RoleKey): AccountSpec {
  const spec = accountSpecs.find((candidate) => candidate.key === key);
  if (spec === undefined) {
    throw new Error(`No account spec for "${key}".`);
  }
  return spec;
}

/** Where each role's saved browser session lives. */
export function storageStatePath(key: RoleKey): string {
  return `./.auth/${key}.json`;
}
