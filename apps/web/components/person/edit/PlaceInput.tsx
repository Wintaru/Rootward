"use client";

import { useEffect, useId, useRef, useState } from "react";

import { searchPlaces } from "@/app/person/[personId]/edit/actions";
import type { PlaceOption } from "@/lib/db";

import { inputClass } from "./form";

const SEARCH_DEBOUNCE_MS = 250;

/**
 * Autocomplete-or-create place field (SPEC §8.3, §10 item 28): a plain text
 * input backed by a native `<datalist>` of existing `place` rows matching
 * what has been typed so far, debounced against the search server action.
 * No `placeId` is tracked here — picking a suggestion just fills the input
 * with its exact text, and any text (matched or not) resolves server-side at
 * save time (`findOrCreatePlaceId`, `lib/db/place.ts`), which normalizes and
 * either reuses the matching `place` row or creates one. That keeps this
 * component to one piece of state (the text) instead of a text/id pair that
 * could drift apart.
 */
export function PlaceInput({
  id,
  label,
  value,
  disabled,
  onChange,
}: {
  readonly id: string;
  readonly label: string;
  readonly value: string;
  readonly disabled: boolean;
  readonly onChange: (value: string) => void;
}) {
  const listId = useId();
  const [options, setOptions] = useState<readonly PlaceOption[]>([]);
  // Guards against a slow search response for an earlier keystroke landing
  // after a faster one for a later keystroke — only the most recent request
  // may still apply its result.
  const requestToken = useRef(0);

  useEffect(() => {
    // A blank query needs no fetch — `shownOptions` below already renders
    // nothing for it without touching state here (an unconditional setState
    // at the top of an effect trips `react-hooks/set-state-in-effect`).
    const query = value.trim();
    if (query === "") {
      return;
    }

    const token = ++requestToken.current;
    const timer = setTimeout(() => {
      searchPlaces(query)
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
  }, [value]);

  const shownOptions = value.trim() === "" ? [] : options;

  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-muted-foreground text-xs font-medium">
        {label}
      </label>
      <input
        id={id}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        list={listId}
        placeholder="e.g. Boston, Suffolk, Massachusetts"
        className={inputClass}
      />
      <datalist id={listId}>
        {shownOptions.map((option) => (
          <option key={option.id} value={option.name} />
        ))}
      </datalist>
    </div>
  );
}
