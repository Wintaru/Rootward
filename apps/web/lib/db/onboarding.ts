import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "./database.types";

type Db = SupabaseClient<Database>;
type AccessRequestInsert =
  Database["public"]["Tables"]["access_request"]["Insert"];

/**
 * The self-claim onboarding layer (SPEC §7 `onboarding-match`, §9.3, decision
 * 24). `search` and `verify` both call the `onboarding-match` edge function with
 * the pending user's JWT — the browser client attaches it. The request-access
 * fallback writes an `access_request` row directly (RLS `access_request_insert`
 * allows the caller's own pending row); an insert trigger raises the moderator
 * notification (migration 20260831162624).
 */

/** Birth identity the search and the verify step both carry (SPEC §9.3). */
export interface OnboardingIdentity {
  readonly givenName: string;
  readonly surname: string;
  readonly birthYear: number;
  readonly birthMonth: number | null;
}

/**
 * Labels for the challenge fact keys `onboarding-match` can pose
 * (`supabase/functions/onboarding-match/matcher.ts` — `CHALLENGE_KEYS`). That
 * module is Deno-native and sits outside the pnpm workspace, so it cannot be
 * imported here; {@link challengeLabel} falls back for an unrecognised key so a
 * new server-side challenge degrades to a generic prompt instead of breaking.
 */
export const CHALLENGE_LABELS: Readonly<Record<string, string>> = {
  spouse_first_name: "A spouse's first name",
  parent_first_name: "A parent's first name",
  birth_place: "Place of birth",
  birth_day: "Day of the month you were born",
};

export function challengeLabel(key: string): string {
  return CHALLENGE_LABELS[key] ?? "Answer the question";
}

/** One opaque candidate from `search`: an id and which facts it can be asked. */
export interface OnboardingCandidate {
  readonly personId: string;
  readonly challenges: readonly string[];
}

/**
 * `verify` outcomes (`matcher.ts` — `VerifyStatus`). `"unknown"` guards a status
 * this build does not recognise; the flow treats it like `no_match` and routes
 * to request-access.
 */
export type VerifyOutcome =
  | "linked"
  | "no_match"
  | "already_claimed"
  | "already_linked"
  | "rate_limited"
  | "unknown";

/**
 * The verify statuses this build recognises — everything in {@link VerifyOutcome}
 * except the `"unknown"` guard. A parity test (`onboarding-parity.test.ts`)
 * checks this against `matcher.ts` `VerifyStatus`.
 */
export const KNOWN_OUTCOMES: ReadonlySet<string> = new Set<VerifyOutcome>([
  "linked",
  "no_match",
  "already_claimed",
  "already_linked",
  "rate_limited",
]);

function identityBody(identity: OnboardingIdentity): Record<string, unknown> {
  return {
    givenName: identity.givenName,
    surname: identity.surname,
    birthYear: identity.birthYear,
    birthMonth: identity.birthMonth,
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/**
 * Step 1: find candidate nodes for the submitted identity. Returns opaque ids
 * and challenge keys only — never a name, date, or place (decision 24). An empty
 * list means no match.
 */
export async function searchOnboardingMatch(
  client: Db,
  identity: OnboardingIdentity,
): Promise<readonly OnboardingCandidate[]> {
  const { data, error } = await client.functions.invoke("onboarding-match", {
    body: { action: "search", ...identityBody(identity) },
  });
  if (error !== null) {
    throw new Error(`searchOnboardingMatch: ${error.message}`);
  }

  const payload = asRecord(data);
  const rawCandidates = payload === null ? null : payload.candidates;
  if (!Array.isArray(rawCandidates)) {
    throw new Error("searchOnboardingMatch: unexpected response shape");
  }

  return rawCandidates.flatMap((raw): OnboardingCandidate[] => {
    const record = asRecord(raw);
    const personId = record?.personId;
    if (typeof personId !== "string") {
      return [];
    }
    const challenges = Array.isArray(record?.challenges)
      ? record.challenges.filter((c): c is string => typeof c === "string")
      : [];
    return [{ personId, challenges }];
  });
}

/**
 * Step 2: answer the challenge for one candidate. Every business outcome is a
 * `status` string; a transport or auth failure throws.
 */
export async function verifyOnboardingMatch(
  client: Db,
  args: {
    readonly identity: OnboardingIdentity;
    readonly personId: string;
    readonly answers: Readonly<Record<string, string>>;
  },
): Promise<VerifyOutcome> {
  const { data, error } = await client.functions.invoke("onboarding-match", {
    body: {
      action: "verify",
      ...identityBody(args.identity),
      personId: args.personId,
      answers: args.answers,
    },
  });
  if (error !== null) {
    throw new Error(`verifyOnboardingMatch: ${error.message}`);
  }

  const status = asRecord(data)?.status;
  if (typeof status !== "string" || !KNOWN_OUTCOMES.has(status)) {
    return "unknown";
  }
  return status as VerifyOutcome;
}

/** Everything the request-access form collects. `accountId` is the caller's own. */
export interface AccessRequestInput {
  readonly accountId: string;
  readonly name: string;
  readonly birthMonth: number | null;
  readonly birthYear: number | null;
  readonly message: string;
}

/**
 * File a `pending` access_request for the caller's own account (SPEC §9.3). The
 * `notify_access_requested` trigger raises the moderator notification.
 */
export async function submitAccessRequest(
  client: Db,
  input: AccessRequestInput,
): Promise<void> {
  const row: AccessRequestInsert = {
    account_id: input.accountId,
    submitted_name: input.name.trim() === "" ? null : input.name.trim(),
    submitted_birth_month: input.birthMonth,
    submitted_birth_year: input.birthYear,
    message: input.message.trim() === "" ? null : input.message.trim(),
  };
  const { error } = await client.from("access_request").insert(row);
  if (error !== null) {
    throw new Error(`submitAccessRequest: ${error.message}`);
  }
}
