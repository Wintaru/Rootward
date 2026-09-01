"use client";

import { type FormEvent, useId, useState } from "react";

import { Section } from "@/components/layout/Section";
import type { TreeSettings } from "@/lib/db";

import { saveTreeSettingsAction } from "./actions";

/** Submit lifecycle — a discriminated union so no two flags disagree. */
type SubmitState =
  | { status: "idle" }
  | { status: "submitting" }
  | { status: "error"; message: string }
  | { status: "saved" };

/** The row's typed fields, flattened to the strings/booleans a form actually
 * holds. `validateTreeSettingsForm` trims/normalises several of these
 * (`treeName`, `mediaAllowedMime`, …), so what gets saved is not always
 * byte-for-byte what was typed. `page.tsx` keys this component on
 * `settings.updatedAt`, so a successful save (which revalidates the route
 * and hands back a fresh `updatedAt`) remounts the form and re-runs this
 * initializer — the visible fields end up showing the normalised value the
 * server actually persisted, not the raw typed one. */
function toFormState(settings: TreeSettings) {
  return {
    treeName: settings.treeName ?? "",
    treeDescription: settings.treeDescription ?? "",
    allowSelfSignup: settings.allowSelfSignup,
    livingThresholdYears: String(settings.livingThresholdYears),
    defaultRootPersonId: settings.defaultRootPersonId ?? "",
    defaultGenerationsUp: String(settings.defaultGenerationsUp),
    defaultGenerationsDown: String(settings.defaultGenerationsDown),
    mediaMaxBytes: String(settings.mediaMaxBytes),
    mediaAllowedMime: settings.mediaAllowedMime.join("\n"),
    stripExifGps: settings.stripExifGps,
  };
}

type FormState = ReturnType<typeof toFormState>;

/** Tree settings + media limits (SPEC §4.6, §10 item 37). One form, one
 * save — unlike the edit view's per-row sections (decision 26), this is a
 * singleton row with no concurrency token, so there is nothing to reconcile
 * on save beyond a plain success/error. Post-MVP backup settings (decision
 * 29) are left out entirely, not shown disabled — nothing reads them yet. */
export function TreeSettingsForm({
  settings,
}: {
  readonly settings: TreeSettings;
}) {
  const [form, setForm] = useState<FormState>(() => toFormState(settings));
  const [state, setState] = useState<SubmitState>({ status: "idle" });
  const busy = state.status === "submitting";

  const treeNameId = useId();
  const treeDescriptionId = useId();
  const allowSelfSignupId = useId();
  const livingThresholdYearsId = useId();
  const defaultRootPersonIdId = useId();
  const defaultGenerationsUpId = useId();
  const defaultGenerationsDownId = useId();
  const mediaMaxBytesId = useId();
  const mediaAllowedMimeId = useId();
  const stripExifGpsId = useId();

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) {
      return;
    }
    setState({ status: "submitting" });
    try {
      const result = await saveTreeSettingsAction(form);
      if (result.ok) {
        setState({ status: "saved" });
      } else {
        setState({ status: "error", message: result.error });
      }
    } catch {
      setState({
        status: "error",
        message: "Something went wrong. Try again in a moment.",
      });
    }
  }

  const mediaMaxMb = megabytes(form.mediaMaxBytes);

  return (
    <Section
      title="Tree settings"
      description="Applies to every visitor. Changing the default generations affects the next tree load, not sessions already open."
    >
      <form onSubmit={submit} className="flex flex-col gap-4">
        <Field label="Tree name" htmlFor={treeNameId}>
          <input
            id={treeNameId}
            value={form.treeName}
            onChange={(e) => set("treeName", e.target.value)}
            disabled={busy}
            className={inputClass}
          />
        </Field>

        <Field label="Tree description" htmlFor={treeDescriptionId}>
          <textarea
            id={treeDescriptionId}
            value={form.treeDescription}
            onChange={(e) => set("treeDescription", e.target.value)}
            disabled={busy}
            rows={2}
            className={inputClass}
          />
        </Field>

        <label
          htmlFor={allowSelfSignupId}
          className="flex items-center gap-2 text-sm font-medium"
        >
          <input
            id={allowSelfSignupId}
            type="checkbox"
            checked={form.allowSelfSignup}
            onChange={(e) => set("allowSelfSignup", e.target.checked)}
            disabled={busy}
          />
          Allow self-signup (the claim-your-place flow on /onboarding)
        </label>

        <Field
          label="Living-person threshold (years)"
          htmlFor={livingThresholdYearsId}
        >
          <input
            id={livingThresholdYearsId}
            inputMode="numeric"
            value={form.livingThresholdYears}
            onChange={(e) => set("livingThresholdYears", e.target.value)}
            disabled={busy}
            className={`${inputClass} w-32`}
          />
        </Field>

        <Field label="Default root person ID" htmlFor={defaultRootPersonIdId}>
          <input
            id={defaultRootPersonIdId}
            value={form.defaultRootPersonId}
            onChange={(e) => set("defaultRootPersonId", e.target.value)}
            placeholder="00000000-0000-0000-0000-000000000000"
            disabled={busy}
            className={`${inputClass} font-mono`}
          />
        </Field>

        <div className="flex gap-4">
          <Field
            label="Default generations up"
            htmlFor={defaultGenerationsUpId}
          >
            <input
              id={defaultGenerationsUpId}
              inputMode="numeric"
              value={form.defaultGenerationsUp}
              onChange={(e) => set("defaultGenerationsUp", e.target.value)}
              disabled={busy}
              className={`${inputClass} w-20`}
            />
          </Field>
          <Field
            label="Default generations down"
            htmlFor={defaultGenerationsDownId}
          >
            <input
              id={defaultGenerationsDownId}
              inputMode="numeric"
              value={form.defaultGenerationsDown}
              onChange={(e) => set("defaultGenerationsDown", e.target.value)}
              disabled={busy}
              className={`${inputClass} w-20`}
            />
          </Field>
        </div>

        <Field label="Maximum upload size (bytes)" htmlFor={mediaMaxBytesId}>
          <input
            id={mediaMaxBytesId}
            inputMode="numeric"
            value={form.mediaMaxBytes}
            onChange={(e) => set("mediaMaxBytes", e.target.value)}
            disabled={busy}
            className={`${inputClass} w-40`}
          />
          {mediaMaxMb !== null && (
            <span className="text-muted-foreground text-xs">
              ≈ {mediaMaxMb} MB
            </span>
          )}
        </Field>

        <Field
          label="Allowed media types (one per line, or comma-separated)"
          htmlFor={mediaAllowedMimeId}
        >
          <textarea
            id={mediaAllowedMimeId}
            value={form.mediaAllowedMime}
            onChange={(e) => set("mediaAllowedMime", e.target.value)}
            disabled={busy}
            rows={4}
            className={`${inputClass} font-mono`}
          />
        </Field>

        <label
          htmlFor={stripExifGpsId}
          className="flex items-center gap-2 text-sm font-medium"
        >
          <input
            id={stripExifGpsId}
            type="checkbox"
            checked={form.stripExifGps}
            onChange={(e) => set("stripExifGps", e.target.checked)}
            disabled={busy}
          />
          Strip GPS location from uploaded photo metadata
        </label>

        {state.status === "error" && (
          <p className="text-destructive text-sm" role="alert">
            {state.message}
          </p>
        )}
        {state.status === "saved" && (
          <p className="text-sm" role="status">
            Saved.
          </p>
        )}

        <button
          type="submit"
          disabled={busy}
          className="bg-primary text-primary-foreground w-fit rounded-md px-4 py-2 text-sm font-medium disabled:opacity-50"
        >
          {busy ? "Saving…" : "Save settings"}
        </button>
      </form>
    </Section>
  );
}

/** `"10485760"` → `"10.0"`. `null` for anything that is not a positive
 * finite number yet (mid-edit), so the hint just disappears rather than
 * showing `NaN MB`. */
function megabytes(bytes: string): string | null {
  const parsed = Number(bytes);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null;
  }
  return (parsed / (1024 * 1024)).toFixed(1);
}

const inputClass = "border-border rounded-md border px-3 py-2 text-sm";

function Field({
  label,
  htmlFor,
  children,
}: {
  label: string;
  htmlFor: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={htmlFor} className="text-sm font-medium">
        {label}
      </label>
      {children}
    </div>
  );
}
