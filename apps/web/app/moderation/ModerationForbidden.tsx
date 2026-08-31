/**
 * Shown when a signed-in account is not an active moderator. RLS rejects the
 * same account server-side — this is only the friendly surface.
 */
export function ModerationForbidden() {
  return (
    <main className="mx-auto flex max-w-2xl flex-1 flex-col justify-center gap-4 px-6 py-24">
      <h1 className="text-3xl font-semibold tracking-tight">Moderation</h1>
      <p className="text-muted-foreground text-lg">
        The moderation tools need moderator access. Ask an administrator to
        raise your role, then reload this page.
      </p>
    </main>
  );
}
