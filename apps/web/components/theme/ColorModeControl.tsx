"use client";

import { type KeyboardEvent, useRef } from "react";

import { COLOR_MODES, type ColorMode } from "@/lib/theme/preference";
import { nextRadioIndex } from "@/lib/ui/roving-radio";

const MODE_LABEL: Readonly<Record<ColorMode, string>> = {
  system: "System",
  light: "Light",
  dark: "Dark",
};

/**
 * System | Light | Dark as a segmented radiogroup (#80): a `--secondary`
 * track, the checked segment lifted onto `--card`. Same keyboard contract
 * as `ThemePicker` — one tab stop, arrows move and select.
 */
export function ColorModeControl({
  value,
  labelledBy,
  onChange,
}: {
  readonly value: ColorMode;
  readonly labelledBy: string;
  readonly onChange: (mode: ColorMode) => void;
}) {
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);

  const onKeyDown = (
    event: KeyboardEvent<HTMLButtonElement>,
    index: number,
  ) => {
    const next = nextRadioIndex(event.key, index, COLOR_MODES.length);
    const target = next === null ? undefined : COLOR_MODES[next];
    if (next === null || target === undefined) {
      return;
    }
    event.preventDefault();
    buttons.current[next]?.focus();
    onChange(target);
  };

  return (
    <div
      role="radiogroup"
      aria-labelledby={labelledBy}
      className="rw-segmented"
    >
      {COLOR_MODES.map((mode, index) => (
        <button
          key={mode}
          ref={(element) => {
            buttons.current[index] = element;
          }}
          type="button"
          role="radio"
          aria-checked={mode === value}
          tabIndex={mode === value ? 0 : -1}
          className="rw-segmented__option"
          onClick={() => onChange(mode)}
          onKeyDown={(event) => onKeyDown(event, index)}
        >
          {MODE_LABEL[mode]}
        </button>
      ))}
    </div>
  );
}
