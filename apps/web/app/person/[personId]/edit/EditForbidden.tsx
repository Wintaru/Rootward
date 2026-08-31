import Link from "next/link";

/**
 * Shown when a signed-in, approved account is not an active moderator. RLS
 * rejects the same account server-side for the write path — this is only the
 * friendly surface (mirrors `ModerationForbidden` / `ImportForbidden`).
 */
export function EditForbidden({ personId }: { readonly personId: string }) {
  return (
    <main className="mx-auto flex max-w-2xl flex-1 flex-col justify-center gap-4 px-6 py-24">
      <h1 className="text-3xl font-semibold tracking-tight">Editing</h1>
      <p className="text-muted-foreground text-lg">
        Editing needs moderator access. Ask an administrator to raise your role,
        then reload this page.
      </p>
      <Link
        href={`/person/${personId}`}
        className="text-muted-foreground hover:text-foreground w-fit text-sm"
      >
        ← Back to the profile
      </Link>
    </main>
  );
}
