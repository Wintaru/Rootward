"use client";

import Link from "next/link";
import { useId, useReducer, useState } from "react";

import {
  saveMediaLinks,
  setPrimaryMediaAction,
  signMediaThumbUrl,
} from "@/app/person/[personId]/edit/actions";
import type { RowConflict } from "@/lib/db/conflict";
import {
  getMediaLinkByMediaId,
  invokeMediaProcess,
  uploadMediaOriginal,
  type MediaEditRow,
} from "@/lib/db/media-edit";
import type { ConflictResolution } from "@/lib/edit/conflict";
import {
  describeMediaConflicts,
  diffMediaLinks,
  isMediaDiffEmpty,
  mediaFromLoaded,
  mediaReducer,
  reconcileMediaLinksAfterSave,
  type MediaDiff,
  type MediaDraft,
} from "@/lib/edit/media";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

import { ConflictDialog } from "./ConflictDialog";
import { inputClass, SaveBar } from "./form";

/** Client-side hint only — `media-process` re-validates against
 * `tree_settings.media_allowed_mime` server-side regardless (SPEC §7). */
const ACCEPTED_MIME =
  "image/jpeg,image/png,image/webp,image/gif,image/heic,application/pdf";

const REJECTION_MESSAGE: Record<"size" | "mime", string> = {
  size: "That file is larger than this tree's upload limit.",
  mime: "That file type isn't allowed here.",
};

/**
 * Media (SPEC §8.3, §4.4, §10 item 34) — upload, caption, reorder, delete,
 * and primary-photo over the person's attached media.
 *
 * Uploading runs immediately on file choice — straight to storage, then
 * `media-process` (issue #33) — rather than joining the caption/reorder/
 * delete batch below: there is nothing to "save" for an upload, the function
 * already committed the row by the time it responds (see `media-edit.ts`'s
 * module doc). Setting the primary photo is likewise immediate, not part of
 * the diffed save (`setPrimaryMedia`'s own doc explains why). Everything
 * else — caption text and ordering — follows the same dirty → saving →
 * saved/conflict/error `SaveBar` + `ConflictDialog` shape as every other
 * section (WAYFINDER decision 26).
 *
 * `thumbUrls` is a `media_link` id → signed-URL lookup the page pre-fetched
 * server-side (the `media` bucket only grants `storage.objects` access to
 * moderators, and even a moderator's browser session can't mint a signed URL
 * past that policy the way the service role can — see `media-urls.ts`). A
 * freshly uploaded row has no entry yet, so this signs its thumbnail
 * separately through `signMediaThumbUrl` right after the upload completes.
 */
export function MediaSection({
  personId,
  loaded,
  thumbUrls,
}: {
  readonly personId: string;
  readonly loaded: readonly MediaEditRow[];
  readonly thumbUrls: Readonly<Record<string, string>>;
}) {
  const [baseline, setBaseline] = useState(loaded);
  const [rows, dispatch] = useReducer(mediaReducer, loaded, mediaFromLoaded);
  const [status, setStatus] = useState<
    "idle" | "saving" | "saved" | "conflict" | "error"
  >("idle");
  const [error, setError] = useState<string | null>(null);
  const [conflictState, setConflictState] = useState<{
    readonly diff: MediaDiff;
    readonly conflicts: readonly RowConflict<MediaEditRow>[];
  } | null>(null);
  const [thumbs, setThumbs] =
    useState<Readonly<Record<string, string>>>(thumbUrls);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploadWarnings, setUploadWarnings] = useState<readonly string[]>([]);
  const inputId = useId();

  const diff = diffMediaLinks(baseline, rows);
  const dirty = !isMediaDiffEmpty(diff);
  const saving = status === "saving";

  async function handleFileChosen(file: File) {
    setUploading(true);
    setUploadError(null);
    setUploadWarnings([]);
    try {
      const supabase = createSupabaseBrowserClient();
      const { stagingPath } = await uploadMediaOriginal(supabase, file);
      const outcome = await invokeMediaProcess(supabase, {
        ownerType: "person",
        ownerId: personId,
        stagingPath,
        originalFilename: file.name,
      });

      if (outcome.status === "rejected") {
        setUploadError(REJECTION_MESSAGE[outcome.reason]);
        return;
      }

      const newRow = await getMediaLinkByMediaId(supabase, {
        mediaId: outcome.mediaId,
        ownerType: "person",
        ownerId: personId,
      });
      setBaseline((prev) => [...prev, newRow]);
      dispatch({ type: "row_added", row: newRow });
      setUploadWarnings(outcome.warnings);

      if (newRow.storagePathThumb !== null) {
        const url = await signMediaThumbUrl(newRow.storagePathThumb);
        if (url !== null) {
          setThumbs((prev) => ({ ...prev, [newRow.id]: url }));
        }
      }
    } catch {
      setUploadError("Something went wrong uploading that file. Try again.");
    } finally {
      setUploading(false);
    }
  }

  function field(id: string, caption: string) {
    dispatch({ type: "field_changed", id, caption });
    setStatus("idle");
  }

  function move(id: string, direction: "up" | "down") {
    dispatch({ type: "moved", id, direction });
    setStatus("idle");
  }

  function remove(id: string) {
    dispatch({ type: "removed", id });
    setStatus("idle");
  }

  async function handleSetPrimary(id: string) {
    const result = await setPrimaryMediaAction({ personId, mediaLinkId: id });
    if (result.status !== "saved") {
      setError(result.message);
      setStatus("error");
      return;
    }
    // Reuse the same reconciliation a batched save uses: `setPrimaryMedia`
    // bumps `updated_at` on both the newly primary row and whichever row it
    // unset, so folding its result through here (rather than hand-flipping
    // `isPrimary` locally) keeps both rows' cached versions correct for the
    // next caption/reorder save.
    const reconciled = reconcileMediaLinksAfterSave(baseline, rows, {
      updated: result.result.updated,
    });
    setBaseline(reconciled.baseline);
    dispatch({ type: "reconciled", rows: reconciled.current });
  }

  async function performSave(diffToSend: MediaDiff) {
    setStatus("saving");
    setError(null);
    try {
      const outcome = await saveMediaLinks({ personId, ...diffToSend });
      if (outcome.status !== "saved") {
        setError(outcome.message);
        setStatus("error");
        return;
      }
      const reconciled = reconcileMediaLinksAfterSave(
        baseline,
        rows,
        outcome.result,
      );
      setBaseline(reconciled.baseline);
      dispatch({ type: "reconciled", rows: reconciled.current });

      const touchedIds = new Set([
        ...diffToSend.updates.map((update) => update.id),
        ...diffToSend.deletes.map((del) => del.id),
      ]);
      const previousConflicts = conflictState?.conflicts ?? [];
      const merged = [
        ...previousConflicts.filter((conflict) => !touchedIds.has(conflict.id)),
        ...outcome.result.conflicts,
      ];

      if (merged.length === 0) {
        setConflictState(null);
        setStatus("saved");
      } else {
        setConflictState({
          diff: conflictState?.diff ?? diffToSend,
          conflicts: merged,
        });
        setStatus("conflict");
      }
    } catch {
      setError("Something went wrong. Try again in a moment.");
      setStatus("error");
    }
  }

  async function save() {
    // Blocked while an upload is in flight too, not just another save — an
    // upload appends a row straight into `baseline`/`rows` outside this
    // diff/save cycle, so letting the two race could drop the freshly
    // uploaded row from the in-memory list (it stays safely persisted
    // server-side either way, but would vanish from view until reload).
    if (!dirty || status === "saving" || uploading) {
      return;
    }
    await performSave(diff);
  }

  function retryKeepMine(id: string) {
    if (conflictState === null) {
      return;
    }
    const conflict = conflictState.conflicts.find((c) => c.id === id);
    if (conflict === undefined || conflict.theirs === null) {
      return;
    }
    const update = conflictState.diff.updates.find((u) => u.id === id);
    const del = conflictState.diff.deletes.find((d) => d.id === id);
    const singleDiff: MediaDiff =
      update !== undefined
        ? {
            updates: [
              { ...update, expectedUpdatedAt: conflict.theirs.updatedAt },
            ],
            deletes: [],
          }
        : del !== undefined
          ? {
              updates: [],
              deletes: [
                { id: del.id, expectedUpdatedAt: conflict.theirs.updatedAt },
              ],
            }
          : { updates: [], deletes: [] };
    void performSave(singleDiff);
  }

  function resolveConflict(id: string, resolution: ConflictResolution) {
    if (conflictState === null || status === "saving") {
      return;
    }
    const conflict = conflictState.conflicts.find((c) => c.id === id);
    if (conflict === undefined) {
      return;
    }
    if (resolution === "keep-mine") {
      retryKeepMine(id);
      return;
    }

    const nextBaseline =
      conflict.theirs === null
        ? baseline.filter((row) => row.id !== id)
        : [...baseline.filter((row) => row.id !== id), conflict.theirs];
    setBaseline(nextBaseline);
    dispatch({ type: "row_reset", id, row: conflict.theirs });

    const remaining = conflictState.conflicts.filter((c) => c.id !== id);
    setConflictState(
      remaining.length === 0
        ? null
        : { ...conflictState, conflicts: remaining },
    );
    if (remaining.length === 0) {
      setStatus("saved");
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <ConflictDialog
        items={
          conflictState === null
            ? []
            : describeMediaConflicts(conflictState.conflicts, rows)
        }
        disabled={saving}
        onResolve={resolveConflict}
      />

      <div className="flex flex-col gap-2">
        <label htmlFor={inputId} className="text-sm font-medium">
          Upload a photo or document
        </label>
        <input
          id={inputId}
          type="file"
          accept={ACCEPTED_MIME}
          disabled={uploading || saving}
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (file !== undefined) {
              void handleFileChosen(file);
            }
          }}
          className="text-sm"
        />
        {uploading && (
          <p className="text-muted-foreground text-sm" role="status">
            Uploading…
          </p>
        )}
        {uploadError !== null && (
          <p className="text-destructive text-sm" role="alert">
            {uploadError}
          </p>
        )}
        {uploadWarnings.map((warning) => (
          <p key={warning} className="text-muted-foreground text-xs">
            {warning}
          </p>
        ))}
      </div>

      <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3">
        {rows.map((row, index) => (
          <MediaCard
            key={row.id}
            row={row}
            thumbUrl={thumbs[row.id] ?? null}
            index={index}
            count={rows.length}
            disabled={saving}
            onField={(caption) => field(row.id, caption)}
            onMove={(direction) => move(row.id, direction)}
            onRemove={() => remove(row.id)}
            onSetPrimary={() => void handleSetPrimary(row.id)}
          />
        ))}
        {rows.length === 0 && (
          <li className="text-muted-foreground col-span-full text-sm">
            No media attached yet.
          </li>
        )}
      </ul>

      <SaveBar
        dirty={dirty && !uploading}
        status={status}
        error={error}
        onSave={save}
        conflictMessage="Some media changed elsewhere and were not saved; the rest were."
      />
    </div>
  );
}

function MediaCard({
  row,
  thumbUrl,
  index,
  count,
  disabled,
  onField,
  onMove,
  onRemove,
  onSetPrimary,
}: {
  readonly row: MediaDraft;
  readonly thumbUrl: string | null;
  readonly index: number;
  readonly count: number;
  readonly disabled: boolean;
  readonly onField: (caption: string) => void;
  readonly onMove: (direction: "up" | "down") => void;
  readonly onRemove: () => void;
  readonly onSetPrimary: () => void;
}) {
  const captionId = useId();

  return (
    <li className="border-border flex flex-col gap-2 rounded-lg border p-3">
      <Link
        href={`/media/${row.mediaId}`}
        className="bg-muted block aspect-square overflow-hidden rounded-md"
      >
        {thumbUrl !== null ? (
          // eslint-disable-next-line @next/next/no-img-element -- a signed storage URL, not a static asset `next/image` can optimize
          <img
            src={thumbUrl}
            alt={row.title ?? row.originalFilename ?? "Media"}
            className="h-full w-full object-cover"
          />
        ) : (
          <span className="text-muted-foreground flex h-full items-center justify-center p-2 text-center text-xs">
            {row.originalFilename ?? "No preview"}
          </span>
        )}
      </Link>

      <label
        htmlFor={captionId}
        className="text-muted-foreground text-xs font-medium"
      >
        Caption
      </label>
      <input
        id={captionId}
        value={row.caption}
        disabled={disabled}
        onChange={(e) => onField(e.target.value)}
        className={inputClass}
      />

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={onSetPrimary}
          disabled={disabled || row.isPrimary}
          className="border-border hover:bg-accent rounded-md border px-2 py-1 text-xs font-medium disabled:opacity-50"
        >
          {row.isPrimary ? "Primary" : "Set as primary"}
        </button>
        <button
          type="button"
          onClick={() => onMove("up")}
          disabled={disabled || index === 0}
          aria-label="Move up"
          className="border-border rounded-md border px-2 py-1 text-xs disabled:opacity-40"
        >
          ▲
        </button>
        <button
          type="button"
          onClick={() => onMove("down")}
          disabled={disabled || index === count - 1}
          aria-label="Move down"
          className="border-border rounded-md border px-2 py-1 text-xs disabled:opacity-40"
        >
          ▼
        </button>
        <button
          type="button"
          onClick={onRemove}
          disabled={disabled}
          className="text-destructive ml-auto rounded-md px-2 py-1 text-xs font-medium disabled:opacity-40"
        >
          Remove
        </button>
      </div>
    </li>
  );
}
