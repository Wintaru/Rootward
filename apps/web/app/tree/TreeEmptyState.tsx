import Link from "next/link";

interface TreeEmptyStateProps {
  /** `true` for an active moderator or admin — the only roles that may import. */
  readonly canImport: boolean;
}

/**
 * `/tree` when there is nobody to show (SPEC §8.1, issue #51): a fresh
 * deployment before the first import, or a tree whose every person is hidden
 * from this viewer (RLS decides, so the two cases look the same here — never
 * leak which).
 *
 * "Add the first person" is deliberately absent until `/person/new` exists
 * (#55); a link to a 404 would be the exact defect this route fixes.
 */
export function TreeEmptyState({ canImport }: TreeEmptyStateProps) {
  return (
    <main className="mx-auto flex max-w-2xl flex-1 flex-col justify-center gap-4 px-6 py-24">
      <h1 className="text-3xl font-semibold tracking-tight">
        This tree has no people yet
      </h1>
      {canImport ? (
        <>
          <p className="text-muted-foreground text-lg">
            Import a GEDCOM file to fill it. The first person in the file
            becomes the root the tree opens on — an admin can change that later
            in Settings.
          </p>
          <Link
            href="/import"
            className="bg-primary text-primary-foreground w-fit rounded-md px-4 py-2 text-sm font-medium"
          >
            Import a GEDCOM
          </Link>
        </>
      ) : (
        <p className="text-muted-foreground text-lg">
          A moderator can import a GEDCOM file to fill it. Check back once they
          have.
        </p>
      )}
    </main>
  );
}
