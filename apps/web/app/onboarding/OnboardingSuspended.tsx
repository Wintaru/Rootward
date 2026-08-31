/**
 * Shown on `/onboarding` when the signed-in account is `suspended` — a
 * moderator has revoked access. Not a dead end the visitor can act out of, so
 * there is no form here (SPEC §9.4).
 */
export function OnboardingSuspended() {
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center gap-4 px-6 py-24">
      <h1 className="text-2xl font-semibold tracking-tight">Access paused</h1>
      <p className="text-muted-foreground text-sm">
        This account cannot browse the tree right now. If you think that is a
        mistake, contact a family administrator.
      </p>
    </main>
  );
}
