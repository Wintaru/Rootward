import { assert, assertEquals } from "@std/assert";

import {
  type AccessRequestInput,
  type AccountRow,
  type CandidateRow,
  type ChallengeProfile,
  type LinkOutcome,
  type MatchGateway,
  MAX_ATTEMPTS_PER_DAY,
  type NotificationType,
  runSearch,
  runVerify,
  type SearchInput,
  selectChallenges,
} from "./matcher.ts";

// --- fake gateway ----------------------------------------------------

interface Attempt {
  readonly accountId: string;
  readonly succeeded: boolean;
}

interface NotificationRow {
  readonly type: NotificationType;
  readonly payload: Record<string, unknown>;
}

const EMPTY_PROFILE: ChallengeProfile = {
  parentGivenNames: [],
  spouseGivenNames: [],
  birthPlaceNames: [],
  birthDays: [],
};

class FakeGateway implements MatchGateway {
  accounts = new Map<string, AccountRow>();
  candidates: CandidateRow[] = [];
  profiles = new Map<string, ChallengeProfile>();
  claimed = new Set<string>();
  attempts: Attempt[] = [];
  accessRequests: AccessRequestInput[] = [];
  notifications: NotificationRow[] = [];
  linkConflict = false;

  loadAccount(accountId: string): Promise<AccountRow | null> {
    return Promise.resolve(this.accounts.get(accountId) ?? null);
  }

  searchCandidates(
    _input: SearchInput,
    threshold: number,
  ): Promise<readonly CandidateRow[]> {
    return Promise.resolve(
      this.candidates.filter((candidate) => candidate.score >= threshold),
    );
  }

  loadChallengeProfile(personId: string): Promise<ChallengeProfile> {
    return Promise.resolve(this.profiles.get(personId) ?? EMPTY_PROFILE);
  }

  claimedPersonIds(
    personIds: readonly string[],
  ): Promise<ReadonlySet<string>> {
    return Promise.resolve(
      new Set(personIds.filter((id) => this.claimed.has(id))),
    );
  }

  countRecentAttempts(accountId: string): Promise<number> {
    return Promise.resolve(
      this.attempts.filter((attempt) => attempt.accountId === accountId).length,
    );
  }

  recordAttempt(accountId: string, succeeded: boolean): Promise<void> {
    this.attempts.push({ accountId, succeeded });
    return Promise.resolve();
  }

  linkAccount(accountId: string, personId: string): Promise<LinkOutcome> {
    const account = this.accounts.get(accountId);
    if (
      this.linkConflict || account === undefined || account.status !== "pending"
    ) {
      return Promise.resolve("conflict");
    }
    this.accounts.set(accountId, {
      ...account,
      status: "active",
      person_id: personId,
    });
    this.claimed.add(personId);
    return Promise.resolve("linked");
  }

  hasOpenAccessRequest(accountId: string): Promise<boolean> {
    return Promise.resolve(
      this.accessRequests.some((request) => request.accountId === accountId),
    );
  }

  createAccessRequest(input: AccessRequestInput): Promise<void> {
    this.accessRequests.push(input);
    return Promise.resolve();
  }

  createNotification(
    type: NotificationType,
    payload: Record<string, unknown>,
  ): Promise<void> {
    this.notifications.push({ type, payload });
    return Promise.resolve();
  }
}

// --- fixtures ------------------------------------------------------

const ACCOUNT_ID = "00000000-0000-4000-8000-00000000ac01";
const PERSON_ID = "00000000-0000-4000-8000-0000000be001";
const OTHER_PERSON_ID = "00000000-0000-4000-8000-0000000be002";

const IDENTITY: SearchInput = {
  givenName: "Samuel",
  surname: "Ashby",
  birthYear: 1901,
  birthMonth: 6,
};

const FULL_PROFILE: ChallengeProfile = {
  parentGivenNames: ["Cornelius", "Temperance"],
  spouseGivenNames: ["Eliza"],
  birthPlaceNames: ["Boston, Massachusetts, USA", "Boston"],
  birthDays: [14],
};

function pendingAccount(): AccountRow {
  return { id: ACCOUNT_ID, status: "pending", person_id: null };
}

function baseGateway(): FakeGateway {
  const gateway = new FakeGateway();
  gateway.accounts.set(ACCOUNT_ID, pendingAccount());
  gateway.candidates = [{ personId: PERSON_ID, score: 0.9 }];
  gateway.profiles.set(PERSON_ID, FULL_PROFILE);
  return gateway;
}

// --- selectChallenges --------------------------------------------

Deno.test("selectChallenges: priority order, capped at two", () => {
  assertEquals(selectChallenges(FULL_PROFILE), [
    "spouse_first_name",
    "parent_first_name",
  ]);
});

Deno.test(
  "selectChallenges: birth_day only when nothing stronger exists",
  () => {
    assertEquals(selectChallenges({ ...EMPTY_PROFILE, birthDays: [3] }), [
      "birth_day",
    ]);
    assertEquals(selectChallenges(EMPTY_PROFILE), []);
  },
);

// --- runSearch --------------------------------------------------

Deno.test(
  "runSearch: returns opaque personId + challenge keys only",
  async () => {
    const gateway = baseGateway();
    const result = await runSearch({ gateway, input: IDENTITY });

    assertEquals(result.candidates.length, 1);
    const [candidate] = result.candidates;
    assertEquals(candidate.personId, PERSON_ID);
    assertEquals(candidate.challenges, [
      "spouse_first_name",
      "parent_first_name",
    ]);
    // Nothing identifying leaks: the candidate object has exactly two keys.
    assertEquals(Object.keys(candidate).sort(), ["challenges", "personId"]);
  },
);

Deno.test(
  "runSearch: drops already-claimed and unchallengeable candidates",
  async () => {
    const gateway = baseGateway();
    gateway.candidates = [
      { personId: PERSON_ID, score: 0.9 },
      { personId: OTHER_PERSON_ID, score: 0.8 },
      { personId: "00000000-0000-4000-8000-0000000be003", score: 0.7 },
    ];
    gateway.claimed.add(PERSON_ID);
    gateway.profiles.set(OTHER_PERSON_ID, EMPTY_PROFILE); // no answerable facts
    const survivorId = "00000000-0000-4000-8000-0000000be003";
    gateway.profiles.set(survivorId, FULL_PROFILE);

    const result = await runSearch({ gateway, input: IDENTITY });
    assertEquals(
      result.candidates.map((c) => c.personId),
      [survivorId],
    );
  },
);

// --- runVerify: happy path -------------------------------------

Deno.test(
  "runVerify: one correct answer links the account and notifies",
  async () => {
    const gateway = baseGateway();
    const result = await runVerify({
      gateway,
      input: {
        accountId: ACCOUNT_ID,
        personId: PERSON_ID,
        identity: IDENTITY,
        answers: { spouse_first_name: "eliza", parent_first_name: "wrong" },
      },
    });

    assertEquals(result.status, "linked");
    assertEquals(gateway.accounts.get(ACCOUNT_ID)?.status, "active");
    assertEquals(gateway.accounts.get(ACCOUNT_ID)?.person_id, PERSON_ID);
    assertEquals(gateway.attempts, [
      { accountId: ACCOUNT_ID, succeeded: true },
    ]);
    assertEquals(gateway.notifications.length, 1);
    assertEquals(gateway.notifications[0].type, "self_claim_linked");
    assertEquals(gateway.notifications[0].payload, {
      person_id: PERSON_ID,
      account_id: ACCOUNT_ID,
    });
  },
);

Deno.test("runVerify: birth_day answer matches numerically", async () => {
  const gateway = baseGateway();
  gateway.profiles.set(PERSON_ID, { ...EMPTY_PROFILE, birthDays: [14] });

  const result = await runVerify({
    gateway,
    input: {
      accountId: ACCOUNT_ID,
      personId: PERSON_ID,
      identity: IDENTITY,
      answers: { birth_day: "14" },
    },
  });
  assertEquals(result.status, "linked");
});

Deno.test(
  "runVerify: birth_place matches on a single locality token",
  async () => {
    const gateway = baseGateway();
    gateway.profiles.set(PERSON_ID, {
      ...EMPTY_PROFILE,
      birthPlaceNames: ["Boston, Massachusetts, USA"],
    });

    const result = await runVerify({
      gateway,
      input: {
        accountId: ACCOUNT_ID,
        personId: PERSON_ID,
        identity: IDENTITY,
        answers: { birth_place: "boston" },
      },
    });
    assertEquals(result.status, "linked");
  },
);

Deno.test(
  "runVerify: birth_place rejects a bare state or country name",
  async () => {
    for (const answer of ["massachusetts", "usa"]) {
      const gateway = baseGateway();
      gateway.profiles.set(PERSON_ID, {
        ...EMPTY_PROFILE,
        birthPlaceNames: ["Boston, Massachusetts, USA"],
      });
      const result = await runVerify({
        gateway,
        input: {
          accountId: ACCOUNT_ID,
          personId: PERSON_ID,
          identity: IDENTITY,
          answers: { birth_place: answer },
        },
      });
      assertEquals(result.status, "no_match", `"${answer}" must not pass`);
    }
  },
);

// --- runVerify: rejections -----------------------------------

Deno.test(
  "runVerify: all-wrong answers → no_match, failed attempt logged",
  async () => {
    const gateway = baseGateway();
    const result = await runVerify({
      gateway,
      input: {
        accountId: ACCOUNT_ID,
        personId: PERSON_ID,
        identity: IDENTITY,
        answers: { spouse_first_name: "nope", parent_first_name: "nope" },
      },
    });

    assertEquals(result.status, "no_match");
    assertEquals(gateway.attempts, [
      { accountId: ACCOUNT_ID, succeeded: false },
    ]);
    assertEquals(gateway.notifications.length, 0);
  },
);

Deno.test(
  "runVerify: answer to a non-posed challenge does not count",
  async () => {
    const gateway = baseGateway();
    // FULL_PROFILE poses spouse + parent only; a correct birth_day must be ignored.
    const result = await runVerify({
      gateway,
      input: {
        accountId: ACCOUNT_ID,
        personId: PERSON_ID,
        identity: IDENTITY,
        answers: { birth_day: "14" },
      },
    });
    assertEquals(result.status, "no_match");
  },
);

Deno.test(
  "runVerify: personId absent from the candidate set → no_match",
  async () => {
    const gateway = baseGateway();
    const result = await runVerify({
      gateway,
      input: {
        accountId: ACCOUNT_ID,
        personId: OTHER_PERSON_ID,
        identity: IDENTITY,
        answers: { spouse_first_name: "eliza" },
      },
    });
    assertEquals(result.status, "no_match");
    assertEquals(gateway.attempts, [
      { accountId: ACCOUNT_ID, succeeded: false },
    ]);
  },
);

Deno.test(
  "runVerify: already-active account → already_linked, no attempt",
  async () => {
    const gateway = baseGateway();
    gateway.accounts.set(ACCOUNT_ID, {
      id: ACCOUNT_ID,
      status: "active",
      person_id: OTHER_PERSON_ID,
    });

    const result = await runVerify({
      gateway,
      input: {
        accountId: ACCOUNT_ID,
        personId: PERSON_ID,
        identity: IDENTITY,
        answers: { spouse_first_name: "eliza" },
      },
    });
    assertEquals(result.status, "already_linked");
    assertEquals(gateway.attempts.length, 0);
  },
);

Deno.test(
  "runVerify: a suspended account cannot self-claim back to active",
  async () => {
    const gateway = baseGateway();
    // Suspended while still unlinked — the ban must hold.
    gateway.accounts.set(ACCOUNT_ID, {
      id: ACCOUNT_ID,
      status: "suspended",
      person_id: null,
    });

    const result = await runVerify({
      gateway,
      input: {
        accountId: ACCOUNT_ID,
        personId: PERSON_ID,
        identity: IDENTITY,
        answers: { spouse_first_name: "eliza" }, // correct, but never reached
      },
    });
    assertEquals(result.status, "already_linked");
    assertEquals(gateway.accounts.get(ACCOUNT_ID)?.status, "suspended");
    assertEquals(gateway.attempts.length, 0);
  },
);

Deno.test(
  "runVerify: node claimed between search and verify → already_claimed",
  async () => {
    const gateway = baseGateway();
    gateway.claimed.add(PERSON_ID);

    const result = await runVerify({
      gateway,
      input: {
        accountId: ACCOUNT_ID,
        personId: PERSON_ID,
        identity: IDENTITY,
        answers: { spouse_first_name: "eliza" },
      },
    });
    assertEquals(result.status, "already_claimed");
    assertEquals(gateway.attempts, [
      { accountId: ACCOUNT_ID, succeeded: false },
    ]);
  },
);

Deno.test(
  "runVerify: lost the link race (unique violation) → already_claimed",
  async () => {
    const gateway = baseGateway();
    gateway.linkConflict = true;

    const result = await runVerify({
      gateway,
      input: {
        accountId: ACCOUNT_ID,
        personId: PERSON_ID,
        identity: IDENTITY,
        answers: { spouse_first_name: "eliza" },
      },
    });
    assertEquals(result.status, "already_claimed");
    assertEquals(gateway.attempts, [
      { accountId: ACCOUNT_ID, succeeded: false },
    ]);
    assertEquals(gateway.notifications.length, 0);
  },
);

// --- runVerify: rate limit ----------------------------------

Deno.test(
  "runVerify: the 6th attempt in 24h is refused and routed to access-request",
  async () => {
    const gateway = baseGateway();
    for (let i = 0; i < MAX_ATTEMPTS_PER_DAY; i++) {
      gateway.attempts.push({ accountId: ACCOUNT_ID, succeeded: false });
    }

    const result = await runVerify({
      gateway,
      input: {
        accountId: ACCOUNT_ID,
        personId: PERSON_ID,
        identity: IDENTITY,
        answers: { spouse_first_name: "eliza" }, // correct, but never checked
      },
    });

    assertEquals(result.status, "rate_limited");
    // No 6th claim_attempt row — the refusal must not extend the window.
    assertEquals(gateway.attempts.length, MAX_ATTEMPTS_PER_DAY);
    assertEquals(gateway.accessRequests.length, 1);
    assertEquals(gateway.accessRequests[0].submittedName, "Samuel Ashby");
    assertEquals(gateway.accessRequests[0].submittedBirthYear, 1901);
    assertEquals(gateway.notifications.length, 1);
    assertEquals(gateway.notifications[0].type, "claim_attempt_cap");
  },
);

Deno.test(
  "runVerify: repeated over-cap calls do not stack access-requests",
  async () => {
    const gateway = baseGateway();
    for (let i = 0; i < MAX_ATTEMPTS_PER_DAY + 3; i++) {
      gateway.attempts.push({ accountId: ACCOUNT_ID, succeeded: false });
    }
    gateway.accessRequests.push({
      accountId: ACCOUNT_ID,
      submittedName: "Samuel Ashby",
      submittedBirthMonth: 6,
      submittedBirthYear: 1901,
      message: "already here",
    });

    const result = await runVerify({
      gateway,
      input: {
        accountId: ACCOUNT_ID,
        personId: PERSON_ID,
        identity: IDENTITY,
        answers: { spouse_first_name: "eliza" },
      },
    });
    assertEquals(result.status, "rate_limited");
    assertEquals(gateway.accessRequests.length, 1);
    assertEquals(gateway.notifications.length, 0);
  },
);

Deno.test("runVerify: the 5th attempt still runs the challenge", async () => {
  const gateway = baseGateway();
  for (let i = 0; i < MAX_ATTEMPTS_PER_DAY - 1; i++) {
    gateway.attempts.push({ accountId: ACCOUNT_ID, succeeded: false });
  }

  const result = await runVerify({
    gateway,
    input: {
      accountId: ACCOUNT_ID,
      personId: PERSON_ID,
      identity: IDENTITY,
      answers: { spouse_first_name: "eliza" },
    },
  });
  assertEquals(result.status, "linked");
  assert(gateway.attempts.some((attempt) => attempt.succeeded));
});
