"use client";

import { type KeyboardEvent, useRef } from "react";

import { THEMES, type ThemeId } from "@/lib/theme/registry";
import { nextRadioIndex } from "@/lib/ui/roving-radio";

import { ThemeCard } from "./ThemeCard";

/**
 * The theme radiogroup (#80): every registry theme as a `ThemeCard`, one
 * tab stop (the checked card), arrow keys to move and select. Controlled —
 * `AppearancePanel` owns the value and the save.
 */
export function ThemePicker({
  value,
  labelledBy,
  onChange,
}: {
  readonly value: ThemeId;
  readonly labelledBy: string;
  readonly onChange: (theme: ThemeId) => void;
}) {
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  const checkedIndex = Math.max(
    0,
    THEMES.findIndex((theme) => theme.id === value),
  );

  const onKeyDown = (
    event: KeyboardEvent<HTMLButtonElement>,
    index: number,
  ) => {
    const next = nextRadioIndex(event.key, index, THEMES.length);
    const target = next === null ? undefined : THEMES[next];
    if (next === null || target === undefined) {
      return;
    }
    event.preventDefault();
    buttons.current[next]?.focus();
    onChange(target.id);
  };

  return (
    <div
      role="radiogroup"
      aria-labelledby={labelledBy}
      className="rw-theme-grid"
    >
      {THEMES.map((theme, index) => (
        <ThemeCard
          key={theme.id}
          theme={theme}
          checked={index === checkedIndex}
          tabIndex={index === checkedIndex ? 0 : -1}
          buttonRef={(element) => {
            buttons.current[index] = element;
          }}
          onSelect={() => onChange(theme.id)}
          onKeyDown={(event) => onKeyDown(event, index)}
        />
      ))}
    </div>
  );
}
