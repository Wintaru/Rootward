"use client";

/**
 * Shared bits between the edit view's form sections (Name & Gender,
 * Reference Numbers, Additional Names — SPEC §8.3, §10 item 27): the input
 * style and the save button + status line, since every section follows the
 * same save lifecycle (WAYFINDER decision 26 — dirty → saving → saved, or a
 * conflict / error banner in place of the full `ConflictDialog` that #31
 * adds).
 */

export const inputClass = "border-border rounded-md border px-3 py-2 text-sm";

export type SectionSaveStatus =
  "idle" | "saving" | "saved" | "conflict" | "error";

export function SaveBar({
  dirty,
  status,
  error,
  onSave,
  conflictMessage,
}: {
  readonly dirty: boolean;
  readonly status: SectionSaveStatus;
  readonly error: string | null;
  readonly onSave: () => void;
  readonly conflictMessage: string;
}) {
  const saving = status === "saving";

  return (
    <div className="flex flex-col gap-2">
      {status === "conflict" && (
        <p className="text-destructive text-sm" role="alert">
          {conflictMessage} Reload the page to see the latest version before
          saving again.
        </p>
      )}
      {status === "error" && error !== null && (
        <p className="text-destructive text-sm" role="alert">
          {error}
        </p>
      )}
      {status === "saved" && !dirty && (
        <p className="text-muted-foreground text-sm" role="status">
          Saved.
        </p>
      )}
      <button
        type="button"
        onClick={onSave}
        disabled={!dirty || saving}
        className="bg-primary text-primary-foreground w-fit rounded-md px-4 py-2 text-sm font-medium disabled:opacity-50"
      >
        {saving ? "Saving…" : "Save"}
      </button>
    </div>
  );
}

export function Field({
  label,
  htmlFor,
  children,
}: {
  readonly label: string;
  readonly htmlFor: string;
  readonly children: React.ReactNode;
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
