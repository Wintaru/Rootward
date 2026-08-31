import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { resolveOnboardingStage } from "@/lib/auth/access";
import { getCurrentAccount } from "@/lib/auth/current-account";
import { getAllowSelfSignup } from "@/lib/db";
import { createSupabaseServerClient } from "@/lib/supabase/server";

import { OnboardingSuspended } from "./OnboardingSuspended";
import { OnboardingWorkspace } from "./OnboardingWorkspace";

export const metadata: Metadata = {
  title: "Join the tree · Rootward",
};

/**
 * `/onboarding` — signed-in but not yet approved (SPEC §8.1 / §9.3). An approved
 * member is bounced to `/` (the tree); a suspended one sees a notice. Reading
 * the session makes this route dynamic.
 */
export default async function OnboardingPage() {
  const current = await getCurrentAccount();
  if (current === null) {
    redirect("/login");
  }

  const stage = resolveOnboardingStage(current.account);
  if (stage.kind === "approved") {
    redirect("/");
  }
  if (stage.kind === "suspended") {
    return <OnboardingSuspended />;
  }

  const allowSelfSignup = await getAllowSelfSignup(
    await createSupabaseServerClient(),
  );

  return (
    <OnboardingWorkspace
      accountId={current.userId}
      allowSelfSignup={allowSelfSignup}
    />
  );
}
