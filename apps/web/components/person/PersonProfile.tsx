import Link from "next/link";
import type { ReactNode } from "react";

import type {
  PersonProfileView,
  RelationLine,
  TimelineEntry,
} from "@/lib/person/view-model";

/**
 * Presentational read-only profile (SPEC §8.1 `/person/[personId]`, §10 item
 * 25). Every string is prepared by `buildPersonProfileView` — this file only
 * lays them out. A server component: no state, no effects.
 */
export function PersonProfile({
  view,
  canEdit,
}: {
  readonly view: PersonProfileView;
  readonly canEdit: boolean;
}) {
  const subtitle = [
    view.sexLabel,
    view.lifespan,
    view.isLiving ? "Living" : null,
  ]
    .filter((part): part is string => part !== null)
    .join(" · ");

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-10 px-6 py-12">
      <header className="flex flex-col gap-3">
        <Link
          href={view.treeHref}
          className="text-muted-foreground hover:text-foreground w-fit text-sm"
        >
          ← Back to the tree
        </Link>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex flex-col gap-1">
            <h1 className="text-3xl font-semibold tracking-tight">
              {view.fullName || "Unknown person"}
            </h1>
            {subtitle !== "" && (
              <p className="text-muted-foreground text-sm">{subtitle}</p>
            )}
          </div>
          {canEdit && (
            <Link
              href={`/person/${view.id}/edit`}
              className="border-border hover:bg-accent rounded-md border px-3 py-1.5 text-sm font-medium"
            >
              Edit
            </Link>
          )}
        </div>
      </header>

      {view.names.length > 0 && (
        <Section title="Other names">
          <dl className="grid gap-2 sm:grid-cols-[10rem_1fr]">
            {view.names.map((name) => (
              <div key={name.id} className="contents">
                <dt className="text-muted-foreground text-sm">{name.label}</dt>
                <dd className="text-sm">{name.value}</dd>
              </div>
            ))}
          </dl>
        </Section>
      )}

      <Section title="Timeline" empty={view.timeline.length === 0}>
        <ol className="flex flex-col gap-4">
          {view.timeline.map((entry) => (
            <TimelineRow key={entry.id} entry={entry} />
          ))}
        </ol>
      </Section>

      {view.facts.length > 0 && (
        <Section title="Facts">
          <dl className="grid gap-3 sm:grid-cols-[10rem_1fr]">
            {view.facts.map((fact) => (
              <div key={fact.id} className="contents">
                <dt className="text-muted-foreground flex items-center gap-2 text-sm">
                  {fact.label}
                  {fact.restriction !== null && (
                    <span className="border-border text-muted-foreground rounded border px-1 text-[0.7rem] uppercase">
                      {fact.restriction}
                    </span>
                  )}
                </dt>
                <dd className="text-sm">
                  {fact.value ?? "—"}
                  {(fact.date !== null || fact.place !== null) && (
                    <span className="text-muted-foreground">
                      {" "}
                      ({[fact.date, fact.place].filter(Boolean).join(", ")})
                    </span>
                  )}
                </dd>
              </div>
            ))}
          </dl>
        </Section>
      )}

      <Section
        title="Relationships"
        empty={
          view.parents.length === 0 &&
          view.siblings.length === 0 &&
          view.partners.length === 0 &&
          view.children.length === 0
        }
      >
        <div className="flex flex-col gap-5">
          <RelationGroup label="Parents" people={view.parents} />
          <RelationGroup label="Siblings" people={view.siblings} />
          <RelationGroup label="Partners" people={view.partners} />
          <RelationGroup label="Children" people={view.children} />
        </div>
      </Section>

      {view.media.length > 0 && (
        <Section title="Media">
          <ul className="flex flex-col gap-2 text-sm">
            {view.media.map((item) => (
              <li key={item.id} className="flex flex-col">
                <span>
                  {item.label}
                  {item.isPrimary && (
                    <span className="text-muted-foreground"> · primary</span>
                  )}
                </span>
                {item.caption !== null && (
                  <span className="text-muted-foreground">{item.caption}</span>
                )}
              </li>
            ))}
          </ul>
        </Section>
      )}

      {view.sources.length > 0 && (
        <Section title="Sources">
          <ul className="flex flex-col gap-3 text-sm">
            {view.sources.map((source) => (
              <li key={source.id} className="flex flex-col">
                <span className="font-medium">{source.title}</span>
                {source.meta !== null && (
                  <span className="text-muted-foreground">{source.meta}</span>
                )}
                <span className="text-muted-foreground">
                  {[
                    source.page !== null ? `Page ${source.page}` : null,
                    source.quality,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {view.notes.length > 0 && (
        <Section title="Notes">
          <div className="flex flex-col gap-3 text-sm">
            {view.notes.map((note) => (
              <p key={note.id} className="whitespace-pre-wrap">
                {note.text}
              </p>
            ))}
          </div>
        </Section>
      )}
    </main>
  );
}

function Section({
  title,
  empty = false,
  children,
}: {
  readonly title: string;
  readonly empty?: boolean;
  readonly children: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
      {empty ? (
        <p className="text-muted-foreground text-sm">Nothing recorded yet.</p>
      ) : (
        children
      )}
    </section>
  );
}

function TimelineRow({ entry }: { readonly entry: TimelineEntry }) {
  return (
    <li className="border-border flex flex-col gap-0.5 border-l-2 pl-4">
      <span className="text-sm font-medium">
        {entry.title}
        {entry.date !== null && (
          <span className="text-muted-foreground font-normal">
            {" "}
            — {entry.date}
          </span>
        )}
      </span>
      {entry.place !== null && (
        <span className="text-muted-foreground text-sm">{entry.place}</span>
      )}
      {entry.detail !== null && (
        <span className="text-muted-foreground text-sm">{entry.detail}</span>
      )}
    </li>
  );
}

function RelationGroup({
  label,
  people,
}: {
  readonly label: string;
  readonly people: readonly RelationLine[];
}) {
  if (people.length === 0) {
    return null;
  }
  return (
    <div className="flex flex-col gap-1">
      <h3 className="text-muted-foreground text-xs font-semibold uppercase tracking-wide">
        {label}
      </h3>
      <ul className="flex flex-col gap-1 text-sm">
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
              <span className="text-muted-foreground"> · {person.detail}</span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
