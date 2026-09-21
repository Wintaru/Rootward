"use client";

import { useId, useRef, useState } from "react";

import { Section } from "@/components/layout/Section";
import { ColorModeControl } from "@/components/theme/ColorModeControl";
import { ThemePicker } from "@/components/theme/ThemePicker";
import "@/components/theme/appearance.css";
import { applyThemePreference } from "@/lib/theme/apply";
import type { ThemePreference } from "@/lib/theme/preference";

import { saveAppearanceAction } from "./actions";

/** Save lifecycle — a discriminated union so no two flags disagree. */
type SaveState =
  | { readonly status: "idle" }
  | { readonly status: "saving" }
  | { readonly status: "error"; readonly message: string };

const DARK_QUERY = "(prefers-color-scheme: dark)";
const SAVE_FAILED = "Your choice could not be saved. Try again.";

function samePreference(a: ThemePreference, b: ThemePreference): boolean {
  return a.theme === b.theme && a.mode === b.mode;
}

/**
 * The Appearance tab (SPEC §8.1 `/settings`, decision 38, #80): the theme
 * radiogroup and the mode control. A pick applies at once — the same
 * `<html>` attributes the layout renders, written client-side by
 * `applyThemePreference` — then saves through `saveAppearanceAction`. A
 * failed save reverts to the last preference the server confirmed and shows
 * the error inline.
 *
 * Saves run one at a time. The action writes cookies, and a cookie write in
 * a server action makes Next re-render the route and apply that response's
 * tree; two saves in flight could land out of order and leave `<html>`,
 * the cookies, and the row disagreeing. So while one save is out, the
 * newest pick waits in `pending` and goes when the previous returns — an
 * arrow-key run across the cards costs two saves, not one per card.
 */
export function AppearancePanel({
  initial,
}: {
  readonly initial: ThemePreference;
}) {
  const [preference, setPreference] = useState(initial);
  const [save, setSave] = useState<SaveState>({ status: "idle" });
  const committed = useRef(initial);
  const inFlight = useRef(false);
  const pending = useRef<ThemePreference | null>(null);
  const themeHeadingId = useId();
  const modeHeadingId = useId();

  const apply = (next: ThemePreference) => {
    setPreference(next);
    applyThemePreference(
      document.documentElement,
      next,
      window.matchMedia(DARK_QUERY).matches,
    );
  };

  const send = (next: ThemePreference) => {
    inFlight.current = true;
    setSave({ status: "saving" });
    void saveAppearanceAction(next)
      .then(
        (result) => (result.ok ? null : result.error),
        () => SAVE_FAILED,
      )
      .then((error) => {
        if (error === null) {
          committed.current = next;
        }
        const queued = pending.current;
        if (queued !== null) {
          pending.current = null;
          send(queued);
          return;
        }
        inFlight.current = false;
        if (error === null) {
          setSave({ status: "idle" });
          return;
        }
        apply(committed.current);
        setSave({ status: "error", message: error });
      });
  };

  const choose = (next: ThemePreference) => {
    if (samePreference(next, preference)) {
      return;
    }
    apply(next);
    if (inFlight.current) {
      pending.current = next;
      return;
    }
    send(next);
  };

  return (
    <>
      <Section
        title="Theme"
        description="Colours, type, and corner shape. Every theme has a light and a dark side."
        headingId={themeHeadingId}
      >
        <ThemePicker
          value={preference.theme}
          labelledBy={themeHeadingId}
          onChange={(theme) => choose({ ...preference, theme })}
        />
      </Section>
      <Section
        title="Mode"
        description="Follow your device, or pin one side."
        headingId={modeHeadingId}
      >
        <ColorModeControl
          value={preference.mode}
          labelledBy={modeHeadingId}
          onChange={(mode) => choose({ ...preference, mode })}
        />
      </Section>
      <p
        role="status"
        aria-live="polite"
        className={
          save.status === "error"
            ? "text-destructive text-sm"
            : "text-muted-foreground text-sm"
        }
      >
        {save.status === "error"
          ? save.message
          : save.status === "saving"
            ? "Saving…"
            : ""}
      </p>
    </>
  );
}
