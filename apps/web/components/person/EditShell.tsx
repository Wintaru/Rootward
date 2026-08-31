import Link from "next/link";
import type { ReactNode } from "react";

import type { EditRelativeLine, EditShellView } from "@/lib/edit/view-model";

/**
 * Presentational edit-view shell (SPEC §8.3, §10 item 26). Full-screen,
 * MacFamilyTree-style: parents on top, the section rail on the left, the
 * active section's content in the middle, partners + children on the bottom.
 * Every string comes from `buildEditShellView` — this file only lays them
 * out, and section switching / relative navigation are plain links (the URL
 * is the state, same convention as the tree view's `?up`/`?down`), so this
 * stays a server component with no client-side machinery of its own.
 *
 * `sectionContent` is the active section's real content once its issue has
 * built it (#27–#32); `page.tsx` decides which component that is and fetches
 * its data. A section not yet built (still `undefined`) falls back to the
 * placeholder.
 */
export function EditShell({
  view,
  sectionContent,
}: {
  readonly view: EditShellView;
  readonly sectionContent?: ReactNode;
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="border-border flex flex-col gap-3 border-b px-6 py-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-col gap-1">
            <h1 className="text-xl font-semibold tracking-tight">
              {view.displayName}
            </h1>
            {view.subtitle !== null && (
              <p className="text-muted-foreground text-sm">{view.subtitle}</p>
            )}
          </div>
          <Link
            href={view.profileHref}
            className="border-border hover:bg-accent rounded-md border px-3 py-1.5 text-sm font-medium"
          >
            Done
          </Link>
        </div>
        <RelativesStrip
          label="Parents"
          people={view.parents}
          empty="No parents recorded."
        />
      </header>

      <div className="flex min-h-0 flex-1">
        <nav
          aria-label="Edit sections"
          className="border-border w-56 shrink-0 overflow-y-auto border-r py-4"
        >
          <ul className="flex flex-col gap-0.5 px-2">
            {view.sections.map((section) => (
              <li key={section.slug}>
                <Link
                  href={section.href}
                  aria-current={section.isActive ? "page" : undefined}
                  className={
                    "block rounded-md px-3 py-2 text-sm font-medium " +
                    (section.isActive
                      ? "bg-accent text-foreground"
                      : "text-muted-foreground hover:bg-accent hover:text-foreground")
                  }
                >
                  {section.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>

        <main className="flex flex-1 flex-col overflow-y-auto px-6 py-8">
          <h2 className="text-lg font-semibold tracking-tight">
            {view.activeSection.label}
          </h2>
          {sectionContent === undefined ? (
            <p className="text-muted-foreground mt-2 text-sm">
              This section is not built yet.
            </p>
          ) : (
            <div className="mt-4">{sectionContent}</div>
          )}
        </main>
      </div>

      <footer className="border-border border-t px-6 py-4">
        <RelativesStrip
          label="Partners & children"
          people={view.partnersAndChildren}
          empty="No partners or children recorded."
        />
      </footer>
    </div>
  );
}

function RelativesStrip({
  label,
  people,
  empty,
}: {
  readonly label: string;
  readonly people: readonly EditRelativeLine[];
  readonly empty: string;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <h3 className="text-muted-foreground text-xs font-semibold uppercase tracking-wide">
        {label}
      </h3>
      {people.length === 0 ? (
        <p className="text-muted-foreground text-sm">{empty}</p>
      ) : (
        <ul className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
          {people.map((person) => (
            <li key={person.id}>
              <Link href={person.href} className="hover:underline">
                {person.name}
              </Link>
              {person.lifespan !== null && (
                <span className="text-muted-foreground">
                  {" "}
                  ({person.lifespan})
                </span>
              )}
              {person.detail !== null && (
                <span className="text-muted-foreground">
                  {" "}
                  · {person.detail}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
