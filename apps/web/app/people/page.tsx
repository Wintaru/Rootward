import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { isApproved } from "@/lib/auth/access";
import { getCurrentAccount } from "@/lib/auth/current-account";
import {
  formatLifespan,
  listPersons,
  PEOPLE_PAGE_SIZE,
} from "@/lib/db/person-search";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "People · Rootward",
};

/**
 * `/people` — browse the whole tree by name (SPEC §8.1, issue #62). The
 * header search box is for finding a known person fast; this route is the
 * "I don't remember the exact name" / "who else shares this surname" browse
 * path a 700-person tree also needs. Sorted by surname then given name,
 * paginated at the source (50 per page) rather than fetching everyone and
 * slicing client-side. Approved members only, same gate as `/tree` and
 * `/person/[personId]`.
 */
export default async function PeopleIndexPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; page?: string }>;
}) {
  const current = await getCurrentAccount();
  if (current === null) {
    redirect("/login");
  }
  if (!isApproved(current.account)) {
    redirect("/onboarding");
  }

  const { q, page: pageParam } = await searchParams;
  const query = q ?? "";
  const page = Math.max(1, Number.parseInt(pageParam ?? "1", 10) || 1);

  const supabase = await createSupabaseServerClient();
  const { rows, total } = await listPersons(supabase, { query, page });
  const totalPages = Math.max(1, Math.ceil(total / PEOPLE_PAGE_SIZE));

  // A page past the end (a stale link after the query narrowed, or a
  // hand-edited URL) would otherwise render an empty list under a "Page 1 of
  // N" nav that contradicts it — land on the last real page instead.
  if (rows.length === 0 && page > totalPages) {
    redirect(peopleHref(query, totalPages));
  }

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-8">
      <h1 className="text-xl font-semibold">People</h1>

      <form method="get" className="flex gap-2">
        <label htmlFor="name-filter" className="sr-only">
          Filter by name
        </label>
        <input
          id="name-filter"
          type="search"
          name="q"
          defaultValue={query}
          placeholder="Filter by name…"
          className="border-border bg-background flex-1 rounded-md border px-3 py-1.5 text-sm"
        />
        <button
          type="submit"
          className="border-border rounded-md border px-3 py-1.5 text-sm font-medium"
        >
          Filter
        </button>
      </form>

      <p className="text-muted-foreground text-sm">
        {total} {total === 1 ? "person" : "people"}
        {query !== "" ? ` matching "${query}"` : ""}
      </p>

      {rows.length === 0 ? (
        <p className="text-muted-foreground text-sm">No one found.</p>
      ) : (
        <ul className="divide-border divide-y">
          {rows.map((person) => (
            <li key={person.id}>
              <Link
                href={`/person/${person.id}`}
                className="hover:bg-accent flex items-baseline justify-between gap-4 px-1 py-2"
              >
                <span className="text-sm font-medium">{person.name}</span>
                <span className="text-muted-foreground text-xs">
                  {formatLifespan(person.birthYear, person.deathYear)}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}

      {totalPages > 1 && (
        <nav
          aria-label="Pagination"
          className="flex items-center justify-between text-sm"
        >
          {page > 1 ? (
            <Link
              href={peopleHref(query, page - 1)}
              className="hover:underline"
            >
              ← Previous
            </Link>
          ) : (
            <span />
          )}
          <span className="text-muted-foreground">
            Page {page} of {totalPages}
          </span>
          {page < totalPages ? (
            <Link
              href={peopleHref(query, page + 1)}
              className="hover:underline"
            >
              Next →
            </Link>
          ) : (
            <span />
          )}
        </nav>
      )}
    </main>
  );
}

function peopleHref(query: string, page: number): string {
  const params = new URLSearchParams();
  if (query !== "") params.set("q", query);
  if (page > 1) params.set("page", String(page));
  const qs = params.toString();
  return qs === "" ? "/people" : `/people?${qs}`;
}
