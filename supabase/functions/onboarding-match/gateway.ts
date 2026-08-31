/**
 * {@link MatchGateway} backed by a service-role Supabase client — the only file
 * besides `index.ts` that talks to the database. The engine (`matcher.ts`)
 * stays driver-free and portable.
 *
 * Service role bypasses RLS deliberately: the caller is a signed-in but
 * not-yet-approved account, so a normal client could read none of this. The
 * engine is what keeps identifying data out of the response.
 */

import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";

import type {
  AccessRequestInput,
  AccountRow,
  CandidateRow,
  ChallengeProfile,
  LinkOutcome,
  MatchGateway,
  NotificationType,
  SearchInput,
} from "./matcher.ts";

/** Postgres unique-violation SQLSTATE — a lost race to claim the same node. */
const UNIQUE_VIOLATION = "23505";

interface FamilyPartners {
  partner1_id: string | null;
  partner2_id: string | null;
}

/** Await a PostgREST query builder, throw on error, default a null list to `[]`. */
async function listRows<T>(
  builder: PromiseLike<{ data: unknown; error: PostgrestError | null }>,
  context: string,
): Promise<T[]> {
  const { data, error } = await builder;
  if (error !== null) {
    throw new Error(`${context}: ${error.message}`);
  }
  return (data ?? []) as T[];
}

export function createMatchGateway(supabase: SupabaseClient): MatchGateway {
  async function givenNames(ids: readonly string[]): Promise<string[]> {
    if (ids.length === 0) return [];
    const rows = await listRows<{ given_name: string | null }>(
      supabase.from("person").select("given_name").in("id", ids),
      "load parent/spouse names",
    );
    return rows
      .map((row) => row.given_name)
      .filter((name): name is string => name !== null && name.trim() !== "");
  }

  return {
    async loadAccount(accountId: string): Promise<AccountRow | null> {
      const { data, error } = await supabase
        .from("account")
        .select("id,status,person_id")
        .eq("id", accountId)
        .maybeSingle();
      if (error !== null) {
        throw new Error(`load account ${accountId}: ${error.message}`);
      }
      if (data === null) return null;
      const row = data as {
        id: string;
        status: string;
        person_id: string | null;
      };
      return { id: row.id, status: row.status, person_id: row.person_id };
    },

    async searchCandidates(
      input: SearchInput,
      threshold: number,
    ): Promise<readonly CandidateRow[]> {
      const { data, error } = await supabase.rpc("onboarding_match_search", {
        p_given_name: input.givenName,
        p_surname: input.surname,
        p_birth_year: input.birthYear,
        p_birth_month: input.birthMonth,
        p_threshold: threshold,
      });
      if (error !== null) {
        throw new Error(`onboarding_match_search: ${error.message}`);
      }
      const rows = (data ?? []) as { person_id: string; score: number }[];
      return rows.map((row) => ({
        personId: row.person_id,
        score: Number(row.score),
      }));
    },

    async loadChallengeProfile(personId: string): Promise<ChallengeProfile> {
      // Separate reads, not one join: this runs once per onboarding claim, so
      // clarity wins over shaving round trips. Each filter is a PK or an
      // indexed FK column.
      const childOf = await listRows<{ family_id: string }>(
        supabase
          .from("family_child")
          .select("family_id")
          .eq("person_id", personId),
        "load child-of families",
      );
      const parentFamilyIds = childOf.map((row) => row.family_id);

      const parentFamilies = parentFamilyIds.length > 0
        ? await listRows<FamilyPartners>(
          supabase
            .from("family")
            .select("partner1_id,partner2_id")
            .in("id", parentFamilyIds),
          "load parent families",
        )
        : [];
      const spouseFamilies = await listRows<FamilyPartners>(
        supabase
          .from("family")
          .select("partner1_id,partner2_id")
          .or(`partner1_id.eq.${personId},partner2_id.eq.${personId}`),
        "load spouse families",
      );

      const births = await listRows<{
        date_day1: number | null;
        place_id: string | null;
      }>(
        supabase
          .from("event")
          .select("date_day1,place_id")
          .eq("person_id", personId)
          .eq("owner_type", "person")
          .eq("type", "birth"),
        "load birth events",
      );
      const birthDays = unique(
        births
          .map((row) => row.date_day1)
          .filter((day): day is number => day !== null),
      );
      const placeIds = unique(
        births
          .map((row) => row.place_id)
          .filter((id): id is string => id !== null),
      );
      // name / normalized_name / locality only — a `county` or `state` answer
      // must not clear the birth_place challenge (see matcher.ts placeAnswers).
      const placeRows = placeIds.length > 0
        ? await listRows<{
          name: string | null;
          normalized_name: string | null;
          locality: string | null;
        }>(
          supabase
            .from("place")
            .select("name,normalized_name,locality")
            .in("id", placeIds),
          "load birth places",
        )
        : [];
      const birthPlaceNames = placeRows
        .flatMap((place) => [place.name, place.normalized_name, place.locality])
        .filter(
          (value): value is string => value !== null && value.trim() !== "",
        );

      return {
        parentGivenNames: await givenNames(
          partnerIds(parentFamilies, personId),
        ),
        spouseGivenNames: await givenNames(
          partnerIds(spouseFamilies, personId),
        ),
        birthPlaceNames,
        birthDays,
      };
    },

    async claimedPersonIds(
      personIds: readonly string[],
    ): Promise<ReadonlySet<string>> {
      if (personIds.length === 0) return new Set();
      const rows = await listRows<{ person_id: string | null }>(
        supabase.from("account").select("person_id").in("person_id", personIds),
        "claimedPersonIds",
      );
      return new Set(
        rows
          .map((row) => row.person_id)
          .filter((id): id is string => id !== null),
      );
    },

    async countRecentAttempts(
      accountId: string,
      sinceIso: string,
    ): Promise<number> {
      const { count, error } = await supabase
        .from("claim_attempt")
        .select("id", { count: "exact", head: true })
        .eq("account_id", accountId)
        .gt("attempted_at", sinceIso);
      if (error !== null) {
        throw new Error(`countRecentAttempts ${accountId}: ${error.message}`);
      }
      return count ?? 0;
    },

    async recordAttempt(accountId: string, succeeded: boolean): Promise<void> {
      const { error } = await supabase
        .from("claim_attempt")
        .insert({ account_id: accountId, succeeded });
      if (error !== null) {
        throw new Error(`recordAttempt ${accountId}: ${error.message}`);
      }
    },

    async linkAccount(
      accountId: string,
      personId: string,
    ): Promise<LinkOutcome> {
      // `status = 'pending'` in the filter: a suspended or already-active row
      // must never be resurrected here, even past the engine's own check.
      const { data, error } = await supabase
        .from("account")
        .update({ person_id: personId, status: "active" })
        .eq("id", accountId)
        .eq("status", "pending")
        .select("id");
      if (error !== null) {
        if (error.code === UNIQUE_VIOLATION) return "conflict";
        throw new Error(`linkAccount ${accountId}: ${error.message}`);
      }
      return (data ?? []).length > 0 ? "linked" : "conflict";
    },

    async hasOpenAccessRequest(accountId: string): Promise<boolean> {
      const { count, error } = await supabase
        .from("access_request")
        .select("id", { count: "exact", head: true })
        .eq("account_id", accountId)
        .eq("status", "pending");
      if (error !== null) {
        throw new Error(`hasOpenAccessRequest ${accountId}: ${error.message}`);
      }
      return (count ?? 0) > 0;
    },

    async createAccessRequest(input: AccessRequestInput): Promise<void> {
      const { error } = await supabase.from("access_request").insert({
        account_id: input.accountId,
        submitted_name: input.submittedName,
        submitted_birth_month: input.submittedBirthMonth,
        submitted_birth_year: input.submittedBirthYear,
        message: input.message,
      });
      if (error !== null) {
        throw new Error(`createAccessRequest: ${error.message}`);
      }
    },

    async createNotification(
      type: NotificationType,
      payload: Record<string, unknown>,
    ): Promise<void> {
      const { error } = await supabase
        .from("notification")
        .insert({ type, payload });
      if (error !== null) {
        throw new Error(`create ${type} notification: ${error.message}`);
      }
    },
  };
}

function partnerIds(
  families: readonly FamilyPartners[],
  exclude: string,
): string[] {
  return unique(
    families
      .flatMap((family) => [family.partner1_id, family.partner2_id])
      .filter((id): id is string => id !== null && id !== exclude),
  );
}

function unique<T>(values: readonly T[]): T[] {
  return [...new Set(values)];
}
