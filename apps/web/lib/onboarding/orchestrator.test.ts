import { describe, expect, it } from "vitest";

import type {
  OnboardingCandidate,
  OnboardingIdentity,
  VerifyOutcome,
} from "@/lib/db";

import {
  makeInitialOnboardingState,
  type OnboardingAction,
  type OnboardingState,
  onboardingReducer,
} from "./orchestrator";

const IDENTITY: OnboardingIdentity = {
  givenName: "Ada",
  surname: "Ashby",
  birthYear: 1901,
  birthMonth: 6,
};

const CANDIDATE: OnboardingCandidate = {
  personId: "d1000000-0000-0000-0000-000000000001",
  challenges: ["parent_first_name", "birth_place"],
};

function run(
  start: OnboardingState,
  actions: readonly OnboardingAction[],
): OnboardingState {
  return actions.reduce(onboardingReducer, start);
}

describe("makeInitialOnboardingState", () => {
  it("starts on identify when self-signup is allowed", () => {
    expect(makeInitialOnboardingState(true).status).toBe("identify");
  });

  it("starts on request-access when self-signup is off", () => {
    const state = makeInitialOnboardingState(false);
    expect(state.status).toBe("request_access");
    if (state.status === "request_access") {
      expect(state.identity).toBeNull();
    }
  });
});

describe("search", () => {
  const identifying = makeInitialOnboardingState(true);

  it("identify → searching on submit", () => {
    const state = onboardingReducer(identifying, {
      type: "search_submitted",
      identity: IDENTITY,
    });
    expect(state).toEqual({ status: "searching", identity: IDENTITY });
  });

  it("searching → challenge with the top candidate", () => {
    const state = run(identifying, [
      { type: "search_submitted", identity: IDENTITY },
      {
        type: "search_resolved",
        candidates: [CANDIDATE, { ...CANDIDATE, personId: "other" }],
      },
    ]);
    expect(state).toMatchObject({
      status: "challenge",
      personId: CANDIDATE.personId,
      challenges: CANDIDATE.challenges,
    });
  });

  it("searching → no_match on an empty candidate list", () => {
    const state = run(identifying, [
      { type: "search_submitted", identity: IDENTITY },
      { type: "search_resolved", candidates: [] },
    ]);
    expect(state).toEqual({ status: "no_match", identity: IDENTITY });
  });

  it("searching → identify with the error on failure", () => {
    const state = run(identifying, [
      { type: "search_submitted", identity: IDENTITY },
      { type: "search_failed", message: "network down" },
    ]);
    expect(state).toEqual({ status: "identify", error: "network down" });
  });

  it("ignores a second submit while a search is running", () => {
    const searching = onboardingReducer(identifying, {
      type: "search_submitted",
      identity: IDENTITY,
    });
    expect(
      onboardingReducer(searching, {
        type: "search_submitted",
        identity: IDENTITY,
      }),
    ).toBe(searching);
  });
});

describe("verify", () => {
  const challenging = run(makeInitialOnboardingState(true), [
    { type: "search_submitted", identity: IDENTITY },
    { type: "search_resolved", candidates: [CANDIDATE] },
  ]);

  const outcomes: ReadonlyArray<{
    outcome: VerifyOutcome;
    status: OnboardingState["status"];
  }> = [
    { outcome: "linked", status: "linked" },
    { outcome: "no_match", status: "no_match" },
    { outcome: "already_claimed", status: "no_match" },
    { outcome: "already_linked", status: "approved_already" },
    { outcome: "rate_limited", status: "requested" },
    { outcome: "unknown", status: "no_match" },
  ];

  for (const { outcome, status } of outcomes) {
    it(`${outcome} → ${status}`, () => {
      const state = run(challenging, [
        { type: "verify_submitted" },
        { type: "verify_resolved", outcome },
      ]);
      expect(state.status).toBe(status);
    });
  }

  it("rate_limited records why the request screen shows", () => {
    const state = run(challenging, [
      { type: "verify_submitted" },
      { type: "verify_resolved", outcome: "rate_limited" },
    ]);
    expect(state).toEqual({ status: "requested", reason: "rate_limited" });
  });

  it("verify_failed returns to the challenge with the error and posed set intact", () => {
    const state = run(challenging, [
      { type: "verify_submitted" },
      { type: "verify_failed", message: "timeout" },
    ]);
    expect(state).toEqual({
      status: "challenge",
      identity: IDENTITY,
      personId: CANDIDATE.personId,
      challenges: CANDIDATE.challenges,
      error: "timeout",
    });
  });
});

describe("no-match branches", () => {
  const noMatch: OnboardingState = { status: "no_match", identity: IDENTITY };

  it("request_access_chosen carries the identity into the form", () => {
    expect(
      onboardingReducer(noMatch, { type: "request_access_chosen" }),
    ).toEqual({ status: "request_access", identity: IDENTITY, error: null });
  });

  it("restart clears back to identify", () => {
    expect(onboardingReducer(noMatch, { type: "restart" })).toEqual({
      status: "identify",
      error: null,
    });
  });
});

describe("request access", () => {
  it("submitted → requesting → requested", () => {
    const state = run(makeInitialOnboardingState(false), [
      { type: "request_submitted" },
      { type: "request_succeeded" },
    ]);
    expect(state).toEqual({ status: "requested", reason: "self" });
  });

  it("a failure returns to the form with the error", () => {
    const state = run(makeInitialOnboardingState(false), [
      { type: "request_submitted" },
      { type: "request_failed", message: "row rejected" },
    ]);
    expect(state).toEqual({
      status: "request_access",
      identity: null,
      error: "row rejected",
    });
  });

  it("restart from the form goes back to identify (a misclick is not a dead end)", () => {
    const onForm: OnboardingState = {
      status: "request_access",
      identity: IDENTITY,
      error: null,
    };
    expect(onboardingReducer(onForm, { type: "restart" })).toEqual({
      status: "identify",
      error: null,
    });
  });
});

describe("a full matched run", () => {
  it("identify → search → challenge → verify → linked", () => {
    const state = run(makeInitialOnboardingState(true), [
      { type: "search_submitted", identity: IDENTITY },
      { type: "search_resolved", candidates: [CANDIDATE] },
      { type: "verify_submitted" },
      { type: "verify_resolved", outcome: "linked" },
    ]);
    expect(state).toEqual({ status: "linked" });
  });
});
