"use client";

import { useEffect, useId, useRef, useState } from "react";

import type { PersonSearchOption } from "@/lib/db";

import { searchModerationPersons } from "./actions";

const SEARCH_DEBOUNCE_MS = 250;

/**
 * Search-by-name person picker backing "approve access request" and
 * "reassign account" (issue #36) — a moderator has only the requester's
 * submitted name to go on, not a person id, unlike the invite form's
 * `?personId=` prefill from an existing profile page. Emits the chosen
 * option and clears itself; the caller renders the selection (see
 * `AccessRequestsQueue.tsx` / `LinkedAccounts.tsx`) rather than this
 * component tracking "selected" state itself.
 *
 * Same debounced-search-with-a-stale-response-guard shape as `PlaceInput.tsx`
 * — see its comment for why the empty-query branch below returns before any
 * `setOptions` call instead of clearing it unconditionally.
 */
export function PersonPicker({
  label,
  disabled,
  onSelect,
}: {
  readonly label: string;
  readonly disabled?: boolean;
  readonly onSelect: (option: PersonSearchOption) => void;
}) {
  const id = useId();
  const [query, setQuery] = useState("");
  const [options, setOptions] = useState<readonly PersonSearchOption[]>([]);
  const requestToken = useRef(0);

  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed === "") {
      return;
    }

    const token = ++requestToken.current;
    const timer = setTimeout(() => {
      searchModerationPersons(trimmed)
        .then((results) => {
          if (requestToken.current === token) {
            setOptions(results);
          }
        })
        .catch(() => {
          if (requestToken.current === token) {
            setOptions([]);
          }
        });
    }, SEARCH_DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [query]);

  const shownOptions = query.trim() === "" ? [] : options;

  function select(option: PersonSearchOption) {
    onSelect(option);
    setQuery("");
    setOptions([]);
  }

  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-muted-foreground text-xs font-medium">
        {label}
      </label>
      <input
        id={id}
        value={query}
        disabled={disabled}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search by name…"
        autoComplete="off"
        className="border-border rounded-md border px-3 py-2 text-sm"
      />
      {shownOptions.length > 0 && (
        <ul className="border-border divide-border max-h-48 divide-y overflow-y-auto rounded-md border">
          {shownOptions.map((option) => (
            <li key={option.id}>
              <button
                type="button"
                disabled={disabled}
                onClick={() => select(option)}
                className="hover:bg-accent w-full px-3 py-2 text-left text-sm disabled:opacity-50"
              >
                {option.name}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
