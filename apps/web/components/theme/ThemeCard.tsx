"use client";

import type { KeyboardEvent, Ref } from "react";

import type { ThemeDefinition, ThemePreview } from "@/lib/theme/registry";

/**
 * One option of the theme radiogroup (SPEC §8.1 Appearance, #80): a
 * light/dark mini preview drawn from `registry.preview` — a header strip
 * with ink, accent, and muted bars over a mini person card with a
 * `female`-coloured avatar and two text bars — then the label, the display
 * face, and three swatches (accent, male, female). The whole card is the
 * `role="radio"` button; `ThemePicker` owns the group and the roving
 * `tabIndex`.
 */
export function ThemeCard({
  theme,
  checked,
  tabIndex,
  buttonRef,
  onSelect,
  onKeyDown,
}: {
  readonly theme: ThemeDefinition;
  readonly checked: boolean;
  readonly tabIndex: 0 | -1;
  readonly buttonRef: Ref<HTMLButtonElement>;
  readonly onSelect: () => void;
  readonly onKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => void;
}) {
  return (
    <button
      ref={buttonRef}
      type="button"
      role="radio"
      aria-checked={checked}
      aria-label={`${theme.label} — ${theme.tagline}`}
      tabIndex={tabIndex}
      className="rw-theme-card"
      onClick={onSelect}
      onKeyDown={onKeyDown}
    >
      <span className="rw-theme-card__preview" aria-hidden="true">
        <PreviewPane preview={theme.preview.light} />
        <PreviewPane preview={theme.preview.dark} />
      </span>
      <span className="rw-theme-card__meta" aria-hidden="true">
        <span className="rw-theme-card__label">
          <span className="rw-theme-card__name">{theme.label}</span>
          <span className="rw-theme-card__face">{theme.fonts.display}</span>
        </span>
        <span className="rw-theme-card__dots">
          <span style={{ backgroundColor: theme.preview.light.accent }} />
          <span style={{ backgroundColor: theme.preview.light.male }} />
          <span style={{ backgroundColor: theme.preview.light.female }} />
        </span>
      </span>
    </button>
  );
}

/** One side of the preview. `muted` for the bars that read as secondary
 * text is the ink at 45% over the surface — the registry carries six hexes
 * per mode, not a muted one, and mixing is enough for a 3px bar. */
function PreviewPane({ preview }: { readonly preview: ThemePreview }) {
  const muted = `color-mix(in oklab, ${preview.ink} 45%, ${preview.surface})`;
  const line = `color-mix(in oklab, ${preview.ink} 18%, ${preview.surface})`;
  return (
    <span className="rw-theme-pane" style={{ backgroundColor: preview.bg }}>
      <span
        className="rw-theme-pane__bar"
        style={{ backgroundColor: preview.surface, borderColor: line }}
      >
        <span style={{ backgroundColor: preview.ink }} />
        <span style={{ backgroundColor: preview.accent }} />
        <span style={{ backgroundColor: muted }} />
      </span>
      <span className="rw-theme-pane__stage">
        <span
          className="rw-theme-pane__card"
          style={{ backgroundColor: preview.surface, borderColor: line }}
        >
          <span
            className="rw-theme-pane__avatar"
            style={{ backgroundColor: preview.female }}
          />
          <span className="rw-theme-pane__lines">
            <span style={{ backgroundColor: preview.ink }} />
            <span style={{ backgroundColor: muted }} />
          </span>
        </span>
      </span>
    </span>
  );
}
