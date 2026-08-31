"use client";

import { useCallback, useEffect, useMemo, useReducer, useRef } from "react";

import { useRouter } from "next/navigation";

import {
  type OnboardingIdentity,
  searchOnboardingMatch,
  submitAccessRequest,
  verifyOnboardingMatch,
} from "@/lib/db";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

import {
  makeInitialOnboardingState,
  onboardingReducer,
  type OnboardingState,
} from "./orchestrator";

/** What the request-access form hands back — a superset of {@link OnboardingIdentity}. */
export interface AccessRequestValues {
  readonly name: string;
  readonly birthYear: number | null;
  readonly birthMonth: number | null;
  readonly message: string;
}

export interface UseOnboarding {
  readonly state: OnboardingState;
  /** Step 1: run the fuzzy match for a submitted identity. */
  readonly search: (identity: OnboardingIdentity) => void;
  /** Step 2: answer the challenge for the current candidate. */
  readonly answerChallenge: (answers: Readonly<Record<string, string>>) => void;
  /** From the no-match screen: switch to the request-access form. */
  readonly chooseRequestAccess: () => void;
  /** From the no-match screen: start over with a fresh identity. */
  readonly restart: () => void;
  /** Submit the request-access form. */
  readonly submitRequest: (values: AccessRequestValues) => void;
}

/**
 * Owns the `/onboarding` flow (SPEC §9.3): call `onboarding-match`, drive the
 * pure reducer, and — once the account is linked or was already approved — send
 * the visitor to `/`, which routes them into the tree. Rendering stays in the
 * component.
 *
 * @param accountId `auth.users` id of the signed-in, still-pending visitor —
 *   the `account_id` on any `access_request` they file.
 * @param allowSelfSignup `tree_settings.allow_self_signup`; `false` starts the
 *   flow on request-access with no claim path.
 */
export function useOnboarding(
  accountId: string,
  allowSelfSignup: boolean,
): UseOnboarding {
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const router = useRouter();
  const [state, dispatch] = useReducer(
    onboardingReducer,
    allowSelfSignup,
    makeInitialOnboardingState,
  );

  // One network call in flight at a time — a double-submit is ignored, not
  // raced.
  const inFlight = useRef(false);

  const run = useCallback(async (task: () => Promise<void>): Promise<void> => {
    if (inFlight.current) {
      return;
    }
    inFlight.current = true;
    try {
      await task();
    } finally {
      inFlight.current = false;
    }
  }, []);

  const search = useCallback(
    (identity: OnboardingIdentity) => {
      dispatch({ type: "search_submitted", identity });
      void run(async () => {
        try {
          const candidates = await searchOnboardingMatch(supabase, identity);
          dispatch({ type: "search_resolved", candidates });
        } catch (error: unknown) {
          dispatch({ type: "search_failed", message: messageOf(error) });
        }
      });
    },
    [run, supabase],
  );

  const answerChallenge = useCallback(
    (answers: Readonly<Record<string, string>>) => {
      const posed = state.status === "challenge" ? state : null;
      if (posed === null) {
        return;
      }
      dispatch({ type: "verify_submitted" });
      void run(async () => {
        try {
          const outcome = await verifyOnboardingMatch(supabase, {
            identity: posed.identity,
            personId: posed.personId,
            answers,
          });
          dispatch({ type: "verify_resolved", outcome });
        } catch (error: unknown) {
          dispatch({ type: "verify_failed", message: messageOf(error) });
        }
      });
    },
    [run, state, supabase],
  );

  const chooseRequestAccess = useCallback(() => {
    dispatch({ type: "request_access_chosen" });
  }, []);

  const restart = useCallback(() => {
    dispatch({ type: "restart" });
  }, []);

  const submitRequest = useCallback(
    (values: AccessRequestValues) => {
      dispatch({ type: "request_submitted" });
      void run(async () => {
        try {
          await submitAccessRequest(supabase, {
            accountId,
            name: values.name,
            birthMonth: values.birthMonth,
            birthYear: values.birthYear,
            message: values.message,
          });
          dispatch({ type: "request_succeeded" });
        } catch (error: unknown) {
          dispatch({ type: "request_failed", message: messageOf(error) });
        }
      });
    },
    [accountId, run, supabase],
  );

  // The account is active now (just linked, or it already was) — leave for `/`,
  // which resolves to the tree. `refresh()` drops the stale RSC session read.
  useEffect(() => {
    if (state.status === "linked" || state.status === "approved_already") {
      router.replace("/");
      router.refresh();
    }
  }, [router, state.status]);

  return {
    state,
    search,
    answerChallenge,
    chooseRequestAccess,
    restart,
    submitRequest,
  };
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
