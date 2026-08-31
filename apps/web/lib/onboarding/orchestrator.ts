/**
 * The `/onboarding` self-claim flow as a pure state machine, separate from React
 * so the identify → search → challenge → verify → (link | request-access)
 * sequence unit-tests without a DOM or a live stack. `useOnboarding` wires this
 * to the `lib/db/onboarding` calls and the router.
 *
 * SPEC §9.3 / decision 24: no candidate list is ever shown. `search` returns
 * opaque ids and challenge keys; the flow challenges the top candidate only. A
 * miss (or a claimed node, or the attempt cap) routes to the request-access
 * form — a moderator sorts out the rarer multi-candidate collision.
 */

import type {
  OnboardingCandidate,
  OnboardingIdentity,
  VerifyOutcome,
} from "@/lib/db";

// --- flow state -------------------------------------------------------

export type OnboardingState =
  | { readonly status: "identify"; readonly error: string | null }
  | { readonly status: "searching"; readonly identity: OnboardingIdentity }
  | {
      readonly status: "challenge";
      readonly identity: OnboardingIdentity;
      readonly personId: string;
      readonly challenges: readonly string[];
      readonly error: string | null;
    }
  | {
      readonly status: "verifying";
      readonly identity: OnboardingIdentity;
      readonly personId: string;
      readonly challenges: readonly string[];
    }
  | { readonly status: "no_match"; readonly identity: OnboardingIdentity }
  | { readonly status: "linked" }
  | { readonly status: "approved_already" }
  | {
      readonly status: "request_access";
      readonly identity: OnboardingIdentity | null;
      readonly error: string | null;
    }
  | {
      readonly status: "requesting";
      readonly identity: OnboardingIdentity | null;
    }
  | {
      readonly status: "requested";
      readonly reason: "self" | "rate_limited";
    };

export type OnboardingAction =
  | { readonly type: "search_submitted"; readonly identity: OnboardingIdentity }
  | {
      readonly type: "search_resolved";
      readonly candidates: readonly OnboardingCandidate[];
    }
  | { readonly type: "search_failed"; readonly message: string }
  | { readonly type: "verify_submitted" }
  | { readonly type: "verify_resolved"; readonly outcome: VerifyOutcome }
  | { readonly type: "verify_failed"; readonly message: string }
  | { readonly type: "request_access_chosen" }
  | { readonly type: "restart" }
  | { readonly type: "request_submitted" }
  | { readonly type: "request_succeeded" }
  | { readonly type: "request_failed"; readonly message: string };

/**
 * Initial state. On an invite-only tree (`allow_self_signup = false`) the claim
 * path is not offered at all — the visitor lands straight on request-access
 * (SPEC §9.3).
 */
export function makeInitialOnboardingState(
  allowSelfSignup: boolean,
): OnboardingState {
  return allowSelfSignup
    ? { status: "identify", error: null }
    : { status: "request_access", identity: null, error: null };
}

export function onboardingReducer(
  state: OnboardingState,
  action: OnboardingAction,
): OnboardingState {
  switch (action.type) {
    case "search_submitted":
      return state.status === "identify"
        ? { status: "searching", identity: action.identity }
        : state;

    case "search_resolved": {
      if (state.status !== "searching") {
        return state;
      }
      const top = action.candidates[0];
      if (top === undefined) {
        return { status: "no_match", identity: state.identity };
      }
      return {
        status: "challenge",
        identity: state.identity,
        personId: top.personId,
        challenges: top.challenges,
        error: null,
      };
    }

    case "search_failed":
      return state.status === "searching"
        ? { status: "identify", error: action.message }
        : state;

    case "verify_submitted":
      return state.status === "challenge"
        ? {
            status: "verifying",
            identity: state.identity,
            personId: state.personId,
            challenges: state.challenges,
          }
        : state;

    case "verify_resolved":
      return state.status === "verifying"
        ? resolveVerify(state, action.outcome)
        : state;

    case "verify_failed":
      return state.status === "verifying"
        ? {
            status: "challenge",
            identity: state.identity,
            personId: state.personId,
            challenges: state.challenges,
            error: action.message,
          }
        : state;

    case "request_access_chosen":
      return state.status === "no_match"
        ? { status: "request_access", identity: state.identity, error: null }
        : state;

    case "restart":
      return state.status === "no_match" || state.status === "request_access"
        ? { status: "identify", error: null }
        : state;

    case "request_submitted":
      return state.status === "request_access"
        ? { status: "requesting", identity: state.identity }
        : state;

    case "request_succeeded":
      return state.status === "requesting"
        ? { status: "requested", reason: "self" }
        : state;

    case "request_failed":
      return state.status === "requesting"
        ? {
            status: "request_access",
            identity: state.identity,
            error: action.message,
          }
        : state;

    default:
      return assertNever(action);
  }
}

/**
 * Map a `verify` outcome onto the next state. `unknown` and `already_claimed`
 * both fall to `no_match` — the safe route, sending the visitor to
 * request-access. `rate_limited` is terminal: the edge function has already
 * filed the access_request and notified moderators (SPEC §7).
 */
function resolveVerify(
  state: Extract<OnboardingState, { status: "verifying" }>,
  outcome: VerifyOutcome,
): OnboardingState {
  switch (outcome) {
    case "linked":
      return { status: "linked" };
    case "already_linked":
      return { status: "approved_already" };
    case "rate_limited":
      return { status: "requested", reason: "rate_limited" };
    case "no_match":
    case "already_claimed":
    case "unknown":
      return { status: "no_match", identity: state.identity };
    default:
      return assertNever(outcome);
  }
}

function assertNever(value: never): never {
  throw new Error(`Unhandled onboarding case: ${JSON.stringify(value)}`);
}
