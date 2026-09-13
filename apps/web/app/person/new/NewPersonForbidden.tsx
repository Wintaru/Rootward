/**
 * Shown when a signed-in, approved account is not an active moderator. RLS
 * (`person_insert`) rejects the same account server-side — this is only the
 * friendly surface, same posture as `EditForbidden` / `ImportForbidden`.
 */
export function NewPersonForbidden() {
  return (
    <main className="mx-auto flex max-w-2xl flex-1 flex-col justify-center gap-4 px-6 py-24">
      <h1 className="text-3xl font-semibold tracking-tight">New person</h1>
      <p className="text-muted-foreground text-lg">
        Creating a person needs moderator access. Ask an administrator to raise
        your role, then reload this page.
      </p>
    </main>
  );
}
