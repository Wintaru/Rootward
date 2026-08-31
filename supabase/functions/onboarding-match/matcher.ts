/**
 * The `onboarding-match` engine (SPEC §7, §9.3, decision 24) — the self-claim
 * flow that links a signed-in but not-yet-approved account to its own `person`
 * node.
 *
 * Portable TypeScript: no Deno APIs, no database driver. The fuzzy search, the
 * challenge-fact reads, and every write go through {@link MatchGateway}, so the
 * engine runs unchanged under the edge runtime (`index.ts`) and the test runner
 * (`matcher.test.ts`).
 *
 * Two calls (decision 24, no candidate list ever shown):
 *   1. {@link runSearch} — name + birth month/year in, a candidate list out.
 *      Each candidate carries only its opaque `personId` and which challenge
 *      facts it can be asked — never a name, a date, or a place.
 *   2. {@link runVerify} — challenge answers in. One correct answer among those
 *      posed links the account, flips it to `active`, and notifies moderators
 *      (DECISIONS 2026-08-31). Every verify call is exactly one `claim_attempt`
 *      row; the 6th within a rolling 24h is refused and routed to request-access.
 */

// --- tuning knobs --------------------------------------------------------

/** Rolling-window attempt cap (decision 24: "about five per day"). */
export const MAX_ATTEMPTS_PER_DAY = 5;

const ATTEMPT_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * Trigram score (0..1) below which a candidate is not a match — the mean of the
 * given-name and surname similarities. 0.3 is `pg_trgm`'s own default and,
 * measured against the seeded Ashby tree (issue #38): an exact surname alone
 * clears it (0.5), `Kathryn`→`Katherine` clears it with an exact surname
 * (0.64), and unrelated names score 0. The birth-year-exact filter and the
 * challenge are the real discriminators, not this score (WAYFINDER 24). See
 * DECISIONS 2026-08-31.
 */
export const SEARCH_THRESHOLD = 0.3;

/** WAYFINDER 24: the server asks "one or two facts", never the whole set. */
const MAX_CHALLENGES = 2;

// --- challenge facts ----------------------------------------------------

/**
 * Challenge keys in priority order — strongest discriminator first. The
 * weakest, `birth_day` (~1/31), is only ever posed for a record that holds
 * nothing better.
 */
export const CHALLENGE_KEYS = [
  "spouse_first_name",
  "parent_first_name",
  "birth_place",
  "birth_day",
] as const;

export type ChallengeKey = (typeof CHALLENGE_KEYS)[number];

export type NotificationType = "self_claim_linked" | "claim_attempt_cap";

export type VerifyStatus =
  | "linked"
  | "no_match"
  | "already_claimed"
  | "already_linked"
  | "rate_limited";

// --- data shapes -------------------------------------------------------

export interface SearchInput {
  readonly givenName: string;
  readonly surname: string;
  readonly birthYear: number;
  readonly birthMonth: number | null;
}

export interface AccountRow {
  readonly id: string;
  readonly status: string;
  readonly person_id: string | null;
}

export interface CandidateRow {
  readonly personId: string;
  readonly score: number;
}

export interface ChallengeProfile {
  readonly parentGivenNames: readonly string[];
  readonly spouseGivenNames: readonly string[];
  readonly birthPlaceNames: readonly string[];
  readonly birthDays: readonly number[];
}

export interface Candidate {
  readonly personId: string;
  readonly challenges: readonly ChallengeKey[];
}

export interface SearchResult {
  readonly candidates: readonly Candidate[];
}

export interface VerifyResult {
  readonly status: VerifyStatus;
}

export type LinkOutcome = "linked" | "conflict";

export interface AccessRequestInput {
  readonly accountId: string;
  readonly submittedName: string;
  readonly submittedBirthMonth: number | null;
  readonly submittedBirthYear: number;
  readonly message: string;
}

export interface MatchGateway {
  loadAccount(accountId: string): Promise<AccountRow | null>;
  /** `onboarding_match_search` SQL function — the only trigram call. */
  searchCandidates(
    input: SearchInput,
    threshold: number,
  ): Promise<readonly CandidateRow[]>;
  loadChallengeProfile(personId: string): Promise<ChallengeProfile>;
  /** The subset of `personIds` already linked to an account. */
  claimedPersonIds(personIds: readonly string[]): Promise<ReadonlySet<string>>;
  countRecentAttempts(accountId: string, sinceIso: string): Promise<number>;
  recordAttempt(accountId: string, succeeded: boolean): Promise<void>;
  /**
   * Set `person_id` + `status = 'active'` — only on a still-`pending` account.
   * `conflict` on the `person_id` unique violation or a non-pending account.
   */
  linkAccount(accountId: string, personId: string): Promise<LinkOutcome>;
  hasOpenAccessRequest(accountId: string): Promise<boolean>;
  createAccessRequest(input: AccessRequestInput): Promise<void>;
  createNotification(
    type: NotificationType,
    payload: Record<string, unknown>,
  ): Promise<void>;
}

// --- pure helpers -----------------------------------------------------

/** Lower-case, strip diacritics, collapse whitespace. */
export function normalizeText(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u{0300}-\u{036F}]/gu, "") // strip combining diacritical marks
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function firstToken(value: string): string {
  return value.split(" ")[0] ?? "";
}

/**
 * Accepted answers for a birth place: the whole normalized string, and its
 * first segment only (the locality — "Boston" out of "Boston, Massachusetts,
 * USA"). Interior segments are deliberately not accepted: `birth_place` is
 * posed for the weakest records, and a lone state or country name is an easier
 * guess than the `birth_day` floor decision 24 already accepts.
 */
function placeAnswers(names: readonly string[]): ReadonlySet<string> {
  const out = new Set<string>();
  for (const raw of names) {
    const whole = normalizeText(raw);
    if (whole === "") continue;
    out.add(whole);
    const firstSegment = whole.split(/[,/]/)[0]?.trim() ?? "";
    if (firstSegment !== "") out.add(firstSegment);
  }
  return out;
}

const ANSWERABLE: Record<ChallengeKey, (p: ChallengeProfile) => boolean> = {
  spouse_first_name: (p) => p.spouseGivenNames.length > 0,
  parent_first_name: (p) => p.parentGivenNames.length > 0,
  birth_place: (p) => p.birthPlaceNames.length > 0,
  birth_day: (p) => p.birthDays.length > 0,
};

/** The challenges to pose for a record: answerable ones, priority order, capped. */
export function selectChallenges(profile: ChallengeProfile): ChallengeKey[] {
  return CHALLENGE_KEYS.filter((key) => ANSWERABLE[key](profile)).slice(
    0,
    MAX_CHALLENGES,
  );
}

function isChallengeCorrect(
  key: ChallengeKey,
  answer: string,
  profile: ChallengeProfile,
): boolean {
  const normalized = normalizeText(answer);
  if (normalized === "") return false;

  switch (key) {
    case "spouse_first_name":
      return profile.spouseGivenNames.some(
        (name) => firstToken(normalizeText(name)) === firstToken(normalized),
      );
    case "parent_first_name":
      return profile.parentGivenNames.some(
        (name) => firstToken(normalizeText(name)) === firstToken(normalized),
      );
    case "birth_place": {
      const accepted = placeAnswers(profile.birthPlaceNames);
      if (accepted.has(normalized)) return true;
      const firstSegment = normalized.split(/[,/]/)[0]?.trim() ?? "";
      return firstSegment !== "" && accepted.has(firstSegment);
    }
    case "birth_day": {
      if (!/^\d{1,2}$/.test(normalized)) return false;
      return profile.birthDays.includes(Number.parseInt(normalized, 10));
    }
  }
}

/** True when at least one posed challenge is answered correctly (DECISIONS 2026-08-31). */
function anyChallengePassed(
  posed: readonly ChallengeKey[],
  answers: Partial<Record<ChallengeKey, string>>,
  profile: ChallengeProfile,
): boolean {
  return posed.some((key) => {
    const answer = answers[key];
    return answer !== undefined && isChallengeCorrect(key, answer, profile);
  });
}

// --- search ----------------------------------------------------------

export interface RunSearchDeps {
  readonly gateway: MatchGateway;
  readonly input: SearchInput;
  readonly threshold?: number;
}

export async function runSearch(deps: RunSearchDeps): Promise<SearchResult> {
  const threshold = deps.threshold ?? SEARCH_THRESHOLD;
  const rows = await deps.gateway.searchCandidates(deps.input, threshold);

  const claimed = await deps.gateway.claimedPersonIds(
    rows.map((row) => row.personId),
  );

  // Bounded fan-out: `rows` is capped at 25 by the SQL function and, after the
  // exact-birth-year filter, is realistically 1–5. A per-candidate profile read
  // is the clearest shape for a path that runs once per onboarding claim.
  const candidates: Candidate[] = [];
  for (const row of rows) {
    if (claimed.has(row.personId)) continue;
    const profile = await deps.gateway.loadChallengeProfile(row.personId);
    const challenges = selectChallenges(profile);
    if (challenges.length === 0) continue; // nothing to verify against
    candidates.push({ personId: row.personId, challenges });
  }
  return { candidates };
}

// --- verify --------------------------------------------------------

export interface VerifyInput {
  readonly accountId: string;
  readonly personId: string;
  readonly identity: SearchInput;
  readonly answers: Partial<Record<ChallengeKey, string>>;
}

export interface RunVerifyDeps {
  readonly gateway: MatchGateway;
  readonly input: VerifyInput;
  readonly now?: () => number;
  readonly threshold?: number;
}

export async function runVerify(deps: RunVerifyDeps): Promise<VerifyResult> {
  const { gateway, input } = deps;
  const now = deps.now ?? (() => Date.now());
  const threshold = deps.threshold ?? SEARCH_THRESHOLD;

  const account = await gateway.loadAccount(input.accountId);
  if (account === null) return { status: "no_match" };
  // Only a `pending` account may self-claim. `active` is already a member;
  // `suspended` is a ban — letting it link would flip it back to `active`.
  if (account.status !== "pending" || account.person_id !== null) {
    return { status: "already_linked" };
  }

  // Rate limit (decision 24). The refusal is not itself an attempt — counting it
  // would roll the 24h window forward with every retry.
  const sinceIso = new Date(now() - ATTEMPT_WINDOW_MS).toISOString();
  const recentAttempts = await gateway.countRecentAttempts(
    input.accountId,
    sinceIso,
  );
  if (recentAttempts >= MAX_ATTEMPTS_PER_DAY) {
    await routeToAccessRequest(gateway, input);
    return { status: "rate_limited" };
  }

  // The client carries `personId` back from the search step. Re-run the search
  // so a caller cannot feed arbitrary person ids straight into the challenge.
  const candidates = await gateway.searchCandidates(input.identity, threshold);
  if (!candidates.some((candidate) => candidate.personId === input.personId)) {
    await gateway.recordAttempt(input.accountId, false);
    return { status: "no_match" };
  }

  const claimed = await gateway.claimedPersonIds([input.personId]);
  if (claimed.has(input.personId)) {
    await gateway.recordAttempt(input.accountId, false);
    return { status: "already_claimed" };
  }

  const profile = await gateway.loadChallengeProfile(input.personId);
  const posed = selectChallenges(profile);
  if (!anyChallengePassed(posed, input.answers, profile)) {
    await gateway.recordAttempt(input.accountId, false);
    return { status: "no_match" };
  }

  const outcome = await gateway.linkAccount(input.accountId, input.personId);
  if (outcome === "conflict") {
    await gateway.recordAttempt(input.accountId, false);
    return { status: "already_claimed" };
  }

  // The account is linked and active now. The attempt ledger and the moderator
  // notification are bookkeeping — a failure there must not 500 a done claim.
  await settle(gateway, input.accountId, input.personId);
  return { status: "linked" };
}

async function settle(
  gateway: MatchGateway,
  accountId: string,
  personId: string,
): Promise<void> {
  try {
    await gateway.recordAttempt(accountId, true);
    await gateway.createNotification("self_claim_linked", {
      person_id: personId,
      account_id: accountId,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`onboarding-match: post-link bookkeeping failed: ${message}`);
  }
}

async function routeToAccessRequest(
  gateway: MatchGateway,
  input: VerifyInput,
): Promise<void> {
  if (await gateway.hasOpenAccessRequest(input.accountId)) return;

  await gateway.createAccessRequest({
    accountId: input.accountId,
    submittedName: `${input.identity.givenName} ${input.identity.surname}`
      .trim(),
    submittedBirthMonth: input.identity.birthMonth,
    submittedBirthYear: input.identity.birthYear,
    message: "Automatic: self-claim challenge attempt cap reached (5 / 24h).",
  });
  await gateway.createNotification("claim_attempt_cap", {
    account_id: input.accountId,
    message: "Self-claim attempt cap reached; routed to request access.",
  });
}
