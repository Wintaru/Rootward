"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import ReactCrop from "react-image-crop";
import "react-image-crop/dist/ReactCrop.css";
import { RotateCcw, RotateCw } from "lucide-react";
import {
  rotatedSize,
  rotateImage,
  type MediaTransform,
  type Rotation,
} from "@rootward/media";

import { applyMediaTransformAction } from "@/app/media/[mediaId]/actions";
import {
  derivativePaths,
  uploadMediaDerivatives,
} from "@/lib/db/media-transform";
import {
  isSameTransform,
  isUsableCrop,
  percentCropToPixels,
  pixelCropToPercent,
  rotateCropPercent,
  stepRotation,
  type PercentCrop,
  type RotationStep,
} from "@/lib/media/transform-editor";
import {
  loadEditableOriginal,
  regenerateDerivatives,
  type EditableOriginal,
} from "@/lib/media/regenerate";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

type SourceState =
  | { readonly status: "loading" }
  | { readonly status: "unsupported" }
  | { readonly status: "error"; readonly message: string }
  | { readonly status: "ready"; readonly source: EditableOriginal };

type SaveState =
  | { readonly status: "idle" }
  | { readonly status: "saving" }
  | { readonly status: "error"; readonly message: string };

const buttonClass =
  "border-border hover:bg-accent inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm font-medium disabled:opacity-50";

/**
 * Rotate/crop for one media item on `/media/[mediaId]` (SPEC §8.3),
 * moderators only -- the page decides that; `media_write` RLS is the real
 * gate. Non-destructive: the editor previews from the *original* (the
 * display derivative already has the current transform baked in), holds the
 * rotation plus a percent crop of the rotated preview, and on save
 * regenerates the thumb/display pair in the browser
 * (`lib/media/regenerate.ts`), uploads it, and commits through
 * `applyMediaTransformAction`. The page is then refreshed so the viewer,
 * gallery, and tree card all pick up the new derivative paths.
 *
 * State lives here and nowhere higher: nothing else on the page reads the
 * in-progress transform. `rotation`/`crop` are seeded from `initial` when
 * the editor opens (not in `useState`'s initializer) so a reopen after a
 * save starts from the refreshed props.
 */
export function MediaTransformEditor({
  mediaId,
  originalUrl,
  mimeType,
  initial,
  updatedAt,
}: {
  readonly mediaId: string;
  readonly originalUrl: string;
  readonly mimeType: string;
  readonly initial: MediaTransform;
  readonly updatedAt: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [sourceState, setSourceState] = useState<SourceState>({
    status: "loading",
  });
  const [rotation, setRotation] = useState<Rotation>(0);
  const [crop, setCrop] = useState<PercentCrop | null>(null);
  const [saveState, setSaveState] = useState<SaveState>({ status: "idle" });

  useEffect(() => {
    if (!open) {
      return;
    }
    let cancelled = false;
    loadEditableOriginal(originalUrl, mimeType)
      .then((source) => {
        if (cancelled) {
          return;
        }
        if (source === null) {
          setSourceState({ status: "unsupported" });
          return;
        }
        setSourceState({ status: "ready", source });
        setCrop(
          initial.crop === null
            ? null
            : pixelCropToPercent(
                initial.crop,
                rotatedSize(source.original, initial.rotation),
              ),
        );
      })
      .catch((err: unknown) => {
        if (cancelled) {
          return;
        }
        setSourceState({
          status: "error",
          message: err instanceof Error ? err.message : String(err),
        });
      });
    return () => {
      cancelled = true;
    };
  }, [open, originalUrl, mimeType, initial]);

  function openEditor() {
    setRotation(initial.rotation);
    setCrop(null);
    setSaveState({ status: "idle" });
    setSourceState({ status: "loading" });
    setOpen(true);
  }

  function closeEditor() {
    setOpen(false);
    // Drop the decoded original (tens of MB for a phone photo) as soon as
    // the editor closes rather than holding it for the page's lifetime.
    setSourceState({ status: "loading" });
  }

  function rotate(step: RotationStep) {
    setRotation((current) => stepRotation(current, step));
    setCrop((current) =>
      current === null ? null : rotateCropPercent(current, step),
    );
  }

  function resetToOriginal() {
    setRotation(0);
    setCrop(null);
  }

  /** The transform the current controls describe, in `media.crop_*`'s
   * pixel space -- what Save would store. */
  function currentTransform(source: EditableOriginal): MediaTransform {
    const size = rotatedSize(source.original, rotation);
    return {
      rotation,
      crop: isUsableCrop(crop) ? percentCropToPixels(crop, size) : null,
    };
  }

  async function save(source: EditableOriginal) {
    setSaveState({ status: "saving" });
    try {
      const transform = currentTransform(source);
      const derivatives = await regenerateDerivatives(
        source.original,
        transform,
      );
      const token = crypto.randomUUID();
      await uploadMediaDerivatives(
        createSupabaseBrowserClient(),
        derivativePaths(mediaId, token),
        derivatives,
      );
      const result = await applyMediaTransformAction({
        mediaId,
        token,
        expectedUpdatedAt: updatedAt,
        rotation: transform.rotation,
        crop: transform.crop,
      });
      switch (result.status) {
        case "saved":
          closeEditor();
          router.refresh();
          return;
        case "conflict":
          setSaveState({
            status: "error",
            message:
              "This photo was changed elsewhere while you had it open. Reload the page and try again.",
          });
          return;
        case "error":
          setSaveState({ status: "error", message: result.message });
          return;
      }
    } catch (err: unknown) {
      setSaveState({
        status: "error",
        message: `Could not save that change: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={openEditor}
        className={`${buttonClass} w-fit`}
      >
        Rotate or crop
      </button>
    );
  }

  const saving = saveState.status === "saving";
  const source = sourceState.status === "ready" ? sourceState.source : null;
  const dirty =
    source !== null && !isSameTransform(currentTransform(source), initial);

  return (
    <section
      aria-label="Rotate or crop"
      className="border-border flex flex-col gap-3 rounded-lg border p-3"
    >
      {sourceState.status === "loading" && (
        <p className="text-muted-foreground text-sm" role="status">
          Loading the original…
        </p>
      )}
      {sourceState.status === "unsupported" && (
        <p className="text-muted-foreground text-sm">
          This file type can&rsquo;t be edited in the browser.
        </p>
      )}
      {sourceState.status === "error" && (
        <p className="text-destructive text-sm" role="alert">
          Could not load the original ({sourceState.message}). The download link
          expires after an hour — reload the page and try again.
        </p>
      )}
      {source !== null && (
        <>
          <p className="text-muted-foreground text-sm">
            Drag on the photo to crop it. The original file is kept as-is — only
            the thumbnails change.
          </p>
          <div className="bg-muted flex justify-center overflow-hidden rounded-md">
            <ReactCrop
              crop={crop === null ? undefined : { unit: "%", ...crop }}
              // The zero-size crop it reports on pointer-down must be kept:
              // the library only tracks the drag while a `crop` prop exists.
              // `isUsableCrop` filters it back out everywhere it matters.
              onChange={(_, percent) => setCrop(percent)}
              disabled={saving}
              keepSelection
            >
              <PreviewCanvas image={source.preview} rotation={rotation} />
            </ReactCrop>
          </div>
        </>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => rotate(-90)}
          disabled={source === null || saving}
          className={buttonClass}
        >
          <RotateCcw aria-hidden className="size-4" />
          Rotate left
        </button>
        <button
          type="button"
          onClick={() => rotate(90)}
          disabled={source === null || saving}
          className={buttonClass}
        >
          <RotateCw aria-hidden className="size-4" />
          Rotate right
        </button>
        <button
          type="button"
          onClick={() => setCrop(null)}
          disabled={source === null || saving || !isUsableCrop(crop)}
          className={buttonClass}
        >
          Clear crop
        </button>
        <button
          type="button"
          onClick={resetToOriginal}
          disabled={source === null || saving}
          className={buttonClass}
        >
          Reset to original
        </button>
        <span className="ml-auto flex gap-2">
          <button
            type="button"
            onClick={closeEditor}
            disabled={saving}
            className={buttonClass}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => source !== null && void save(source)}
            disabled={source === null || saving || !dirty}
            className="bg-foreground text-background rounded-md px-3 py-1.5 text-sm font-medium disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </span>
      </div>

      {saveState.status === "error" && (
        <p className="text-destructive text-sm" role="alert">
          {saveState.message}
        </p>
      )}
    </section>
  );
}

/** The rotated preview raster, painted straight from RGBA -- no `<img>`,
 * so a HEIC-free browser and a WebP/PNG/JPEG all take the same path. The
 * canvas's intrinsic size is the rotated preview's; CSS scales it to fit
 * and `react-image-crop` measures the scaled box, which is why the crop is
 * kept in percent. */
function PreviewCanvas({
  image,
  rotation,
}: {
  readonly image: EditableOriginal["preview"];
  readonly rotation: Rotation;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rotated = useMemo(
    () => rotateImage(image, rotation),
    [image, rotation],
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (canvas === null || ctx === null || ctx === undefined) {
      return;
    }
    // `createImageData` + `set` rather than `new ImageData(rotated.data)`:
    // the DOM constructor wants a plain-`ArrayBuffer`-backed array, and the
    // codec's output is typed over `ArrayBufferLike`.
    const imageData = ctx.createImageData(rotated.width, rotated.height);
    imageData.data.set(rotated.data);
    ctx.putImageData(imageData, 0, 0);
  }, [rotated]);

  return (
    <canvas
      ref={canvasRef}
      width={rotated.width}
      height={rotated.height}
      className="block h-auto max-h-[70vh] max-w-full"
      aria-label="Preview"
    />
  );
}
