"use client";

import { Fragment } from "react";

import type { ConflictItem, ConflictResolution } from "@/lib/edit/conflict";

/**
 * The shared conflict UI every edit section renders the same way (SPEC §8.3,
 * WAYFINDER decision 26): per rejected row, "This was changed by <user>
 * while you had it open" with their value and yours side by side, and "keep
 * mine" (re-save over theirs) / "take theirs" (discard my change to that
 * row). A row deleted elsewhere carries no value to compare — it gets a
 * single "discard my change" action instead of the two-button choice.
 *
 * Renders nothing when there is nothing to resolve, so a section can mount
 * this unconditionally rather than guard the render itself.
 *
 * `disabled` (true while the section is mid-save) blocks every resolve
 * button. Without it, a "keep mine" retry already in flight for one row and
 * a same-tick "take theirs" click on a different row race: the retry's
 * closure over the pre-click `baseline`/`rows`/conflict list lands *after*
 * the click and overwrites it, silently reverting or resurfacing a conflict
 * the user just resolved. One resolution in flight at a time removes the
 * race outright — see DECISIONS.md.
 */
export function ConflictDialog({
  items,
  disabled = false,
  onResolve,
}: {
  readonly items: readonly ConflictItem[];
  readonly disabled?: boolean;
  readonly onResolve: (id: string, resolution: ConflictResolution) => void;
}) {
  if (items.length === 0) {
    return null;
  }

  return (
    <div
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="conflict-dialog-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
    >
      <div className="bg-background border-border max-h-[80vh] w-full max-w-2xl overflow-y-auto rounded-lg border p-6 shadow-lg">
        <h2 id="conflict-dialog-title" className="text-lg font-semibold">
          {items.length === 1
            ? "This changed while you had it open"
            : `${items.length} changed while you had them open`}
        </h2>
        <ul className="mt-4 flex flex-col gap-4">
          {items.map((item) => (
            <li key={item.id} className="border-border rounded-md border p-4">
              <p className="text-sm font-medium">{item.title}</p>

              {item.deleted ? (
                <>
                  <p className="text-muted-foreground mt-1 text-sm">
                    This was deleted
                    {item.changedBy !== null
                      ? ` by ${item.changedBy}`
                      : ""}{" "}
                    while you had it open.
                  </p>
                  <button
                    type="button"
                    onClick={() => onResolve(item.id, "take-theirs")}
                    disabled={disabled}
                    className="border-border hover:bg-accent mt-3 w-fit rounded-md border px-3 py-1.5 text-sm font-medium disabled:opacity-50"
                  >
                    Discard my change
                  </button>
                </>
              ) : (
                <>
                  <p className="text-muted-foreground mt-1 text-sm">
                    Changed
                    {item.changedBy !== null
                      ? ` by ${item.changedBy}`
                      : ""}{" "}
                    while you had it open.
                  </p>
                  <div className="mt-2 grid grid-cols-[auto_1fr_1fr] gap-x-4 gap-y-1 text-sm">
                    <span />
                    <span className="text-muted-foreground text-xs font-medium">
                      Yours
                    </span>
                    <span className="text-muted-foreground text-xs font-medium">
                      Theirs
                    </span>
                    {item.fields.map((field) => (
                      <Fragment key={field.label}>
                        <span className="text-muted-foreground text-xs font-medium">
                          {field.label}
                        </span>
                        <span>{field.yours || "—"}</span>
                        <span>{field.theirs || "—"}</span>
                      </Fragment>
                    ))}
                  </div>
                  <div className="mt-3 flex gap-2">
                    <button
                      type="button"
                      onClick={() => onResolve(item.id, "keep-mine")}
                      disabled={disabled}
                      className="bg-primary text-primary-foreground w-fit rounded-md px-3 py-1.5 text-sm font-medium disabled:opacity-50"
                    >
                      Keep mine
                    </button>
                    <button
                      type="button"
                      onClick={() => onResolve(item.id, "take-theirs")}
                      disabled={disabled}
                      className="border-border hover:bg-accent w-fit rounded-md border px-3 py-1.5 text-sm font-medium disabled:opacity-50"
                    >
                      Take theirs
                    </button>
                  </div>
                </>
              )}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
