"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useMemo, useRef, useState } from "react";

import {
  formatLifespan,
  HEADER_SEARCH_LIMIT,
  searchPersonsWithLifespan,
  type PersonSearchResult,
} from "@/lib/db/person-search";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

const SEARCH_DEBOUNCE_MS = 250;

/**
 * The header search box (SPEC §8.1, issue #62). Queries Supabase directly
 * from the browser — the same posture `NotificationBell` already takes —
 * because RLS (`person_select` / `person_name_select`) is the real boundary;
 * there is nothing for a server action to gate that RLS does not already
 * enforce. Enter, or "See all results", goes to `/people?q=` with the query
 * prefilled, the browse half of #62.
 */
export function PersonSearchBox() {
  const id = useId();
  const router = useRouter();
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<readonly PersonSearchResult[]>([]);
  const [open, setOpen] = useState(false);
  const requestToken = useRef(0);

  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed === "") {
      return;
    }
    const token = ++requestToken.current;
    const timer = setTimeout(() => {
      searchPersonsWithLifespan(supabase, trimmed, HEADER_SEARCH_LIMIT)
        .then((rows) => {
          if (requestToken.current === token) {
            setResults(rows);
            setOpen(true);
          }
        })
        .catch(() => {
          if (requestToken.current === token) {
            setResults([]);
          }
        });
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query, supabase]);

  // Derived, not reset via an effect: an empty query shows nothing even
  // while a stale `results` from the previous query still sits in state.
  const shownResults = query.trim() === "" ? [] : results;

  function goToPeople() {
    const trimmed = query.trim();
    setOpen(false);
    router.push(
      trimmed === "" ? "/people" : `/people?q=${encodeURIComponent(trimmed)}`,
    );
  }

  return (
    <div className="relative">
      <label htmlFor={id} className="sr-only">
        Search for a person
      </label>
      <input
        id={id}
        type="search"
        value={query}
        placeholder="Search people…"
        className="border-border bg-background w-40 rounded-md border px-2 py-1 text-sm sm:w-56"
        onChange={(event) => setQuery(event.target.value)}
        onFocus={() => shownResults.length > 0 && setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            goToPeople();
          }
        }}
      />

      {open && query.trim() !== "" && (
        <div
          role="listbox"
          aria-label="Search results"
          className="border-border bg-popover text-popover-foreground absolute right-0 z-50 mt-1 max-h-96 w-72 overflow-y-auto rounded-lg border shadow-lg"
        >
          {shownResults.length === 0 ? (
            <p className="text-muted-foreground p-3 text-sm">No matches yet.</p>
          ) : (
            <ul className="divide-border divide-y">
              {shownResults.map((result) => (
                <li key={result.id}>
                  <Link
                    href={`/person/${result.id}`}
                    className="hover:bg-accent flex flex-col gap-0.5 px-3 py-2 text-sm"
                    onClick={() => setOpen(false)}
                  >
                    <span>{result.name}</span>
                    <span className="text-muted-foreground text-xs">
                      {formatLifespan(result.birthYear, result.deathYear)}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
          <button
            type="button"
            className="border-border text-muted-foreground hover:text-foreground w-full border-t px-3 py-2 text-left text-sm"
            onMouseDown={(event) => event.preventDefault()}
            onClick={goToPeople}
          >
            See all results
          </button>
        </div>
      )}
    </div>
  );
}
