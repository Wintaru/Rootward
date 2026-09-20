import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";

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
 * "Add the first person" (#55) links to `/person/new`; a moderator who adds
 * one this way still has no default root until an admin sets one in
 * Settings, or a later import does.
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
            Import a GEDCOM file to fill it, or add the first person yourself. A
            GEDCOM&apos;s first person becomes the root the tree opens on — an
            admin can change that later in Settings.
          </p>
          <div className="flex gap-3">
            <Link
              href="/import"
              className={buttonVariants({ className: "w-fit" })}
            >
              Import a GEDCOM
            </Link>
            <Link
              href="/person/new"
              className={buttonVariants({
                variant: "outline",
                className: "w-fit",
              })}
            >
              Add the first person
            </Link>
          </div>
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
