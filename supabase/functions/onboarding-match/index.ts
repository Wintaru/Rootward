/**
 * `onboarding-match` edge function (SPEC §7, §9.3, decision 24) — the Deno
 * runtime shell.
 *
 * Thin on purpose: verify the caller is signed in, build the service-role
 * gateway, hand off to {@link runSearch} / {@link runVerify}. All matching
 * logic lives in the portable `matcher.ts`, which the test suite drives
 * directly.
 *
 * Auth: any authenticated user (the caller is a *pending* account — not yet a
 * member — so there is no role check). `account.id` is the `auth.users` id.
 *
 * Request 1 — find candidates, get challenge metadata (no identifying data):
 *   `POST { "action": "search", "givenName", "surname", "birthYear", "birthMonth"? }`
 *   → `{ "candidates": [{ "personId", "challenges": [...] }] }`
 *
 * Request 2 — answer the challenge:
 *   `POST { "action": "verify", "personId", "givenName", "surname", "birthYear",
 *          "birthMonth"?, "answers": { "<challenge>": "<answer>" } }`
 *   → `{ "status": "linked" | "no_match" | "already_claimed" | "already_linked"
 *        | "rate_limited" }`
 *
 * Every outcome is HTTP 200 with a `status` — the `/onboarding` UI (#19)
 * switches on it. Malformed input is 400; an unauthenticated caller is 401.
 */

import { createClient } from "@supabase/supabase-js";

import { createMatchGateway } from "./gateway.ts";
import {
  CHALLENGE_KEYS,
  type ChallengeKey,
  runSearch,
  runVerify,
  type SearchInput,
} from "./matcher.ts";

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

function requireEnv(name: string): string {
  const value = Deno.env.get(name);
  if (value === undefined || value === "") {
    throw new Error(`missing env ${name}`);
  }
  return value;
}

// --- request parsing --------------------------------------------------

interface Identity {
  readonly givenName: string;
  readonly surname: string;
  readonly birthYear: number;
  readonly birthMonth: number | null;
}

interface SearchRequest extends Identity {
  readonly action: "search";
}

interface VerifyRequest extends Identity {
  readonly action: "verify";
  readonly personId: string;
  readonly answers: Partial<Record<ChallengeKey, string>>;
}

type ParsedRequest = SearchRequest | VerifyRequest;

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** Rough genealogy range — also keeps `birthYear` inside Postgres `smallint`. */
const MIN_BIRTH_YEAR = 1;
const MAX_BIRTH_YEAR = 2200;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function parseIdentity(body: Record<string, unknown>): Identity | null {
  const { givenName, surname, birthYear, birthMonth } = body;
  if (typeof givenName !== "string" || givenName.trim() === "") return null;
  if (typeof surname !== "string" || surname.trim() === "") return null;
  if (typeof birthYear !== "number" || !Number.isInteger(birthYear)) {
    return null;
  }
  if (birthYear < MIN_BIRTH_YEAR || birthYear > MAX_BIRTH_YEAR) return null;
  const month = birthMonth === undefined || birthMonth === null
    ? null
    : birthMonth;
  if (
    month !== null &&
    (typeof month !== "number" || !Number.isInteger(month))
  ) {
    return null;
  }
  if (month !== null && (month < 1 || month > 12)) return null;
  return {
    givenName: givenName.trim(),
    surname: surname.trim(),
    birthYear,
    birthMonth: month,
  };
}

function parseAnswers(
  value: unknown,
): Partial<Record<ChallengeKey, string>> | null {
  const record = asRecord(value);
  if (record === null) return null;
  const answers: Partial<Record<ChallengeKey, string>> = {};
  for (const key of CHALLENGE_KEYS) {
    const answer = record[key];
    if (answer === undefined) continue;
    if (typeof answer !== "string") return null;
    answers[key] = answer;
  }
  return answers;
}

function parseRequest(body: unknown): ParsedRequest | null {
  const record = asRecord(body);
  if (record === null) return null;
  const identity = parseIdentity(record);
  if (identity === null) return null;

  if (record.action === "search") {
    return { action: "search", ...identity };
  }
  if (record.action === "verify") {
    // Must be a UUID: it is interpolated into a PostgREST `.or()` filter in the
    // gateway, so the boundary is where it gets constrained.
    if (typeof record.personId !== "string" || !UUID_RE.test(record.personId)) {
      return null;
    }
    const answers = parseAnswers(record.answers);
    if (answers === null) return null;
    return {
      action: "verify",
      ...identity,
      personId: record.personId,
      answers,
    };
  }
  return null;
}

// --- shell ---------------------------------------------------------

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: CORS_HEADERS });
  }
  if (req.method !== "POST") {
    return json({ error: "POST only" }, 405);
  }

  const supabaseUrl = requireEnv("SUPABASE_URL");
  const serviceRoleKey = requireEnv("SUPABASE_SERVICE_ROLE_KEY");
  const anonKey = requireEnv("SUPABASE_ANON_KEY");

  const token = (req.headers.get("Authorization") ?? "").replace(
    /^Bearer\s+/i,
    "",
  );
  if (token === "") {
    return json({ error: "unauthorized" }, 401);
  }

  const asUser = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: userData, error: userError } = await asUser.auth.getUser();
  if (userError !== null || userData.user === null) {
    return json({ error: "unauthorized" }, 401);
  }
  const accountId = userData.user.id;

  let parsed: ParsedRequest | null;
  try {
    parsed = parseRequest(await req.json());
  } catch {
    return json({ error: "invalid JSON body" }, 400);
  }
  if (parsed === null) {
    return json({ error: "invalid request" }, 400);
  }

  const service = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const gateway = createMatchGateway(service);
  const identity: SearchInput = {
    givenName: parsed.givenName,
    surname: parsed.surname,
    birthYear: parsed.birthYear,
    birthMonth: parsed.birthMonth,
  };

  try {
    if (parsed.action === "search") {
      return json(await runSearch({ gateway, input: identity }));
    }
    return json(
      await runVerify({
        gateway,
        input: {
          accountId,
          personId: parsed.personId,
          identity,
          answers: parsed.answers,
        },
      }),
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return json({ error: message }, 500);
  }
});
