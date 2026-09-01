import Link from "next/link";

import type { MediaDetailView } from "@/lib/media/view-model";

/**
 * Presentational `/media/[mediaId]` viewer (SPEC §8.3, §10 item 34). Every
 * string and URL comes from `buildMediaDetailView` — this file only lays
 * them out, mirroring `PersonProfile`'s server-component-with-no-state
 * shape.
 */
export function MediaViewer({ view }: { readonly view: MediaDetailView }) {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 px-6 py-12">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">{view.title}</h1>
        <p className="text-muted-foreground text-sm">
          {[view.date, view.mimeType, view.sizeLabel]
            .filter((part): part is string => part !== null)
            .join(" · ")}
        </p>
      </header>

      <div className="bg-muted flex items-center justify-center overflow-hidden rounded-lg">
        {view.imageUrl !== null ? (
          // eslint-disable-next-line @next/next/no-img-element -- a signed storage URL, not a static asset `next/image` can optimize
          <img
            src={view.imageUrl}
            alt={view.title}
            className="max-h-[70vh] w-full object-contain"
          />
        ) : (
          <p className="text-muted-foreground p-12 text-sm">
            This file type can&rsquo;t be shown here.
          </p>
        )}
      </div>

      {view.downloadUrl !== null && (
        <a
          href={view.downloadUrl}
          className="border-border hover:bg-accent w-fit rounded-md border px-3 py-1.5 text-sm font-medium"
        >
          Download original
        </a>
      )}

      {view.links.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="text-lg font-semibold tracking-tight">
            Linked records
          </h2>
          <ul className="flex flex-col gap-2 text-sm">
            {view.links.map((link) => (
              <li key={link.id} className="flex flex-col">
                <span>
                  {link.href !== null ? (
                    <Link href={link.href} className="hover:underline">
                      {link.label}
                    </Link>
                  ) : (
                    link.label
                  )}
                  {link.isPrimary && (
                    <span className="text-muted-foreground"> · primary</span>
                  )}
                </span>
                {link.caption !== null && (
                  <span className="text-muted-foreground">{link.caption}</span>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}
