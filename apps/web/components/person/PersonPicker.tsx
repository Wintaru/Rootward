"use client";

import { useEffect, useId, useRef, useState } from "react";

import type { PersonSearchOption } from "@/lib/db";

const SEARCH_DEBOUNCE_MS = 250;

/**
 * Search-by-name person picker. Backs "approve access request" and
 * "reassign account" on `/moderation` (issue #36) — a moderator has only the
 * requester's submitted name to go on, not a person id — and the default
 * root person on `/settings` (issue #53), where nobody knows a UUID. Emits
 * the chosen option and clears itself; the caller renders the selection
 * (see `AccessRequestsQueue.tsx` / `LinkedAccounts.tsx` /
 * `TreeSettingsForm.tsx`) rather than this component tracking "selected"
 * state itself.
 *
 * `search` is injected because a server action is bound to the route that
 * gates it (`resolveModerationAccess` on `/moderation`,
 * `resolveSettingsAccess` on `/settings`) — a shared component under
 * `components/` must not import one route's `actions.ts`. Pass a stable
 * reference (the imported action itself, not an inline closure): it is an
 * effect dependency, so a new function per render would restart the
 * debounce on every keystroke's re-render and fire duplicate requests.
 *
 * Same debounced-search-with-a-stale-response-guard shape as `PlaceInput.tsx`
 * — see its comment for why the empty-query branch below returns before any
 * `setOptions` call instead of clearing it unconditionally.
 */
export function PersonPicker({
  label,
  disabled,
  search,
  onSelect,
}: {
  readonly label: string;
  readonly disabled?: boolean;
  readonly search: (query: string) => Promise<readonly PersonSearchOption[]>;
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
      search(trimmed)
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
  }, [query, search]);

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
